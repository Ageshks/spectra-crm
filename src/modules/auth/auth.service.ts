import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { PrismaService } from '../../database/prisma.service';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';
import { pickUser, SafeUser } from '../../common/utils/user.util';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.module';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { TokenService, TokenPair } from './token.service';

export interface AuthResult {
  user: SafeUser & { customerId?: string; employeeId?: string; managerId?: string };
  tokens: TokenPair;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<SafeUser> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    const company = await this.prisma.company.findUnique({
      where: { slug: dto.companySlug?.trim().toLowerCase() || 'default' },
      select: { id: true, isActive: true },
    });
    if (!company || !company.isActive) throw new BadRequestException('Company is unavailable');
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        passwordHash,
        role: Role.CUSTOMER,
        companyId: company.id,
        isVerified: false,
        customer: { create: { companyId: company.id } },
      },
    });

    await this.audit.log({
      action: 'REGISTER',
      module: 'auth',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      newValues: { email: user.email, role: user.role },
    });

    return pickUser(user);
  }

  async login(dto: LoginDto, context: { userAgent?: string; ipAddress?: string }): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        company: { select: { isActive: true } },
        customer: { select: { id: true } },
        employee: {
          select: {
            id: true,
            employeeNo: true,
            designationRecord: { select: { isActive: true, canUseFieldApp: true } },
          },
        },
        manager: { select: { id: true } },
      },
    });
    if (!user) {
      this.logger.warn(JSON.stringify({ event: 'login_failed', reason: 'unknown_email' }));
      await this.audit.log({
        action: 'LOGIN_FAILED',
        module: 'auth',
        entity: 'User',
        newValues: { email: dto.email, reason: 'unknown_email' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      this.logger.warn(JSON.stringify({ event: 'login_failed', reason: 'bad_password' }));
      await this.audit.log({
        action: 'LOGIN_FAILED',
        module: 'auth',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        newValues: { reason: 'bad_password' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      this.logger.warn(JSON.stringify({ event: 'login_failed', reason: 'account_disabled', userId: user.id }));
      await this.audit.log({
        action: 'LOGIN_FAILED',
        module: 'auth',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        newValues: { reason: 'account_disabled' },
      });
      throw new ForbiddenException('Account is deactivated');
    }
    if (user.companyId && !user.company?.isActive) {
      throw new ForbiddenException('Company tenant is deactivated');
    }

    if (
      user.role === Role.EMPLOYEE &&
      (!user.employee?.designationRecord?.isActive ||
        !user.employee.designationRecord.canUseFieldApp)
    ) {
      await this.audit.log({
        action: 'LOGIN_FAILED',
        module: 'auth',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        newValues: { reason: 'designation_not_allowed_in_field_app' },
      });
      throw new ForbiddenException(
        'Only employees with Field Technician or Temp Staff designation can use the field app',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokens.issuePair(user, context);
    await this.audit.log({
      action: 'LOGIN',
      module: 'auth',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
    });
    if (user.role === Role.EMPLOYEE) {
      const recipients = await this.prisma.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN] }, isActive: true, companyId: user.companyId },
        select: { id: true },
      });
      const employeeName = `${user.firstName} ${user.lastName}`.trim();
      const employeeLabel = user.employee?.employeeNo
        ? `${employeeName} (${user.employee.employeeNo})`
        : employeeName;
      await this.notifications.notifyMany(
        recipients.map((recipient) => ({
          userId: recipient.id,
          title: 'Employee signed in',
          message: `${employeeLabel} signed in to the employee app`,
          referenceType: 'user',
          referenceId: user.id,
        })),
      );
    }
    this.logger.log(JSON.stringify({ event: 'login', userId: user.id, role: user.role }));

    return {
      user: {
        ...pickUser(user),
        customerId: user.customer?.id,
        employeeId: user.employee?.id,
        managerId: user.manager?.id,
        lastLoginAt: new Date(),
      },
      tokens,
    };
  }

  async refresh(rawRefreshToken: string, context: { userAgent?: string; ipAddress?: string }): Promise<AuthResult> {
    let rotated: Awaited<ReturnType<TokenService['rotate']>>;
    try {
      rotated = await this.tokens.rotate(rawRefreshToken, context);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      if (reason === 'ACCOUNT_DISABLED') {
        throw new ForbiddenException('Account is deactivated');
      }
      if (reason === 'FIELD_APP_ACCESS_DENIED') {
        throw new ForbiddenException(
          'Only employees with Field Technician or Temp Staff designation can use the field app',
        );
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
    });
    const { userId: _ignored, ...pair } = rotated;
    return { user: pickUser(user), tokens: pair };
  }

  async logout(rawRefreshToken: string | undefined, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      await this.tokens.revoke(rawRefreshToken);
    } else if (userId) {
      await this.tokens.revokeAllForUser(userId);
    }
    if (userId) {
      await this.audit.log({
        action: 'LOGOUT',
        module: 'auth',
        entity: 'User',
        entityId: userId,
        userId,
      });
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({
      action: 'LOGOUT_ALL',
      module: 'auth',
      entity: 'User',
      entityId: userId,
      userId,
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Do not reveal whether the email exists.
    if (!user || !user.isActive) {
      this.logger.warn(JSON.stringify({ event: 'forgot_password_unknown_email' }));
      return;
    }

    const { otp, expiresAt } = await this.tokens.createPasswordResetOtp(user.id);
    try {
      await this.email.sendPasswordResetOtp({
        email: user.email,
        firstName: user.firstName,
        otp,
        expiresMinutes: 10,
      });
    } catch (error) {
      // Never log an OTP, reset token, or email address. The generic response
      // prevents account enumeration even when the SMTP provider is unavailable.
      this.logger.error(JSON.stringify({ event: 'password_reset_email_delivery_failed', userId: user.id, error: String(error) }));
    }
    await this.audit.log({
      action: 'PASSWORD_RESET_OTP_REQUESTED',
      module: 'auth',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
    });
  }

  async sendPasswordResetOtpForUser(userId: string, requestedById: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) throw new NotFoundException('Active customer account not found');
    if (!this.email.isConfigured()) {
      throw new ServiceUnavailableException('Email delivery is not configured. Set SMTP_HOST and SMTP_FROM, then restart the backend.');
    }

    const { otp } = await this.tokens.createPasswordResetOtp(user.id);
    try {
      await this.email.sendPasswordResetOtp({ email: user.email, firstName: user.firstName, otp, expiresMinutes: 10 });
    } catch (error) {
      await this.tokens.invalidatePasswordResetOtp(user.id);
      this.logger.error(JSON.stringify({ event: 'admin_password_reset_email_delivery_failed', userId: user.id, error: String(error) }));
      throw new ServiceUnavailableException('Email provider could not deliver the reset code. Check SMTP settings and backend logs.');
    }

    await this.audit.log({
      action: 'ADMIN_PASSWORD_RESET_OTP_SENT', module: 'auth', entity: 'User', entityId: user.id, userId: requestedById,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    let userId: string | null = null;
    if (dto.token) {
      userId = await this.tokens.consumePasswordResetToken(dto.token);
    } else if (dto.email && dto.otp) {
      const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
      if (user?.isActive && await this.tokens.consumePasswordResetOtp(user.id, dto.otp)) userId = user.id;
    }
    if (!userId) {
      throw new BadRequestException('Invalid or expired reset code');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({
      action: 'RESET_PASSWORD',
      module: 'auth',
      entity: 'User',
      entityId: userId,
      userId,
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const valid = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({
      action: 'CHANGE_PASSWORD',
      module: 'auth',
      entity: 'User',
      entityId: userId,
      userId,
    });
  }

  async me(userId: string): Promise<SafeUser & Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: { select: { id: true } },
        employee: { select: { id: true, employeeNo: true, designation: true, joiningDate: true } },
        manager: { select: { id: true, title: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    const { customer, employee, manager, ...safe } = user;
    return {
      ...pickUser(safe),
      customerId: customer?.id,
      employeeId: employee?.id,
      employee,
      managerId: manager?.id,
      manager,
    };
  }

  get accessTtl(): number {
    return (
      this.config.get<number>('jwt.accessTtl') ??
      this.config.get<number>('JWT_ACCESS_TTL') ??
      900
    );
  }
}
