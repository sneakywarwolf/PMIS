import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DigestConfigService } from './digest-config.service';

export const ADMIN_ONLY_KEY = 'cyberdigest:adminOnly';

/** Marks a route as Administrator-only (everything that is not plain reading of published content). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

/**
 * The one authorization rule for the whole module, enforced on the server for every request:
 *  - Administrators may do everything, even when the module is switched off for others.
 *  - Everyone else is a read-only consumer: GET only, only on routes not marked AdminOnly, and only while the
 *    administrator's "available to non-administrators" switch is on. The switch is read from the database on every
 *    request, so turning it off takes effect on the very next call, for every session.
 *  - There is no per-user or per-role setting that can widen this.
 * Runs after the global login guard, so `req.user` is the authenticated account.
 */
@Injectable()
export class CyberdigestAccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private config: DigestConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.role === 'ADMIN') return true;
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [ctx.getHandler(), ctx.getClass()])) throw new ForbiddenException('Administrators only');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ForbiddenException('Cyberdigest is read-only for your role');
    if (!(await this.config.moduleEnabledForNonAdmins())) throw new ForbiddenException('Cyberdigest is not available');
    return true;
  }
}
