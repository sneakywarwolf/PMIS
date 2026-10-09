-- Additive only: adds a notification type for project (re)assignment. No data is modified.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_ASSIGNED';
