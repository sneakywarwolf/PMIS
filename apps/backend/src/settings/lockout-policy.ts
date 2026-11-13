import { LOCKOUT_LIMITS } from './settings.defaults';

export interface LockoutPolicy {
  maxAttempts: number;
  durationMinutes: number;
}

const pick = (v: unknown, lim: { min: number; max: number; fallback: number }): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lim.min && v <= lim.max ? v : lim.fallback;

/**
 * The temporary-lock policy for the next lock, from the effective settings. Always usable: a missing, malformed or out-of-range
 * value is replaced by the safe default, so no stored or absent configuration can switch the protection off. Locks that already
 * exist keep the expiry they were created with (see AccountLockService).
 */
export function resolveLockoutPolicy(settings: { security?: { lockoutMaxAttempts?: unknown; lockoutDurationMinutes?: unknown } } | null | undefined): LockoutPolicy {
  return {
    maxAttempts: pick(settings?.security?.lockoutMaxAttempts, LOCKOUT_LIMITS.maxAttempts),
    durationMinutes: pick(settings?.security?.lockoutDurationMinutes, LOCKOUT_LIMITS.durationMinutes),
  };
}

export const SAFE_LOCKOUT_POLICY: LockoutPolicy = { maxAttempts: LOCKOUT_LIMITS.maxAttempts.fallback, durationMinutes: LOCKOUT_LIMITS.durationMinutes.fallback };
