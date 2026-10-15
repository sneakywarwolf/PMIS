import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { parseNetworkScopeFile } from './network-scope-import.util';

const f = (originalname: string, content: string | Buffer) =>
  ({ originalname, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) }) as Express.Multer.File;

describe('parseNetworkScopeFile', () => {
  it('txt: one IP per line, blank lines ignored, bad lines reported, repeats dropped', async () => {
    const r = await parseNetworkScopeFile(f('s.txt', '10.0.0.1\r\n\n10.0.0.0/24\nnot-an-ip\n10.0.0.1\n2001:db8::1\n10.0.0.300\n'));
    expect(r.rows.map((x) => x.ip)).toEqual(['10.0.0.1', '10.0.0.0/24', '2001:db8::1']);
    expect(r.errors.map((e) => e.line)).toEqual([4, 7]);
    expect(r.duplicates).toBe(1);
  });

  it('csv: IP, Domain, Purpose columns (any order, quoted values)', async () => {
    const r = await parseNetworkScopeFile(f('s.csv', 'Purpose,IP,Domain\n"Web, public",10.0.0.5,app.example.com\n,10.0.0.6,\n'));
    expect(r.rows).toEqual([
      { ip: '10.0.0.5', domainHostname: 'app.example.com', purpose: 'Web, public' },
      { ip: '10.0.0.6', domainHostname: '', purpose: '' },
    ]);
  });

  it('xlsx: reads the first sheet the same way', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['IP', 'Domain', 'Purpose'], ['192.168.1.1', 'gw.local', 'Gateway']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scope');
    const r = await parseNetworkScopeFile(f('s.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    expect(r.rows).toEqual([{ ip: '192.168.1.1', domainHostname: 'gw.local', purpose: 'Gateway' }]);
  });

  it('skips rows already in the table (same IP + domain, case-insensitive) but keeps the same IP with another domain', async () => {
    const r = await parseNetworkScopeFile(f('s.csv', 'IP,Domain,Purpose\n10.0.0.1,A.example.com,x\n10.0.0.1,b.example.com,y\n'), [
      { ip: '10.0.0.1', domainHostname: 'a.EXAMPLE.com', purpose: '' },
    ]);
    expect(r.rows.map((x) => x.domainHostname)).toEqual(['b.example.com']);
    expect(r.duplicates).toBe(1);
  });

  it('rejects a CSV without an IP column, an empty file and other extensions', async () => {
    await expect(parseNetworkScopeFile(f('s.csv', 'Host,Domain\n1,2\n'))).rejects.toThrow(BadRequestException);
    await expect(parseNetworkScopeFile(f('s.txt', ''))).rejects.toThrow(BadRequestException);
    await expect(parseNetworkScopeFile(f('s.pdf', 'x'))).rejects.toThrow(BadRequestException);
  });
});
