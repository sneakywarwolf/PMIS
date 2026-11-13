import { BadRequestException } from '@nestjs/common';
import type JSZip from 'jszip';

/**
 * Zip-bomb guard that counts the bytes each entry really inflates to. The sizes in a zip's central directory are
 * written by the sender, so a forged header (or a missing one) must not decide how much memory the parsers that run
 * next are allowed to use. Entries are inflated as a stream and abandoned the moment the running total passes
 * `maxBytes`, so the cost of rejecting a bomb is bounded by the cap, not by what the archive claims to hold.
 */
export async function assertZipInflatesWithin(zip: JSZip, maxBytes: number, message: string): Promise<void> {
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const helper = (entry as any).internalStream('uint8array');
      let done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        helper.pause();
        err ? reject(err) : resolve();
      };
      helper
        .on('data', (chunk: Uint8Array) => {
          total += chunk.length;
          if (total > maxBytes) finish(new BadRequestException(message));
        })
        .on('error', () => finish(new BadRequestException(message)))
        .on('end', () => finish())
        .resume();
    });
  }
}
