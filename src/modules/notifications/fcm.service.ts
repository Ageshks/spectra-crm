import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevicePlatform } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

/**
 * Firebase Cloud Messaging. The Firebase app is initialised lazily so the API
 * can boot (and the test suite run) without credentials. When Firebase is not
 * configured, deliveries degrade gracefully to in-app notifications only.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private app: import('firebase-admin/app').App | null = null;
  private initFailed = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const firebase = config.get<AppConfig['firebase']>('firebase');
    if (firebase?.projectId && firebase.clientEmail && firebase.privateKey) {
      void this.initialise(firebase);
    } else {
      this.logger.warn('Firebase is not configured — push delivery disabled');
    }
  }

  private async initialise(firebase: NonNullable<AppConfig['firebase']>): Promise<void> {
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      if (getApps().length === 0) {
        this.app = initializeApp({
          credential: cert({
            projectId: firebase.projectId,
            clientEmail: firebase.clientEmail,
            privateKey: firebase.privateKey,
          }),
        });
      } else {
        this.app = getApps()[0] ?? null;
      }
      void getMessaging;
    } catch (error) {
      this.initFailed = true;
      this.logger.error(
        `Firebase initialisation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<number> {
    if (!this.app || this.initFailed) return 0;
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { id: true, token: true },
    });
    if (tokens.length === 0) return 0;

    try {
      const { getMessaging } = await import('firebase-admin/messaging');
      const response = await getMessaging().sendEachForMulticast({
        tokens: tokens.map((t) => t.token),
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      });

      const invalidIndices = response.responses
        .map((r, index) => (r.success ? -1 : index))
        .filter((index) => index >= 0);
      if (invalidIndices.length > 0) {
        await this.prisma.deviceToken.updateMany({
          where: { id: { in: invalidIndices.map((i) => tokens[i]?.id).filter(Boolean) } },
          data: { isActive: false },
        });
      }
      await this.prisma.deviceToken.updateMany({
        where: { id: { in: tokens.map((t) => t.id) } },
        data: { lastUsedAt: new Date() },
      });
      return response.successCount;
    } catch (error) {
      this.logger.error(
        `FCM send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  async registerDevice(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName?: string,
  ): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform, deviceName },
      update: { isActive: true, lastUsedAt: new Date(), deviceName: deviceName ?? undefined, platform },
    });
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
  }

  async listDevices(userId: string): Promise<unknown> {
    return this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, platform: true, deviceName: true, lastUsedAt: true, createdAt: true },
    });
  }
}
