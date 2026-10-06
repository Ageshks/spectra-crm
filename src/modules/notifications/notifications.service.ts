import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../../queues/queues.module';
import { ListNotificationsDto } from './dto/notifications.dto';

export interface NotifyInput {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  /** Deep-link reference: e.g. referenceType='booking', referenceId=<booking id> */
  referenceType?: string;
  referenceId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  /** Persists an in-app notification and enqueues FCM delivery. */
  async notify(input: NotifyInput): Promise<string> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type ?? NotificationType.GENERAL,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });
    await this.queues.enqueuePush({
      notificationId: notification.id,
      userId: input.userId,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    return notification.id;
  }

  async notifyMany(inputs: NotifyInput[]): Promise<void> {
    for (const input of inputs) {
      await this.notify(input);
    }
  }

  async list(userId: string, query: ListNotificationsDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<unknown> {
    const existing = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }
}
