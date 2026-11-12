import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * For actions that must stay with Admins and can never be delegated through Settings > RBAC (unlocking accounts, for one: a role that
 * could unlock itself or its accomplices would undo the lockout). It checks the role itself, on the server, on every request, and
 * refuses anything else, including a request with no signed-in user. The global JWT guard has already authenticated the caller by then.
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (user?.role !== 'ADMIN') throw new ForbiddenException('Only an Admin can do this');
    return true;
  }
}
