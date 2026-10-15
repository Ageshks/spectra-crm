import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser, JwtPayload } from '../../../common/types/auth.types';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:
        config.get<string>('jwt.accessSecret') ??
        config.get<string>('JWT_ACCESS_SECRET') ??
        (() => {
          throw new Error('JWT_ACCESS_SECRET is not configured');
        })(),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        customer: { select: { id: true } },
        employee: { select: { id: true } },
        manager: { select: { id: true } },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is unavailable');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      customerId: user.customer?.id,
      employeeId: user.employee?.id,
      managerId: user.manager?.id,
    };
  }
}
