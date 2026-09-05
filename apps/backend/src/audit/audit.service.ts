import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

interface AuditLogParams {
  actorId: string;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string;
  targetUserId?: string;
  details?: any;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: AuditLogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId,
          action: params.action as AuditAction,
          targetType: params.targetType,
          targetId: params.targetId,
          targetUserId: params.targetUserId,
          details: params.details || {},
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (error) {
      // Audit logging should never break the main flow
      console.error('Audit log failed:', error);
    }
  }
}
