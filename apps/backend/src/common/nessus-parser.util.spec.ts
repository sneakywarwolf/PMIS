import { parseNessusFile } from './nessus-parser.util';

const file = (originalname: string, body: string | Buffer) => ({
  originalname,
  buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
});

const XML = `<?xml version="1.0"?>
<NessusClientData_v2><Report name="r">
  <ReportHost name="10.0.0.1"><ReportItem port="443" svc_name="www" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher">
    <cvss3_base_score>7.5</cvss3_base_score><cvss3_vector>CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N</cvss3_vector>
    <cve>CVE-2016-2183</cve><cve>CVE-2015-0001</cve><cwe>327</cwe>
    <description>Weak ciphers.</description><synopsis>Remote service uses weak crypto.</synopsis>
    <solution>Disable them.</solution><see_also>https://a.example/x https://b.example/y</see_also>
  </ReportItem></ReportHost>
  <ReportHost name="10.0.0.2"><ReportItem port="443" svc_name="www" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher"/>
    <ReportItem port="0" svc_name="general" protocol="tcp" severity="0" pluginID="200" pluginName="Host Info"/></ReportHost>
</Report></NessusClientData_v2>`;

const CSV = `Plugin ID,CVE,CVSS v2.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution,See Also,Plugin Output
100,CVE-2016-2183,5.0,Medium,10.0.0.1,tcp,443,TLS Weak Cipher,"Weak, crypto","Line one
line two",Disable them.,https://a.example/x,out
100,CVE-2016-2183,5.0,Medium,10.0.0.2,tcp,443,TLS Weak Cipher,s,d,s,,
`;

describe('parseNessusFile', () => {
  it('parses .nessus XML, folding hosts per plugin and mapping fields', () => {
    const f = parseNessusFile(file('scan.nessus', XML));
    expect(f.map((x) => x.key)).toEqual(['100', '200']);
    expect(f[0]).toMatchObject({
      severity: 'High', cvssScore: 7.5, cveId: 'CVE-2016-2183, CVE-2015-0001', cweId: '327',
      impact: 'Remote service uses weak crypto.', remediation: 'Disable them.',
      references: 'https://a.example/x\nhttps://b.example/y',
    });
    expect(f[0].cvssVector).toMatch(/^CVSS:3\.0\//);
    expect(f[0].affected).toEqual(['10.0.0.1:443/tcp', '10.0.0.2:443/tcp']);
    expect(f[1]).toMatchObject({ severity: 'Info', affected: ['10.0.0.2'] });
  });

  it('parses .csv with quoted multi-line fields and groups by plugin', () => {
    const f = parseNessusFile(file('scan.csv', CSV));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'Medium', cvssScore: 5, impact: 'Weak, crypto', description: 'Line one\nline two' });
    expect(f[0].affected).toEqual(['10.0.0.1:443/tcp', '10.0.0.2:443/tcp']);
  });

  it.each([
    ['empty file', file('a.nessus', '')],
    ['unsupported extension', file('a.txt', 'x')],
    ['zip/office archive', file('a.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1]))],
    ['malformed xml', file('a.nessus', '<NessusClientData_v2><Report>')],
    ['wrong xml root', file('a.nessus', '<?xml version="1.0"?><nmaprun/>')],
    ['xml entity declaration', file('a.nessus', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><NessusClientData_v2/>')],
    ['csv without nessus columns', file('a.csv', 'a,b\n1,2')],
    ['nessus xml with no findings', file('a.nessus', '<?xml version="1.0"?><NessusClientData_v2><Report/></NessusClientData_v2>')],
  ])('rejects %s', (_label, f) => {
    expect(() => parseNessusFile(f)).toThrow();
  });
});
