import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { ProjectPurgeService } from '../common/project-purge.service';
import { validateCsvHeaders, parseCsv } from '../common/csv-validation.util';
import { User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/auth.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private settingsService: SettingsService,
    private projectPurge: ProjectPurgeService,
  ) {}

  async findAll(requestingUser: User) {
    const where: any = {
      // Deleted users stay visible for a 24h grace period (undo via
      // Activate), then drop out of the list entirely.
      OR: [{ deletedAt: null }, { deletedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }],
    };

    if (requestingUser.role === UserRole.TEAM_LEAD || requestingUser.role === UserRole.AVP) {
      where.assignedTlId = requestingUser.id;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
        designation: true,
        assignedTlId: true,
        managerId: true,
        isActive: true,
        isForcePasswordChange: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  async findOne(id: string, requestingUser: User) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
        designation: true,
        assignedTlId: true,
        managerId: true,
        isActive: true,
        isForcePasswordChange: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (requestingUser.role === UserRole.TEAM_LEAD || requestingUser.role === UserRole.AVP) {
      if (user.role !== UserRole.TESTER || user.assignedTlId !== requestingUser.id) {
        throw new NotFoundException('User not found');
      }
    }

    return user;
  }

  async create(dto: CreateUserDto, adminId: string, ipAddress: string, userAgent: string) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.email }],
      },
    });

    if (existing) {
      throw new BadRequestException('Username or email already exists');
    }

    if (dto.role === UserRole.TESTER && dto.assignedTlId) {
      const tl = await this.prisma.user.findUnique({
        where: { id: dto.assignedTlId },
      });
      if (!tl || (tl.role !== UserRole.TEAM_LEAD && tl.role !== UserRole.AVP)) {
        throw new BadRequestException('Invalid team lead assignment');
      }
    }

    const policyErrors = await this.settingsService.validatePassword(dto.password);
    if (policyErrors.length > 0) {
      throw new BadRequestException(policyErrors.join('; '));
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        role: dto.role,
        fullName: dto.fullName,
        phone: dto.phone,
        designation: dto.designation,
        assignedTlId: dto.role === UserRole.TESTER ? dto.assignedTlId : null,
        managerId: dto.managerId || null,
        isForcePasswordChange: true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        fullName: true,
        assignedTlId: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: user.id,
      ipAddress,
      userAgent,
      details: { username: user.username, role: user.role },
    });

    // Notify new user
    await this.notificationsService.create({
      userId: user.id,
      type: 'USER_CREATED',
      title: 'Welcome to STT',
      message: `Your account has been created with role: ${user.role}. Please login and change your password.`,
    });

    // Notify admins/TLs
    await this.notificationsService.notifyAdminsAndTLs({
      type: 'USER_CREATED',
      title: 'New User Created',
      message: `User "${user.username}" (${user.role}) was created by admin.`,
      relatedId: user.id,
      excludeUserId: adminId,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, adminId: string, ipAddress: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check for duplicate username/email on other users
    if (dto.username || dto.email) {
      const duplicate = await this.prisma.user.findFirst({
        where: {
          OR: [
            ...(dto.username ? [{ username: dto.username }] : []),
            ...(dto.email ? [{ email: dto.email }] : []),
          ],
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new BadRequestException('Username or email already exists');
      }
    }

    const updateData: any = {};
    if (dto.username) updateData.username = dto.username;
    if (dto.email) updateData.email = dto.email;
    if (dto.role) updateData.role = dto.role;
    if (dto.assignedTlId !== undefined) {
      if (dto.role === UserRole.TESTER || user.role === UserRole.TESTER) {
        updateData.assignedTlId = dto.assignedTlId || null;
      }
    }
    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.designation !== undefined) updateData.designation = dto.designation;
    if (dto.managerId !== undefined) updateData.managerId = dto.managerId || null;
    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
      if (dto.isActive) updateData.deletedAt = null;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
        designation: true,
        assignedTlId: true,
        managerId: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'USER_UPDATED',
      targetType: 'USER',
      targetId: id,
      ipAddress,
      userAgent,
      details: updateData,
    });

    // Notify the user whose profile was updated
    await this.notificationsService.create({
      userId: id,
      type: 'USER_UPDATED',
      title: 'Profile Updated',
      message: `Your profile was updated by an admin.`,
    });

    return updated;
  }

  async forcePasswordReset(userId: string, adminId: string, ipAddress: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const tempPassword = this.generateSecurePassword();
    const passwordHash = await argon2.hash(tempPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        isForcePasswordChange: true,
      },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'ADMIN_OVERRIDE',
      targetType: 'USER',
      targetId: userId,
      ipAddress,
      userAgent,
      details: { action: 'password_reset' },
    });

    return { tempPassword };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignedTl: { select: { id: true, username: true, fullName: true } },
        manager: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      designation: user.designation,
      teamLead: user.assignedTl,
      manager: user.manager,
      isForcePasswordChange: user.isForcePasswordChange,
    };
  }

  async updateProfile(userId: string, dto: { fullName?: string; phone?: string; designation?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.designation !== undefined && { designation: dto.designation }),
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phone: true,
        designation: true,
      },
    });
  }

  async softDelete(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ownedProjects = await this.prisma.project.findMany({
      where: { testerId: id },
      include: {
        reportGenerations: true,
        findings: { include: { pocSteps: true } },
      },
    });

    let filesDeleted = 0;
    for (const project of ownedProjects) {
      const result = await this.projectPurge.purgeProject(project);
      filesDeleted += result.filesDeleted;
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'USER_DELETED',
      targetType: 'USER',
      targetId: id,
      ipAddress,
      userAgent,
      details: { projectsDeleted: ownedProjects.length, filesDeleted },
    });

    return {
      message: 'User deleted successfully',
      projectsDeleted: ownedProjects.length,
    };
  }

  async getTeamHierarchy() {
    const teamLeads = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.TEAM_LEAD, UserRole.AVP] }, isActive: true },
      select: {
        id: true,
        username: true,
        email: true,
        testers: {
          where: { isActive: true },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return teamLeads;
  }

  async getTeamLeads() {
    return this.prisma.user.findMany({
      where: { role: { in: [UserRole.TEAM_LEAD, UserRole.AVP] }, isActive: true },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
      },
      orderBy: { username: 'asc' },
    });
  }

  async getManagers() {
    return this.prisma.user.findMany({
      where: { role: UserRole.AVP, isActive: true },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
      },
      orderBy: { username: 'asc' },
    });
  }

  private generateSecurePassword(): string {
    const length = 20;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }
    return password;
  }

  // ─── Bulk Upload ───

  private readonly USER_CSV_HEADERS = ['S.No', 'Full Name', 'Email', 'Mobile', 'Designation', 'Role', 'Team Lead', 'Manager'];

  getSampleCsv(): string {
    const headers = this.USER_CSV_HEADERS.join(',');
    const sampleRow = [
      '1',
      'John Doe',
      'john.doe@example.com',
      '+91-9876543210',
      'Senior Security Analyst',
      'Tester',
      'Alice Smith',
      'Bob Johnson',
    ].map(v => this.escapeCsv(v)).join(',');
    return `${headers}\n${sampleRow}\n`;
  }

  async bulkUpload(csvContent: string, adminId: string, ipAddress: string, userAgent: string) {
    const allRows = parseCsv(csvContent.trim());
    if (allRows.length < 2) {
      throw new BadRequestException('CSV file is empty or missing data rows.');
    }

    const headers = allRows[0].map(h => h.trim());

    // Validate headers by name before reading any data row — order doesn't
    // matter since `get()` below looks columns up by header name.
    validateCsvHeaders(headers, this.USER_CSV_HEADERS);
    const normalize = (h: string) => h.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');

    const get = (expectedHeader: string, cols: string[]) => {
      const idx = headers.findIndex(h => normalize(h) === normalize(expectedHeader));
      return idx >= 0 ? cols[idx]?.trim() : '';
    };

    // Pre-fetch all active users for name lookups
    const allUsers = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, username: true, email: true, role: true },
    });

    const allExistingEmails = new Set(allUsers.map(u => u.email.toLowerCase()));
    const allExistingUsernames = new Set(allUsers.map(u => u.username.toLowerCase()));

    const results = { added: 0, skipped: 0, errors: [] as string[] };

    for (let i = 1; i < allRows.length; i++) {
      const cols = allRows[i];
      if (cols.length === 1 && cols[0].trim() === '') continue; // blank line

      if (cols.length > headers.length) {
        results.errors.push(`Row ${i + 1}: has ${cols.length} column(s) but the header row has ${headers.length}. Check for an unescaped comma or unquoted value in that row.`);
        continue;
      }
      // Excel/Sheets often drop trailing commas for empty trailing cells —
      // pad those back out rather than rejecting a row that's only short
      // at the end.
      while (cols.length < headers.length) cols.push('');
      const fullName = get('Full Name', cols);
      const email = get('Email', cols);
      const mobile = get('Mobile', cols);
      const designation = get('Designation', cols);
      const roleStr = get('Role', cols);
      const tlName = get('Team Lead', cols);
      const managerName = get('Manager', cols);

      const requiredFields: [string, string][] = [['Full Name', fullName], ['Email', email], ['Role', roleStr]];
      const emptyFields = requiredFields.filter(([, value]) => !value).map(([label]) => label);
      if (emptyFields.length > 0) {
        results.errors.push(`Row ${i + 1}: Missing required field(s): ${emptyFields.join(', ')}.`);
        continue;
      }

      // Skip if email already exists
      if (allExistingEmails.has(email.toLowerCase())) {
        results.skipped++;
        continue;
      }

      // Map role
      const role = this.mapRole(roleStr);
      if (!role) {
        results.errors.push(`Row ${i + 1}: Invalid role "${roleStr}". Valid: Admin, AVP, Team Lead, Tester.`);
        continue;
      }

      // Generate username from email prefix
      let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      let originalUsername = username;
      let suffix = 1;
      while (allExistingUsernames.has(username.toLowerCase())) {
        username = `${originalUsername}${suffix}`;
        suffix++;
      }
      allExistingUsernames.add(username.toLowerCase());

      // Look up TL by full name (case-insensitive, active, role TEAM_LEAD or AVP)
      let assignedTlId: string | null = null;
      if (tlName) {
        const tl = allUsers.find(u =>
          u.fullName?.toLowerCase() === tlName.toLowerCase() &&
          (u.role === UserRole.TEAM_LEAD || u.role === UserRole.AVP)
        );
        if (tl) assignedTlId = tl.id;
      }

      // Look up Manager by full name (case-insensitive, active, role AVP)
      let managerId: string | null = null;
      if (managerName) {
        const mgr = allUsers.find(u =>
          u.fullName?.toLowerCase() === managerName.toLowerCase() &&
          u.role === UserRole.AVP
        );
        if (mgr) managerId = mgr.id;
      }

      const password = this.generateSecurePassword();
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      try {
        await this.prisma.user.create({
          data: {
            username,
            email,
            passwordHash,
            role,
            fullName,
            phone: mobile || null,
            designation: designation || null,
            assignedTlId: role === UserRole.TESTER ? assignedTlId : null,
            managerId,
            isForcePasswordChange: true,
          },
        });
        results.added++;
      } catch (error: any) {
        results.errors.push(`Row ${i + 1}: ${error.message || 'Failed to create user'}`);
      }
    }

    // Audit log
    if (results.added > 0) {
      await this.auditService.log({
        actorId: adminId,
        action: 'ADMIN_OVERRIDE',
        targetType: 'USER',
        ipAddress,
        userAgent,
        details: { action: 'bulk_upload', added: results.added, skipped: results.skipped },
      });
    }

    return results;
  }

  private mapRole(roleStr: string): UserRole | null {
    const normalized = roleStr.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');
    if (normalized === 'admin') return UserRole.ADMIN;
    if (normalized === 'avp') return UserRole.AVP;
    if (normalized === 'teamlead' || normalized === 'tl') return UserRole.TEAM_LEAD;
    if (normalized === 'tester') return UserRole.TESTER;
    return null;
  }

  private escapeCsv(value: string): string {
    if (!value) return '';
    // Neutralize CSV/formula injection — a leading =, +, -, @, tab, or CR is
    // interpreted as a formula by Excel/Sheets when the file is reopened.
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    const needsQuotes = /[",\n]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  }
}
