import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUser = {
  id: string;
  username: string;
  fullName: string | null;
  email: string;
  role: string;
  assignedTlId: string | null;
  isActive: boolean;
  isForcePasswordChange: boolean;
};

export async function verifyAccessToken(
  token: string,
  jwt: JwtService,
  redis: RedisService,
  prisma: PrismaService,
): Promise<AuthUser> {
  let payload: any;
  try {
    payload = jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET });
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }

  // Single-session enforcement: a newer login elsewhere overwrites the pointer.
  if (payload.sessionId && (await redis.getActiveSession(payload.sub)) !== payload.sessionId) {
    throw new UnauthorizedException('Session has been signed in elsewhere');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      role: true,
      assignedTlId: true,
      isActive: true,
      isForcePasswordChange: true,
    },
  });
  if (!user || !user.isActive) throw new UnauthorizedException('User account is inactive or deleted');
  return user as AuthUser;
}

export function accessTokenFromCookieHeader(header?: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === 'access_token') {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Socket handshakes: same checks as the HTTP guard, and no socket access while
// a forced password change is pending.
export async function authenticateSocket(
  cookieHeader: string | undefined,
  jwt: JwtService,
  redis: RedisService,
  prisma: PrismaService,
): Promise<AuthUser | null> {
  const token = accessTokenFromCookieHeader(cookieHeader);
  if (!token) return null;
  try {
    const user = await verifyAccessToken(token, jwt, redis, prisma);
    return user.isForcePasswordChange ? null : user;
  } catch {
    return null;
  }
}
