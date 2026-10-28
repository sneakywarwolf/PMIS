import { BadRequestException } from '@nestjs/common';
import { NessusCsvStream, NessusXmlStream } from './nessus-parser.util';

const HEAD = ['Plugin ID', 'CVE', 'CVSS v2.0 Base Score', 'Risk', 'Host', 'Protocol', 'Port', 'Name', 'Synopsis', 'Description', 'Solution', 'See Also', 'Plugin Output', 'CVSS v3.0 Base Score'];
const row = (o: Record<string, string>) => HEAD.map((h) => o[h] ?? '');
const ROWS = [
  row({ 'Plugin ID': '51192', Risk: 'High', Host: '10.0.0.5', Protocol: 'tcp', Port: '443', Name: 'SSL cert', 'Plugin Output': 'chain failed', 'CVSS v3.0 Base Score': '6.5' }),
  row({ 'Plugin ID': '51192', Risk: 'High', Host: '10.0.0.6', Protocol: 'tcp', Port: '8443', Name: 'SSL cert', 'Plugin Output': 'second', 'CVSS v3.0 Base Score': '6.5' }),
];
const csv = (d: string) => [HEAD, ...ROWS].map((r) => r.map((c) => `"${c}"`).join(d)).join('\r\n') + '\r\n';
const read = (buf: Buffer, chunk = 1 << 20) => {
  const s = new NessusCsvStream();
  for (let i = 0; i < buf.length; i += chunk) s.write(buf.subarray(i, i + chunk));
  return s.end();
};
const check = (f: ReturnType<typeof read>) => {
  expect(f).toHaveLength(1);
  expect(f[0].name).toBe('SSL cert');
  expect(f[0].affected).toEqual(['10.0.0.5:443', '10.0.0.6:8443'].map((x) => f[0].affected.find((a) => a.includes(x.split(':')[0]))!));
  expect(f[0].pluginOutputs).toHaveLength(2);
  expect(f[0].cvssScore).toBe(6.5);
};

describe('Nessus CSV fallbacks', () => {
  it('reads a comma file as before', () => check(read(Buffer.from(csv(',')))));
  it('reads a semicolon-separated file', () => check(read(Buffer.from(csv(';')))));
  it('reads a tab-separated file', () => check(read(Buffer.from(csv('\t')))));
  it('reads a UTF-8 file with a byte-order mark', () => check(read(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv(','))]))));
  it('reads UTF-16 little-endian "Unicode text" (with a BOM), in any chunking', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv('\t'), 'utf16le')]);
    check(read(buf));
    check(read(buf, 7));
  });
  it('reads UTF-16 big-endian, in any chunking', () => {
    const be = Buffer.from(csv(',') , 'utf16le').swap16();
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    check(read(buf));
    check(read(buf, 5));
  });
  it('a file split into tiny chunks gives the same result', () => check(read(Buffer.from(csv(';')), 3)));

  it('stray control characters in plugin output no longer make the whole file unreadable', () => {
    const rows = csv(',').replace('chain failed', 'chain \x1b[31mfailed\x07\x01 end');
    const f = read(Buffer.from(rows));
    expect(f[0].pluginOutputs[0].text).toContain('chain');
    expect(f[0].pluginOutputs[0].text).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it('binary content (NUL bytes at the start) is still refused with a clear message', () => {
    const bin = Buffer.concat([Buffer.from([0, 1, 2, 3, 0, 0, 0]), Buffer.from(csv(','))]);
    expect(() => read(bin)).toThrow(BadRequestException);
    expect(() => read(bin)).toThrow(/binary/);
  });

  it('a Nessus XML file with control characters inside plugin output is read too', () => {
    const xml = '<?xml version="1.0"?><NessusClientData_v2><Report name="r"><ReportHost name="10.0.0.5"><ReportItem port="443" svc_name="https" protocol="tcp" severity="3" pluginID="51192" pluginName="SSL cert"><description>d</description><plugin_output>out \x1b[0m ok</plugin_output></ReportItem></ReportHost></Report></NessusClientData_v2>';
    const s = new NessusXmlStream();
    s.write(Buffer.from(xml));
    expect(s.end()).toHaveLength(1);
  });

  it('a file that is not a Nessus CSV still gets a clear message', () => {
    expect(() => read(Buffer.from('a,b,c\r\n1,2,3\r\n'))).toThrow(/Missing column/);
  });
});
