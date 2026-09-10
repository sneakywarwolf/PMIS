import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReportsService } from './reports.service';
import { REPORT_GENERATION_QUEUE, ReportGenerationJobData } from './report-generation.types';

/**
 * Runs the CPU-heavy part of report generation (docx XML manipulation, image
 * collection, upload) off the HTTP request path, so one user's report
 * doesn't stall the event loop for everyone else generating concurrently.
 */
@Processor(REPORT_GENERATION_QUEUE)
export class ReportGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportGenerationProcessor.name);

  constructor(private readonly reportsService: ReportsService) {
    super();
  }

  async process(job: Job<ReportGenerationJobData>): Promise<void> {
    const { reportGenerationId, actorId, ipAddress, userAgent } = job.data;
    this.logger.log(`Processing report generation job ${job.id} (report ${reportGenerationId})`);
    await this.reportsService.processReportGeneration(reportGenerationId, actorId, ipAddress, userAgent);
  }
}
