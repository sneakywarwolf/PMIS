export const REPORT_GENERATION_QUEUE = 'report-generation';

export interface ReportGenerationJobData {
  reportGenerationId: string;
  actorId: string;
  ipAddress: string;
  userAgent: string;
}
