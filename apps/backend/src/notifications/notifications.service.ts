import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { readEffectiveSettings } from '../settings/settings.store';
import { roleReceives } from './notification-types';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** The Admin's per-role notification switches, read fresh so a change applies to the very next notification. */
  private async roleRules() {
    return (await readEffectiveSettings(this.prisma)).settings.notifications.roleRules;
  }

  /**
   * Creates one notification, unless the Admin has switched this type off for the recipient's role (an Admin
   * recipient always gets it). Returns null when it was skipped.
   */
  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    relatedId?: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.userId }, select: { role: true } });
    if (!user || !roleReceives(await this.roleRules(), data.type, user.role)) return null;
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
      select: { id: true, role: true },
    });
    const rules = await this.roleRules();

    const notifications = adminsAndTLs.filter((user) => roleReceives(rules, data.type, user.role)).map((user) =>
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
      select: { id: true, role: true },
    });
    const rules = await this.roleRules();

    const notifications = activeUsers.filter((user) => roleReceives(rules, data.type, user.role)).map((user) =>
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
