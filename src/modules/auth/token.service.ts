import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { JwtPayload } from '../../common/types/auth.types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtl = config.get<number>('jwt.accessTtl') ?? 900;
    this.refreshTtl = config.get<number>('jwt.refreshTtl') ?? 604800;
  }

  async issuePair(
    user: User,
    context: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    } satisfies JwtPayload);

    const rawRefresh = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken: rawRefresh, expiresIn: this.accessTtl };
  }

  /**
   * Validates a refresh token and rotates it: the old record is revoked and a
   * brand new pair is issued (single-use refresh tokens).
   */
  async rotate(rawRefreshToken: string, context: { userAgent?: string; ipAddress?: string } = {}): Promise<TokenPair & { userId: string }> {
    const tokenHash = sha256(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    if (!record.user.isActive) {
      throw new Error('ACCOUNT_DISABLED');
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
    ]);

    const pair = await this.issuePair(record.user, context);
    await this.prisma.refreshToken.update({
      where: { tokenHash: sha256(pair.refreshToken) },
      data: {}, // touch row; nothing to change
    });
    return { ...pair, userId: record.user.id };
  }

  async revoke(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async createPasswordResetToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt },
    });
    return { token, expiresAt };
  }

  async consumePasswordResetToken(rawToken: string): Promise<string | null> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  /** Housekeeping: remove long-expired tokens (cron job). */
  async purgeExpiredTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    const resets = await this.prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count + resets.count;
  }
}
