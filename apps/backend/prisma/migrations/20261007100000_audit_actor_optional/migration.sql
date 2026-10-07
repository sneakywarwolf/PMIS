-- Keep audit entries after their acting user is permanently purged: actor becomes NULL instead of blocking/deleting the row.
ALTER TABLE "audit_logs" ALTER COLUMN "actor_id" DROP NOT NULL;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
