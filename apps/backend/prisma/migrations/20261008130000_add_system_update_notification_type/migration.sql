-- Additive only: adds a notification type for system-update announcements. No data is modified.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SYSTEM_UPDATE';
