import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';
import { quotaError } from '../common/quota';
import { readEffectiveSettings } from '../settings/settings.store';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService, private prisma: PrismaService) {
    // Any S3-compatible store (RustFS). The MINIO_* variable names are kept so existing .env files keep working.
    const ssl = configService.get('MINIO_USE_SSL', 'false') === 'true';
    this.s3 = new S3Client({
      endpoint: `${ssl ? 'https' : 'http'}://${configService.get('MINIO_ENDPOINT', 'localhost')}:${parseInt(configService.get('MINIO_PORT', '9000'))}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: configService.get('MINIO_ACCESS_KEY', ''), secretAccessKey: configService.get('MINIO_SECRET_KEY', '') },
    });

    this.bucket = configService.get('MINIO_BUCKET', 'vapt-reports');
    this.ensureBucket();
  }

  async healthCheck(): Promise<{ reachable: boolean; bucket: string; endpoint: string; port: number }> {
    const endpoint = this.configService.get('MINIO_ENDPOINT', 'localhost');
    const port = parseInt(this.configService.get('MINIO_PORT', '9000'));
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { reachable: true, bucket: this.bucket, endpoint, port };
    } catch {
      return { reachable: false, bucket: this.bucket, endpoint, port };
    }
  }

  private async ensureBucket() {
    try {
      const exists = await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket })).then(() => true, (e: any) => {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchBucket') return false;
        throw e;
      });
      if (!exists) {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
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
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectName, Body: buffer, ContentLength: buffer.length, ContentType: contentType }));
    return objectName;
  }

  async getFile(objectName: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectName }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async deleteFile(objectName: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectName }));
  }

  /**
   * `downloadFileName`, when given, overrides the filename the browser saves
   * the download as (via response-content-disposition) — independent of the
   * object's storage key, which carries a uniqueness prefix (timestamp) that
   * should never leak into the user-facing filename.
   */
  getPresignedUrl(objectName: string, expirySeconds: number = 3600, downloadFileName?: string): Promise<string> {
    const disposition = downloadFileName ? `attachment; filename="${downloadFileName.replace(/["\\\r\n]/g, '_')}"` : undefined;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: objectName, ResponseContentDisposition: disposition }), { expiresIn: expirySeconds });
  }

  /** Live sum of every object's size in the bucket, in bytes. */
  async getUsedBytes(): Promise<number> {
    let total = 0;
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }));
      for (const o of page.Contents ?? []) total += o.Size || 0;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return total;
  }
}
