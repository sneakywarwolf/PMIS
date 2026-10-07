-- Code already logs these actions, but they were missing from the enum, so AuditService silently dropped the entries.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_RETENTION_PURGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEMPLATE_FIELD_ADDED';
