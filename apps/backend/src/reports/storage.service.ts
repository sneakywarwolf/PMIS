import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { PrismaService } from '../prisma/prisma.service';
import { quotaError } from '../common/quota';
import { readEffectiveSettings } from '../settings/settings.store';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService, private prisma: PrismaService) {
    this.minioClient = new Minio.Client({
      endPoint: configService.get('MINIO_ENDPOINT', 'localhost'),
      port: parseInt(configService.get('MINIO_PORT', '9000')),
      useSSL: configService.get('MINIO_USE_SSL', 'false') === 'true',
      accessKey: configService.get('MINIO_ACCESS_KEY', ''),
      secretKey: configService.get('MINIO_SECRET_KEY', ''),
    });
    
    this.bucket = configService.get('MINIO_BUCKET', 'vapt-reports');
    this.ensureBucket();
  }

  async healthCheck(): Promise<{ reachable: boolean; bucket: string; endpoint: string; port: number }> {
    const endpoint = this.configService.get('MINIO_ENDPOINT', 'localhost');
    const port = parseInt(this.configService.get('MINIO_PORT', '9000'));
    try {
      await this.minioClient.bucketExists(this.bucket);
      return { reachable: true, bucket: this.bucket, endpoint, port };
    } catch {
      return { reachable: false, bucket: this.bucket, endpoint, port };
    }
  }

  private async ensureBucket() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucket);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucket, 'us-east-1');
        this.logger.log(`Created bucket: ${this.bucket}`);
      }
    } catch (error) {
      this.logger.error('Failed to ensure bucket:', error);
    }
  }

  private used: { bytes: number; at: number } | null = null;

  /** Forget the measured size, so the next upload measures again (after the quota setting changes). */
  resetUsage() {
    this.used = null;
  }

  /** Refuses a file that would take the bucket over the storage quota set in Settings > System. */
  private async assertRoomFor(extraBytes: number) {
    const quotaMb = (await readEffectiveSettings(this.prisma)).settings.system.totalStorageQuotaMb;
    if (!this.used || Date.now() - this.used.at > 60_000) this.used = { bytes: await this.getUsedBytes(), at: Date.now() };
    if (this.used.bytes + extraBytes > quotaMb * 1024 * 1024) throw quotaError('storage', this.used.bytes / (1024 * 1024), quotaMb);
  }

  async uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.assertRoomFor(buffer.length);
    if (this.used) this.used.bytes += buffer.length;
    await this.minioClient.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return objectName;
  }

  async getFile(objectName: string): Promise<Buffer> {
    const stream = await this.minioClient.getObject(this.bucket, objectName);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async deleteFile(objectName: string): Promise<void> {
    await this.minioClient.removeObject(this.bucket, objectName);
  }

  /**
   * `downloadFileName`, when given, overrides the filename the browser saves
   * the download as (via response-content-disposition) — independent of the
   * object's storage key, which carries a uniqueness prefix (timestamp) that
   * should never leak into the user-facing filename.
   */
  getPresignedUrl(objectName: string, expirySeconds: number = 3600, downloadFileName?: string): Promise<string> {
    const reqParams = downloadFileName
      ? { 'response-content-disposition': `attachment; filename="${downloadFileName.replace(/["\\\r\n]/g, '_')}"` }
      : undefined;
    return this.minioClient.presignedGetObject(this.bucket, objectName, expirySeconds, reqParams);
  }

  /** Live sum of every object's size in the bucket, in bytes. */
  async getUsedBytes(): Promise<number> {
    return new Promise((resolve, reject) => {
      let total = 0;
      const stream = this.minioClient.listObjectsV2(this.bucket, '', true);
      stream.on('data', (obj) => {
        total += obj.size || 0;
      });
      stream.on('end', () => resolve(total));
      stream.on('error', reject);
    });
  }
}
