import * as Minio from 'minio';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ResetCache, ResetStorage } from './reset';

// Same env names and defaults as StorageService / the Redis service / ReportsModule.
export interface InfraConfig {
  minio: { endPoint: string; port: number; useSSL: boolean; accessKey: string; secretKey: string; bucket: string };
  redisUrl: string;
}

export function infraConfigFromEnv(env: NodeJS.ProcessEnv = process.env): InfraConfig {
  return {
    minio: {
      endPoint: env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(env.MINIO_PORT || '9000'),
      useSSL: (env.MINIO_USE_SSL || 'false') === 'true',
      accessKey: env.MINIO_ACCESS_KEY || '',
      secretKey: env.MINIO_SECRET_KEY || '',
      bucket: env.MINIO_BUCKET || 'vapt-reports',
    },
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  };
}

const REPORT_QUEUE = 'report-generation'; // REPORT_GENERATION_QUEUE in reports/report-generation.types.ts
const SESSION_KEY_PATTERNS = ['refresh_token:*', 'active_session:*', 'session_activity:*', 'login_attempts:*'];

export function minioStorage(cfg: InfraConfig['minio']): ResetStorage {
  const { bucket, ...conn } = cfg;
  const client = new Minio.Client({ ...conn });
  return {
    async list(prefix) {
      // A missing bucket just means there's nothing to clean.
      if (!(await client.bucketExists(bucket))) return [];
      return new Promise<string[]>((resolve, reject) => {
        const keys: string[] = [];
        const stream = client.listObjectsV2(bucket, prefix, true);
        stream.on('data', (o) => o.name && keys.push(o.name));
        stream.on('end', () => resolve(keys));
        stream.on('error', reject);
      });
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) await client.removeObjects(bucket, keys.slice(i, i + 1000));
    },
  };
}

export function redisCache(redisUrl: string): ResetCache & { close(): Promise<void> } {
  // maxRetriesPerRequest: null is required by BullMQ (same as AppModule's connection).
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  return {
    async clearSessionKeys() {
      await redis.connect().catch(() => undefined); // already connected is fine
      let deleted = 0;
      for (const match of SESSION_KEY_PATTERNS) {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
          cursor = next;
          if (keys.length) deleted += await redis.del(...keys);
        } while (cursor !== '0');
      }
      return deleted;
    },
    async clearReportQueue() {
      await redis.connect().catch(() => undefined);
      const queue = new Queue(REPORT_QUEUE, { connection: redis });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    },
    async close() {
      redis.disconnect();
    },
  };
}
