import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    relatedId?: string;
  }) {
    return this.prisma.notification.create({ data });
  }

  async findByUser(userId: string, unreadOnly?: boolean) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, read: false },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async notifyAdminsAndTLs(data: {
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    relatedId?: string;
    excludeUserId?: string;
  }) {
    const adminsAndTLs = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['ADMIN', 'AVP', 'TEAM_LEAD'] },
        ...(data.excludeUserId ? { id: { not: data.excludeUserId } } : {}),
      },
      select: { id: true },
    });

    const notifications = adminsAndTLs.map((user) =>
      this.prisma.notification.create({
        data: {
          userId: user.id,
          type: data.type,
          title: data.title,
          message: data.message,
          linkUrl: data.linkUrl,
          relatedId: data.relatedId,
        },
      }),
    );

    await Promise.all(notifications);
  }

  async notifyAllActiveUsers(data: {
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    relatedId?: string;
  }) {
    const activeUsers = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    const notifications = activeUsers.map((user) =>
      this.prisma.notification.create({
        data: {
          userId: user.id,
          type: data.type,
          title: data.title,
          message: data.message,
          linkUrl: data.linkUrl,
          relatedId: data.relatedId,
        },
      }),
    );

    await Promise.all(notifications);
  }
}
