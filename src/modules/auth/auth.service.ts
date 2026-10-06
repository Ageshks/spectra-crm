import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { PrismaService } from '../../database/prisma.service';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';
import { pickUser, SafeUser } from '../../common/utils/user.util';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { TokenService, TokenPair } from './token.service';

export interface AuthResult {
  user: SafeUser;
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
  ) {}

  async register(dto: RegisterDto): Promise<SafeUser> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        passwordHash,
        role: Role.CUSTOMER,
        isVerified: false,
        customer: { create: {} },
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
    this.logger.log(JSON.stringify({ event: 'login', userId: user.id, role: user.role }));

    return { user: { ...pickUser(user), lastLoginAt: new Date() }, tokens };
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

    const { token, expiresAt } = await this.tokens.createPasswordResetToken(user.id);
    // No SMTP provider is in this stack; the reset link is surfaced through the
    // structured log — swap in a mailer worker at this point for production email.
    this.logger.warn(
      JSON.stringify({
        event: 'password_reset_requested',
        userId: user.id,
        resetToken: token,
        expiresAt: expiresAt.toISOString(),
      }),
    );
    await this.audit.log({
      action: 'FORGOT_PASSWORD',
      module: 'auth',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.tokens.consumePasswordResetToken(dto.token);
    if (!userId) {
      throw new BadRequestException('Invalid or expired reset token');
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
    return this.config.get<number>('jwt.accessTtl') ?? 900;
  }
}
