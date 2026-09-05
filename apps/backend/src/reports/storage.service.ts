import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
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

  async uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<string> {
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

  getPresignedUrl(objectName: string, expirySeconds: number = 3600): Promise<string> {
    return this.minioClient.presignedGetObject(this.bucket, objectName, expirySeconds);
  }
}
