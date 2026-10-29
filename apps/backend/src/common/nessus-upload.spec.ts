import * as http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import multer from 'multer';
import { NessusCsvStream, NessusXmlStream, NESSUS_POC_MAX, parseNessusCsv, parseNessusXml } from './nessus-parser.util';
import { parseCsv } from './csv-validation.util';
import { nessusScanStorage, NESSUS_MAX_BYTES, NESSUS_UPLOAD, NessusUploadSizeGuard } from './nessus-upload.storage';
import { FindingsService } from '../findings/findings.service';

const item = (host: string, id: number, output = '') =>
  `<ReportHost name="${host}"><ReportItem port="443" protocol="tcp" severity="3" pluginID="${id}" pluginName="Plugin ${id}">` +
  `<cvss3_base_score>7.5</cvss3_base_score><description>dé</description><synopsis>s</synopsis><solution>fix</solution><cve>CVE-2020-${id}</cve>` +
  (output ? `<plugin_output>${output}</plugin_output>` : '') +
  `</ReportItem></ReportHost>`;
const doc = (body: string) => `<?xml version="1.0"?><NessusClientData_v2><Report name="r">${body}</Report></NessusClientData_v2>`;

/** Feeds a string to the streaming parser in chunks of the given sizes (bytes), as a network upload would. */
function streamed(xml: string, sizes: number[]) {
  const buf = Buffer.from(xml, 'utf8');
  const s = new NessusXmlStream();
  for (let i = 0, n = 0; i < buf.length; n++) {
    const size = sizes[n % sizes.length];
    s.write(buf.subarray(i, i + size));
    i += size;
  }
  return s.end();
}

describe('streaming .nessus parser', () => {
  const xml = doc(item('10.0.0.1', 1, 'line one\nline two é') + item('10.0.0.2', 1, 'second host') + item('10.0.0.3', 2) + item('10.0.0.2', 1));

  it('gives the same result however the upload is chunked, even when a chunk splits a multi-byte character', () => {
    const whole = parseNessusXml(xml);
    for (const sizes of [[1], [3], [7, 2, 11], [64 * 1024]]) expect(streamed(xml, sizes)).toEqual(whole);
    expect(whole.map((f) => [f.key, f.affected])).toEqual([['1', ['10.0.0.1:443/tcp', '10.0.0.2:443/tcp']], ['2', ['10.0.0.3:443/tcp']]]);
    expect(whole[0].pluginOutputs.map((o) => o.text)).toEqual(['line one\nline two é', 'second host']);
  });

  it('a plugin hitting many hosts folds in each host once, in order', () => {
    const hosts = Array.from({ length: 3000 }, (_, i) => `h${i % 2500}`);
    const [f] = parseNessusXml(doc(hosts.map((h) => item(h, 9)).join('')));
    expect(f.affected).toHaveLength(2500);
    expect(f.affected[0]).toBe('h0:443/tcp');
  });

  it('keeps what is stored identical while never holding more plugin output than the stored cap', () => {
    const big = 'x'.repeat(NESSUS_POC_MAX * 3);
    const hosts = Array.from({ length: 50 }, (_, i) => item(`h${i}`, 5, big));
    const [capped] = parseNessusXml(doc(hosts.join('')));
    expect(capped.pluginOutputs.length).toBeLessThanOrEqual(3);
    expect(capped.pluginOutputs.every((o) => o.text.length <= NESSUS_POC_MAX + 1)).toBe(true);
    // What gets saved is exactly what the full, uncut list would have produced.
    const full = Array.from({ length: 50 }, (_, i) => ({ at: `h${i}:443/tcp`, text: big }));
    expect(FindingsService.nessusPocText(capped.pluginOutputs)).toBe(FindingsService.nessusPocText(full));
    // ...and a lone oversized output keeps its single-output layout and truncation marker.
    const [single] = parseNessusXml(doc(item('h', 6, big)));
    expect(FindingsService.nessusPocText(single.pluginOutputs)).toBe(big.slice(0, NESSUS_POC_MAX) + '\n[output truncated]');
  });

  it('rejects a real DOCTYPE/entity declaration but not DOCTYPE text inside plugin output', () => {
    expect(() => parseNessusXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><NessusClientData_v2/>')).toThrow(/DTD\/entity/);
    const ok = parseNessusXml(doc(item('h', 1, '<![CDATA[<!DOCTYPE html><html></html>]]>')));
    expect(ok[0].pluginOutputs[0].text).toBe('<!DOCTYPE html><html></html>');
  });

  it('still rejects empty, binary, wrong-root, malformed and finding-less input', () => {
    expect(() => new NessusXmlStream().end()).toThrow(/empty/);
    expect(() => { const s = new NessusXmlStream(); s.write(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])); }).toThrow(/archive/);
    expect(() => parseNessusXml(doc(item('h', 1)).replace('Plugin 1', 'a\u0000b').replace('<?xml', '\u0000<?xml'))).toThrow(/binary data/);
    expect(() => parseNessusXml('<html/>')).toThrow(/Unsupported XML/);
    expect(() => parseNessusXml('<NessusClientData_v2><Report>')).toThrow(/not valid XML/);
    expect(() => parseNessusXml(doc(''))).toThrow(/No findings/);
  });
});

describe('Nessus upload storage (through multer)', () => {
  let server: http.Server;
  let seen: any;
  const post = async (name: string, content: string) => {
    const form = new FormData();
    form.append('projectId', 'p1');
    form.append('file', new Blob([content]), name);
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/up`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  beforeAll((done) => {
    const app = express();
    app.post('/up', multer(NESSUS_UPLOAD).single('file'), (req: any, res) => {
      seen = req.file;
      res.json({ findings: req.file.scan?.length ?? null, bytes: req.file.size });
    });
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? err.statusCode ?? 500).json({ message: err.message }));
    server = app.listen(0, '127.0.0.1', done);
  });
  afterAll((done) => { server.close(done); });

  it('parses a .nessus as it arrives and keeps only the findings: no buffer, no path', async () => {
    const r = await post('scan.nessus', doc(item('10.0.0.1', 1, 'out') + item('10.0.0.2', 2)));
    expect(r.body.findings).toBe(2);
    expect(seen.scan).toHaveLength(2);
    expect(seen.buffer).toBeUndefined();
    expect(seen.path).toBeUndefined();
    expect(seen.destination).toBeUndefined();
  });

  it('a bad .nessus is rejected with the parser message, and the connection is not left hanging', async () => {
    const r = await post('scan.nessus', '<NessusClientData_v2><Report>');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not valid XML/);
    const again = await post('scan.nessus', doc(item('h', 1)));
    expect(again.body.findings).toBe(1);
  });

  it('a .csv is read the same way: only its findings are kept, no buffer', async () => {
    const r = await post('scan.csv', ['Plugin ID,Name,Risk,Host,Port,Protocol', '1,x,High,10.0.0.1,443,tcp', '1,x,High,10.0.0.2,443,tcp', '2,y,Low,10.0.0.1,22,tcp'].join('\n'));
    expect(r.body.findings).toBe(2);
    expect(seen.scan[0].affected).toEqual(['10.0.0.1:443/tcp', '10.0.0.2:443/tcp']);
    expect(seen.buffer).toBeUndefined();
  });

  it('an unsupported file type is refused before it is read, and the next upload still works', async () => {
    const r = await post('notes.txt', 'x'.repeat(100000));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Unsupported file type/);
    expect((await post('scan.csv', 'Plugin ID,Name,Risk,Host\n1,x,High,h')).body.findings).toBe(1);
  });

  it('the storage has nothing to clean up', (done) => {
    nessusScanStorage._removeFile({} as any, {} as any, (err) => { expect(err).toBeNull(); done(); });
  });
});

describe('NessusUploadSizeGuard', () => {
  const guard = new NessusUploadSizeGuard();
  const ctx = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it('refuses a declared size over the limit before the body is read, naming the limit', () => {
    expect(() => guard.canActivate(ctx({ 'content-length': String(NESSUS_MAX_BYTES + 5 * 1024 * 1024) }))).toThrow(/larger than 500 MB/);
  });

  it('lets a file at the limit through (plus its form fields), and requests with no declared size', () => {
    expect(guard.canActivate(ctx({ 'content-length': String(NESSUS_MAX_BYTES + 1024 * 1024) }))).toBe(true);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });
});

describe('streaming Nessus .csv reader', () => {
  const HEAD = 'Plugin ID,CVE,CVSS v2.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution,See Also';
  const row = (id: number, host: string, port = 443, desc = 'plain') =>
    `${id},CVE-2020-${id},5.0,High,${host},tcp,${port},Plugin ${id},syn,"${desc}",fix,http://a http://b`;
  const csv = (rows: string[], eol = '\n') => [HEAD, ...rows].join(eol) + eol;

  /** Feeds the text in chunks of the given byte sizes, as an upload would. */
  const streamed = (text: string, sizes: number[]) => {
    const buf = Buffer.from(text, 'utf8');
    const s = new NessusCsvStream();
    for (let i = 0, n = 0; i < buf.length; n++) {
      const size = sizes[n % sizes.length];
      s.write(buf.subarray(i, i + size));
      i += size;
    }
    return s.end();
  };

  const body = csv([
    row(1, '10.0.0.1', 443, 'He said ""hi"", then\nleft, with a comma'),
    row(1, '10.0.0.2'),
    row(2, 'héllo.example', 80, 'line one\r\nline two'),
    row(1, '10.0.0.1'), // the same endpoint again is folded in once
  ]);

  it('gives the same result however the upload is chunked: quotes, "" pairs, CRLF and multi-byte characters can all straddle a chunk boundary', () => {
    const whole = parseNessusCsv(body);
    for (const sizes of [[1], [2], [3], [5, 1, 9], [64 * 1024]]) expect(streamed(body, sizes)).toEqual(whole);
    expect(whole.map((f) => [f.key, f.affected])).toEqual([['1', ['10.0.0.1:443/tcp', '10.0.0.2:443/tcp']], ['2', ['héllo.example:80/tcp']]]);
    expect(whole[0].description).toBe('He said "hi", then\nleft, with a comma');
    expect(whole[1].description).toBe('line one\r\nline two'); // inside quotes a line break is data, kept as written
  });

  it('works with CRLF line ends, a byte-order mark, blank lines before the header, and no final newline', () => {
    const f = parseNessusCsv('﻿\n\n' + csv([row(7, 'h1'), row(7, 'h2')], '\r\n').trimEnd());
    expect(f).toHaveLength(1);
    expect(f[0].affected).toEqual(['h1:443/tcp', 'h2:443/tcp']);
  });

  it('a plugin hitting many hosts folds in each endpoint once, in order, and stays fast', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => row(9, `h${i % 15000}`));
    const t0 = Date.now();
    const [f] = parseNessusCsv(csv(rows));
    expect(f.affected).toHaveLength(15000);
    expect(f.affected[0]).toBe('h0:443/tcp');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('keeps the old parser rules: scores, risk mapping and a missing plugin id or name are skipped', () => {
    const [a, b] = parseNessusCsv(csv([`3,,9.8,Critical,h,tcp,22,Three,s,d,x,`, `,,1,Low,h,tcp,22,NoId,s,d,x,`, `4,,,None,h,tcp,0,Four,s,d,x,`]));
    expect([a.key, a.severity, a.cvssScore, a.cvssVersion, a.cvssVector]).toEqual(['3', 'Critical', 9.8, '2', null]);
    expect([b.key, b.severity, b.cvssScore, b.affected]).toEqual(['4', 'Info', null, ['h']]);
  });

  it('rejects a CSV with no Nessus columns, no data rows, nothing usable, too many columns, binary content or an archive', () => {
    expect(() => parseNessusCsv('a,b\n1,2')).toThrow(/Missing column\(s\): Plugin ID, Name, Risk, Host/);
    expect(() => parseNessusCsv(HEAD + '\n')).toThrow(/no data rows/);
    expect(() => parseNessusCsv('\n\n')).toThrow(/no data rows/);
    expect(() => parseNessusCsv(csv([',,,,,,,,,,,']))).toThrow(/no data rows/); // an all-empty row is blank
    expect(() => parseNessusCsv(csv([',,5,High,h,tcp,1,,s,d,x,']))).toThrow(/No findings/); // no plugin id or name
    expect(() => parseNessusCsv(HEAD + '\n' + Array(250).fill('x').join(',') + '\n')).toThrow(/200 columns/);
    expect(() => parseNessusCsv('\u0000\u0000' + csv([row(1, 'h')]))).toThrow(/binary data/);
    // Stray control characters further in are scan output, not a reason to refuse the file.
    expect(parseNessusCsv(csv([row(1, 'h')]).replace('syn', 'a\u0001b'))).toHaveLength(1);
    expect(() => { const s = new NessusCsvStream(); s.write(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1])); }).toThrow(/archive/);
    expect(() => new NessusCsvStream().end()).toThrow(/empty/);
  });

  it('an unclosed quote cannot grow a field without bound', () => {
    const huge = 'x'.repeat(3 * 1024 * 1024);
    const [f] = parseNessusCsv(csv([row(1, 'h', 443, huge)]));
    expect(f.description.length).toBeLessThanOrEqual(1024 * 1024);
    const unclosed = HEAD + '\n' + row(1, 'h') + '\n2,,5,High,h,tcp,1,Two,s,"never closed ' + huge;
    const rest = parseNessusCsv(unclosed); // the file ends inside the quote: that row is still read, its field cut at the cap
    expect(rest.map((x) => x.key)).toEqual(['1', '2']);
    expect(rest[1].description.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('parseCsv, shared with the other CSV imports, still reads the same rows as before', () => {
    expect(parseCsv('a,b\r\n"x ""q"" y",\n\n"l1\nl2",z')).toEqual([['a', 'b'], ['x "q" y', ''], [''], ['l1\nl2', 'z']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });
});
