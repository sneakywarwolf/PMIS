-- Additive and backward-safe: no existing rows are changed. Existing findings keep their vuln_id.
-- Project-scoped vulnerability records (Nessus import) live in their own table, separate from "vulnerabilities".

CREATE TABLE "project_vulnerabilities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'nessus',
    "source_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cvss_score" DOUBLE PRECISION,
    "cvss_vector" TEXT,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "references" TEXT NOT NULL,
    "cve_id" TEXT,
    "cwe_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_vulnerabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_vulnerabilities_project_id_source_source_key_key"
    ON "project_vulnerabilities"("project_id", "source", "source_key");

ALTER TABLE "project_vulnerabilities"
    ADD CONSTRAINT "project_vulnerabilities_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "findings" ALTER COLUMN "vuln_id" DROP NOT NULL;
ALTER TABLE "findings" ADD COLUMN "project_vuln_id" TEXT;
ALTER TABLE "findings"
    ADD CONSTRAINT "findings_project_vuln_id_fkey"
    FOREIGN KEY ("project_vuln_id") REFERENCES "project_vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A finding points at exactly one source of vulnerability data.
ALTER TABLE "findings" ADD CONSTRAINT "findings_one_vuln_source"
    CHECK (("vuln_id" IS NOT NULL) <> ("project_vuln_id" IS NOT NULL));
