import JSZip from 'jszip';
import { assertZipInflatesWithin } from './zip-limits.util';

const build = (size: number) => {
  const z = new JSZip();
  z.file('a.xml', Buffer.alloc(size, 0x41), { compression: 'DEFLATE' });
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

/** Rewrites the uncompressed size in the central directory, as a hostile sender can. */
const forgeDeclaredSize = (zip: Buffer, size: number) => {
  const at = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(size, at + 24);
  return zip;
};

describe('assertZipInflatesWithin', () => {
  it('accepts an archive under the cap', async () => {
    const zip = await JSZip.loadAsync(await build(10_000));
    await expect(assertZipInflatesWithin(zip, 1024 * 1024, 'too big')).resolves.toBeUndefined();
  });

  it('rejects an archive whose real size is over the cap', async () => {
    const zip = await JSZip.loadAsync(await build(5 * 1024 * 1024));
    await expect(assertZipInflatesWithin(zip, 1024 * 1024, 'too big')).rejects.toThrow('too big');
  });

  it('rejects a bomb whose central directory claims a tiny size (forged header)', async () => {
    const zip = await JSZip.loadAsync(forgeDeclaredSize(await build(20 * 1024 * 1024), 10));
    expect((zip.files['a.xml'] as any)._data.uncompressedSize).toBe(10); // the declared-size check alone is fooled
    await expect(assertZipInflatesWithin(zip, 1024 * 1024, 'too big')).rejects.toThrow('too big');
  });
});
