import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_PERMISSION_MATRIX, PERMISSION_KEYS, PermissionMatrix } from './permission-catalog';

/**
 * The role-by-feature matrix in force (Settings > RBAC). SettingsService loads it at start-up and on every save, so a
 * change applies to the very next request. Until then the defaults apply, which are the rules PMIS shipped with.
 */
let matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX;

export const permissionRules = {
  set(next: PermissionMatrix | undefined) {
    matrix = next ?? DEFAULT_PERMISSION_MATRIX;
  },
  /** Admins always may; a feature or role missing from the saved matrix falls back to the default. */
  can(role: string | undefined, key: string): boolean {
    if (role === 'ADMIN') return true;
    if (!role) return false;
    const v = matrix[key]?.[role as 'AVP'];
    if (typeof v === 'boolean') return v;
    return DEFAULT_PERMISSION_MATRIX[key]?.[role as 'AVP'] ?? false;
  },
  /** Everything the role may do, for the front end. */
  forRole(role: string | undefined): Record<string, boolean> {
    return Object.fromEntries([...PERMISSION_KEYS].map((k) => [k, this.can(role, k)]));
  },
};

export const PERMISSION_KEY = 'permission';

/** Marks an endpoint as the feature `key`: only roles the Admin allowed in Settings > RBAC may call it. */
export const Permission = (key: string) => {
  if (!PERMISSION_KEYS.has(key)) throw new Error(`Unknown permission "${key}"`);
  return SetMetadata(PERMISSION_KEY, key);
};

/** Throws 403 unless the role may use the feature. For checks inside services. */
export function assertCan(user: { role?: string } | undefined, key: string, message?: string) {
  if (!permissionRules.can(user?.role, key)) {
    throw new ForbiddenException(message ?? 'Your role is not allowed to do this. Ask an Admin if you need access.');
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!key) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Authentication required');
    if (!permissionRules.can(user.role, key)) {
      throw new ForbiddenException('Your role is not allowed to use this feature. Ask an Admin if you need access.');
    }
    return true;
  }
}
