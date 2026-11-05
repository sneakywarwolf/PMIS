-- PMIS baseline migration.
-- Replaces the 61 incremental migrations (2026-08-29 .. 2026-11-06) that preceded the first production release.
-- Generated from prisma/schema.prisma and verified to produce a database structurally identical to the one those
-- migrations produced (prisma migrate diff: no difference). It contains no seed data: the admin user and the
-- vulnerability library are created by `prisma db seed`, Cyberdigest sources and settings by the application.
-- Never edit this file once released. Every later schema change is a NEW migration folder after this one.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VulnerabilityCategory" AS ENUM ('APPLICATION_API', 'NETWORK');

-- CreateEnum
CREATE TYPE "VulnerabilityStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'TEAM_ASSIGNED', 'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_REASSIGNED', 'PROJECT_SUBMITTED', 'PROJECT_APPROVED', 'PROJECT_REJECTED', 'REPORT_GENERATED', 'REPORT_DELETED', 'PROJECT_DELETED', 'PROJECT_RETENTION_DELETED', 'ATTACHMENT_RETENTION_DELETED', 'USER_RETENTION_PURGED', 'TEMPLATE_FIELD_ADDED', 'TEMPLATE_UPLOADED', 'TEMPLATE_ACTIVATED', 'TEMPLATE_DEACTIVATED', 'TEMPLATE_DELETED', 'VULNERABILITY_REQUESTED', 'VULNERABILITY_APPROVED', 'VULNERABILITY_REJECTED', 'VULNERABILITY_CREATED', 'VULNERABILITY_UPDATED', 'VULNERABILITY_DELETED', 'SETTINGS_UPDATED', 'ADMIN_OVERRIDE', 'QUIZ_QUESTION_CREATED', 'QUIZ_QUESTION_UPDATED', 'QUIZ_QUESTION_DELETED', 'CYBERDIGEST_EVIDENCE_ADDED', 'CYBERDIGEST_EVIDENCE_RETRACTED', 'CYBERDIGEST_ZERODAY_TRANSITION', 'CYBERDIGEST_ZERODAY_APPROVED', 'CYBERDIGEST_ZERODAY_WITHDRAWN', 'CYBERDIGEST_STORY_APPROVED', 'CYBERDIGEST_STORY_REJECTED', 'CYBERDIGEST_STORY_CORRECTED', 'CYBERDIGEST_SOURCE_UPDATED', 'CYBERDIGEST_DIGEST_GENERATED', 'CYBERDIGEST_DIGEST_PUBLISHED', 'CYBERDIGEST_DIGEST_WITHDRAWN', 'CYBERDIGEST_CONFIG_UPDATED', 'CYBERDIGEST_ALLOWLIST_CHANGED', 'CYBERDIGEST_SOURCE_ADDED', 'CYBERDIGEST_BULK_APPROVED');

-- CreateEnum
CREATE TYPE "ComplianceType" AS ENUM ('VAPT', 'CERT_IN', 'PCI', 'ASV');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('PCI', 'VAPT', 'CERT_IN', 'ASV');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('WORD', 'EXCEL');

-- CreateEnum
CREATE TYPE "TemplateSubType" AS ENUM ('WEB', 'API', 'MOBILE', 'THICK_CLIENT', 'NETWORK', 'APPLICATION', 'SCR');

-- CreateEnum
CREATE TYPE "TemplateFieldCategory" AS ENUM ('PROJECT_INFO', 'VULNERABILITY', 'CONTACT', 'DATE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('USER_CREATED', 'USER_UPDATED', 'VULNERABILITY_REQUESTED', 'VULNERABILITY_APPROVED', 'VULNERABILITY_REJECTED', 'VULNERABILITY_EDITED', 'VULNERABILITY_CHANGE_REQUESTED', 'VULNERABILITY_CHANGE_APPROVED', 'VULNERABILITY_CHANGE_REJECTED', 'QUIZ_QUESTION_LIVE', 'QUIZ_ANSWER_REVEALED', 'SYSTEM_UPDATE', 'PROJECT_ASSIGNED', 'CYBERDIGEST_DIGEST', 'CYBERDIGEST_SOURCE_DOWN');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'REVEALED');

-- CreateEnum
CREATE TYPE "QuizBadge" AS ENUM ('FIRST_CORRECT', 'STREAK_5', 'STREAK_10', 'STREAK_30', 'ANSWERED_50', 'ANSWERED_100', 'PERFECT_WEEK');

-- CreateEnum
CREATE TYPE "DigestSourceType" AS ENUM ('NEWS_RSS', 'RESEARCH_RSS', 'CVE_API', 'NVD_API', 'KEV_JSON');

-- CreateEnum
CREATE TYPE "DigestSourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'STALE', 'FAILING');

-- CreateEnum
CREATE TYPE "DigestVerificationState" AS ENUM ('PENDING', 'ATTRIBUTED', 'VERIFIED', 'CONFLICTING', 'REJECTED', 'SOURCE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DigestCveRecordStatus" AS ENUM ('PUBLISHED', 'RESERVED', 'REJECTED', 'NOT_FOUND', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DigestNvdEnrichment" AS ENUM ('PENDING', 'ENRICHED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DigestZeroDayState" AS ENUM ('CONFIRMED', 'REPORTED_UNVERIFIED', 'KNOWN_EXPLOITED_UNCONFIRMED', 'NOT_SUBSTANTIATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DigestIssueStatus" AS ENUM ('SHADOW', 'PUBLISHED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "assigned_tl_id" TEXT,
    "manager_id" TEXT,
    "full_name" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "quiz_team_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "is_force_password_change" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret" TEXT,
    "is_totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "scope" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "start_date_changed_at" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "compliance_status" TEXT DEFAULT 'In-Progress',
    "compliance_type" "ComplianceType",
    "tester_id" TEXT NOT NULL,
    "tl_id" TEXT NOT NULL,
    "template_id" TEXT,
    "category" "TemplateCategory" NOT NULL DEFAULT 'VAPT',
    "sub_type" "TemplateSubType" NOT NULL DEFAULT 'WEB',
    "app_version" TEXT,
    "location" TEXT,
    "client_spoc_name" TEXT,
    "client_spoc_designation" TEXT,
    "client_spoc_email" TEXT,
    "document_version" TEXT,
    "tools_used" TEXT,
    "testing_environment" TEXT,
    "qa_reviewer_name" TEXT,
    "application_details" TEXT,
    "testing_type" TEXT,
    "login_system_types" TEXT,
    "application_nature" TEXT,
    "testing_limitation" TEXT,
    "mobile_platform" TEXT,
    "sha1" TEXT,
    "code_location" TEXT,
    "system_username" TEXT,
    "system_hostname" TEXT,
    "external_internal" TEXT,
    "network_activity_type" TEXT,
    "total_scope_count" INTEGER,
    "network_scope" JSONB,
    "quarter" TEXT,
    "nmap_ports" JSONB,
    "site_map" JSONB,
    "tools_used_table" JSONB,
    "report_version_counter" INTEGER NOT NULL DEFAULT 0,
    "custom_field_values" JSONB,
    "report_docx_path" TEXT,
    "report_pdf_path" TEXT,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_changes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "original_file_name" TEXT,
    "file_hash" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL DEFAULT 'VAPT',
    "sub_type" "TemplateSubType" NOT NULL DEFAULT 'WEB',
    "extra_sub_types" "TemplateSubType"[] DEFAULT ARRAY[]::"TemplateSubType"[],
    "project_type" TEXT NOT NULL,
    "report_format" "ReportFormat" NOT NULL DEFAULT 'WORD',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_fields" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "field_category" "TemplateFieldCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "is_repeatable" BOOLEAN NOT NULL DEFAULT false,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "mapped_parameter" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_generations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "generated_by" TEXT NOT NULL,
    "field_data" JSONB NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" "ReportGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "docx_path" TEXT,
    "pdf_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerabilities" (
    "id" TEXT NOT NULL,
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
    "source" TEXT NOT NULL DEFAULT 'internal',
    "category" "VulnerabilityCategory" NOT NULL DEFAULT 'APPLICATION_API',
    "status" "VulnerabilityStatus" NOT NULL DEFAULT 'APPROVED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requested_by" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerability_change_requests" (
    "id" TEXT NOT NULL,
    "vulnerability_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "target_tl_id" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "before_data" JSONB NOT NULL,
    "after_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vulnerability_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "vuln_id" TEXT,
    "project_vuln_id" TEXT,
    "evidence_paths" TEXT[],
    "tester_notes" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'DRAFT',
    "affected_instances" TEXT[],
    "authentication_type" TEXT,
    "proof_of_concept" TEXT,
    "vulnerability_dependency" TEXT,
    "report_status" TEXT NOT NULL DEFAULT 'Open',
    "cvss_score_override" DOUBLE PRECISION,
    "cvss_vector_override" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_vulnerabilities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'nessus',
    "source_key" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'VA Finding',
    "name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cvss_score" DOUBLE PRECISION,
    "cvss_vector" TEXT,
    "cvss_vector_source" TEXT,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "references" TEXT NOT NULL,
    "cve_id" TEXT,
    "cwe_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poc_steps" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "step_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "image_path" TEXT,
    "extra_image_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "target_user_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "link_url" TEXT,
    "related_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "QuizStatus" NOT NULL DEFAULT 'SCHEDULED',
    "revealedAt" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "selectedOption" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_late" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_user_stats" (
    "user_id" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastAnsweredOn" TIMESTAMP(3),
    "badges" "QuizBadge"[],

    CONSTRAINT "quiz_user_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "pattern_map_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rounds_cleared" INTEGER NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pattern_map_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DigestSourceType" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "trustRole" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pollIntervalMinutes" INTEGER NOT NULL,
    "health" "DigestSourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "lastModified" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRawItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DigestRawItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestStory" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "dedupKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT,
    "cveIds" TEXT[],
    "groupId" TEXT,
    "verificationState" "DigestVerificationState" NOT NULL DEFAULT 'PENDING',
    "rawItemId" TEXT,
    "categories" TEXT[],
    "stateNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DigestStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestCve" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "recordStatus" "DigestCveRecordStatus" NOT NULL,
    "description" TEXT,
    "assigner" TEXT,
    "recordPublishedAt" TIMESTAMP(3),
    "recordUpdatedAt" TIMESTAMP(3),
    "affected" JSONB,
    "references" JSONB,
    "cvss" JSONB,
    "maxCvssScore" DOUBLE PRECISION,
    "maxCvssSeverity" TEXT,
    "vendors" TEXT[],
    "nvdEnrichment" "DigestNvdEnrichment" NOT NULL DEFAULT 'PENDING',
    "nvdStatus" TEXT,
    "nvdLastModified" TIMESTAMP(3),
    "nvdAffected" JSONB,
    "kevListed" BOOLEAN,
    "kevDateAdded" TIMESTAMP(3),
    "kevData" JSONB,
    "conflicts" JSONB,
    "provenance" JSONB NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestCve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestKevEntry" (
    "cveId" TEXT NOT NULL,
    "vendorProject" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateAdded" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "ransomwareUse" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "notes" TEXT,
    "catalogVersion" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestKevEntry_pkey" PRIMARY KEY ("cveId")
);

-- CreateTable
CREATE TABLE "DigestZeroDayCase" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "state" "DigestZeroDayState" NOT NULL DEFAULT 'REPORTED_UNVERIFIED',
    "stateReasons" JSONB NOT NULL,
    "stateSetById" TEXT,
    "stateSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestZeroDayCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestZeroDayEvidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "note" TEXT,
    "addedById" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retractedAt" TIMESTAMP(3),
    "retractedById" TEXT,
    "retractReason" TEXT,

    CONSTRAINT "DigestZeroDayEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestIssue" (
    "id" TEXT NOT NULL,
    "digestDate" TEXT NOT NULL,
    "status" "DigestIssueStatus" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawReason" TEXT,

    CONSTRAINT "DigestIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "moduleEnabledForNonAdmins" BOOLEAN NOT NULL DEFAULT true,
    "pipelineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publishTime" TEXT NOT NULL DEFAULT '08:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "publishMode" TEXT NOT NULL DEFAULT 'AUTO',
    "minDiscoveryCoveragePct" INTEGER NOT NULL DEFAULT 50,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "jobRetryBackoffMinutes" INTEGER NOT NULL DEFAULT 10,
    "linkHosts" TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestJobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "detail" JSONB,

    CONSTRAINT "DigestJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestLock" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestLock_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "DigestEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_assigned_tl_id_idx" ON "users"("assigned_tl_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "projects_tester_id_idx" ON "projects"("tester_id");

-- CreateIndex
CREATE INDEX "projects_tl_id_idx" ON "projects"("tl_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_template_id_idx" ON "projects"("template_id");

-- CreateIndex
CREATE INDEX "project_changes_project_id_changed_at_idx" ON "project_changes"("project_id", "changed_at");

-- CreateIndex
CREATE INDEX "report_templates_category_idx" ON "report_templates"("category");

-- CreateIndex
CREATE INDEX "report_templates_sub_type_idx" ON "report_templates"("sub_type");

-- CreateIndex
CREATE INDEX "report_templates_project_type_idx" ON "report_templates"("project_type");

-- CreateIndex
CREATE INDEX "report_templates_report_format_idx" ON "report_templates"("report_format");

-- CreateIndex
CREATE INDEX "report_templates_is_active_idx" ON "report_templates"("is_active");

-- CreateIndex
CREATE INDEX "report_templates_effective_from_idx" ON "report_templates"("effective_from");

-- CreateIndex
CREATE INDEX "template_fields_template_id_idx" ON "template_fields"("template_id");

-- CreateIndex
CREATE INDEX "template_fields_field_category_idx" ON "template_fields"("field_category");

-- CreateIndex
CREATE INDEX "report_generations_project_id_idx" ON "report_generations"("project_id");

-- CreateIndex
CREATE INDEX "report_generations_template_id_idx" ON "report_generations"("template_id");

-- CreateIndex
CREATE INDEX "report_generations_generated_by_idx" ON "report_generations"("generated_by");

-- CreateIndex
CREATE INDEX "vulnerabilities_severity_idx" ON "vulnerabilities"("severity");

-- CreateIndex
CREATE INDEX "vulnerabilities_name_idx" ON "vulnerabilities"("name");

-- CreateIndex
CREATE INDEX "vulnerabilities_status_idx" ON "vulnerabilities"("status");

-- CreateIndex
CREATE INDEX "vulnerabilities_is_active_idx" ON "vulnerabilities"("is_active");

-- CreateIndex
CREATE INDEX "vulnerability_change_requests_status_idx" ON "vulnerability_change_requests"("status");

-- CreateIndex
CREATE INDEX "vulnerability_change_requests_vulnerability_id_idx" ON "vulnerability_change_requests"("vulnerability_id");

-- CreateIndex
CREATE INDEX "vulnerability_change_requests_target_tl_id_idx" ON "vulnerability_change_requests"("target_tl_id");

-- CreateIndex
CREATE INDEX "findings_project_id_idx" ON "findings"("project_id");

-- CreateIndex
CREATE INDEX "findings_vuln_id_idx" ON "findings"("vuln_id");

-- CreateIndex
CREATE INDEX "findings_status_idx" ON "findings"("status");

-- CreateIndex
CREATE INDEX "findings_report_status_idx" ON "findings"("report_status");

-- CreateIndex
CREATE UNIQUE INDEX "project_vulnerabilities_project_id_source_source_key_key" ON "project_vulnerabilities"("project_id", "source", "source_key");

-- CreateIndex
CREATE INDEX "poc_steps_finding_id_idx" ON "poc_steps"("finding_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_idx" ON "audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_question_id_user_id_key" ON "quiz_attempts"("question_id", "user_id");

-- CreateIndex
CREATE INDEX "pattern_map_scores_user_id_idx" ON "pattern_map_scores"("user_id");

-- CreateIndex
CREATE INDEX "pattern_map_scores_score_idx" ON "pattern_map_scores"("score");

-- CreateIndex
CREATE UNIQUE INDEX "DigestSource_slug_key" ON "DigestSource"("slug");

-- CreateIndex
CREATE INDEX "DigestRawItem_sourceId_fetchedAt_idx" ON "DigestRawItem"("sourceId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRawItem_sourceId_externalId_contentHash_key" ON "DigestRawItem"("sourceId", "externalId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DigestStory_dedupKey_key" ON "DigestStory"("dedupKey");

-- CreateIndex
CREATE INDEX "DigestStory_publishedAt_idx" ON "DigestStory"("publishedAt");

-- CreateIndex
CREATE INDEX "DigestStory_groupId_idx" ON "DigestStory"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestStory_sourceId_canonicalUrl_key" ON "DigestStory"("sourceId", "canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "DigestCve_cveId_key" ON "DigestCve"("cveId");

-- CreateIndex
CREATE INDEX "DigestCve_recordStatus_idx" ON "DigestCve"("recordStatus");

-- CreateIndex
CREATE INDEX "DigestCve_kevListed_idx" ON "DigestCve"("kevListed");

-- CreateIndex
CREATE UNIQUE INDEX "DigestZeroDayCase_cveId_key" ON "DigestZeroDayCase"("cveId");

-- CreateIndex
CREATE INDEX "DigestZeroDayCase_state_idx" ON "DigestZeroDayCase"("state");

-- CreateIndex
CREATE INDEX "DigestZeroDayEvidence_caseId_idx" ON "DigestZeroDayEvidence"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestIssue_digestDate_key" ON "DigestIssue"("digestDate");

-- CreateIndex
CREATE INDEX "DigestIssue_status_idx" ON "DigestIssue"("status");

-- CreateIndex
CREATE INDEX "DigestJobRun_job_startedAt_idx" ON "DigestJobRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "DigestEvent_entityType_entityId_createdAt_idx" ON "DigestEvent"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_tl_id_fkey" FOREIGN KEY ("assigned_tl_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tl_id_fkey" FOREIGN KEY ("tl_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerability_change_requests" ADD CONSTRAINT "vulnerability_change_requests_vulnerability_id_fkey" FOREIGN KEY ("vulnerability_id") REFERENCES "vulnerabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerability_change_requests" ADD CONSTRAINT "vulnerability_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerability_change_requests" ADD CONSTRAINT "vulnerability_change_requests_target_tl_id_fkey" FOREIGN KEY ("target_tl_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerability_change_requests" ADD CONSTRAINT "vulnerability_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_vuln_id_fkey" FOREIGN KEY ("vuln_id") REFERENCES "vulnerabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_vuln_id_fkey" FOREIGN KEY ("project_vuln_id") REFERENCES "project_vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vulnerabilities" ADD CONSTRAINT "project_vulnerabilities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_steps" ADD CONSTRAINT "poc_steps_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_user_stats" ADD CONSTRAINT "quiz_user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_map_scores" ADD CONSTRAINT "pattern_map_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestRawItem" ADD CONSTRAINT "DigestRawItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DigestSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestStory" ADD CONSTRAINT "DigestStory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DigestSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestZeroDayEvidence" ADD CONSTRAINT "DigestZeroDayEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DigestZeroDayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

