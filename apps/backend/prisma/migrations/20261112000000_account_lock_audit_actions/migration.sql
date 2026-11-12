-- Audit events for temporary account locks. Additive only: existing rows and values are untouched.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_LOCKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_LOCK_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_UNLOCKED';
