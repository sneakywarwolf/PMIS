import { ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';

function make(getFile = jest.fn().mockResolvedValue(Buffer.from('doc'))) {
  const config = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'secret' : undefined) };
  const svc: any = new (ReportsService as any)({}, { getFile }, {}, {}, config, {}, {}, {});
  const url = new URL(svc.signedDownloadUrl('reports/p1/1_a.docx', 'a.docx'), 'http://x');
  const q = Object.fromEntries(url.searchParams) as Record<string, string>;
  return { svc, q, getFile, url };
}

describe('signed report downloads', () => {
  it('serves a valid link through the API, not MinIO', async () => {
    const { svc, q, url } = make();
    expect(url.pathname).toBe('/api/reports/download');
    const out = await svc.readSignedDownload(q.path, q.fn, q.exp, q.sig);
    expect(out.fileName).toBe('a.docx');
    expect(out.buffer.toString()).toBe('doc');
  });

  it('rejects tampered path, bad signature and expired links without reading storage', async () => {
    const { svc, q, getFile } = make();
    await expect(svc.readSignedDownload('reports/other.docx', q.fn, q.exp, q.sig)).rejects.toThrow(ForbiddenException);
    await expect(svc.readSignedDownload(q.path, q.fn, q.exp, 'x')).rejects.toThrow(ForbiddenException);
    const exp = String(Date.now() - 1);
    await expect(svc.readSignedDownload(q.path, q.fn, exp, svc.downloadSig(q.path, q.fn, Number(exp)))).rejects.toThrow(ForbiddenException);
    expect(getFile).not.toHaveBeenCalled();
  });
});
