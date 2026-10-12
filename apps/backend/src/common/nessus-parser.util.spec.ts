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

  it('maps each finding\'s own <cvss3_vector> verbatim, paired with its own score, never falling back to the v2 vector', () => {
    const item = (id: string, body: string) =>
      `<ReportHost name="h${id}"><ReportItem port="1" protocol="tcp" severity="3" pluginID="${id}" pluginName="P${id}">${body}</ReportItem></ReportHost>`;
    const xml = `<?xml version="1.0"?><NessusClientData_v2><Report name="r">`
      + item('1', '<cvss3_base_score>9.8</cvss3_base_score><cvss3_vector>CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H</cvss3_vector><cvss_vector>AV:N/AC:L/Au:N/C:P/I:P/A:P</cvss_vector><cvss_base_score>7.5</cvss_base_score>')
      + item('2', '<cvss3_base_score>5.3</cvss3_base_score><cvss3_vector> CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N </cvss3_vector>')
      + item('3', '<cvss3_base_score>6.5</cvss3_base_score><cvss_vector>AV:N/AC:L/Au:N/C:P/I:P/A:N</cvss_vector>') // v3 score but no v3 vector: do not substitute the v2 one
      + item('4', '<cvss_base_score>5.0</cvss_base_score><cvss_vector>AV:N/AC:L/Au:N/C:N/I:N/A:P</cvss_vector>')
      + item('5', '<cvss3_vector>CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H</cvss3_vector>') // vector without a score is still kept
      + `</Report></NessusClientData_v2>`;
    const by = Object.fromEntries(parseNessusFile(file('v.nessus', xml)).map((f) => [f.key, f]));
    expect(by['1']).toMatchObject({ cvssScore: 9.8, cvssVector: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', cvssVersion: '3' });
    expect(by['2']).toMatchObject({ cvssScore: 5.3, cvssVector: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N' });
    expect(by['3']).toMatchObject({ cvssScore: 6.5, cvssVector: null });
    expect(by['4']).toMatchObject({ cvssScore: 5, cvssVector: 'AV:N/AC:L/Au:N/C:N/I:N/A:P', cvssVersion: '2' });
    expect(by['5']).toMatchObject({ cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' });
  });

  it('keeps <plugin_output> per host with its endpoint, skips empty/missing ones, and never invents any', () => {
    const item = (host: string, port: string, body: string) =>
      `<ReportHost name="${host}"><ReportItem port="${port}" protocol="tcp" severity="2" pluginID="9" pluginName="P">${body}</ReportItem></ReportHost>`;
    const xml = `<?xml version="1.0"?><NessusClientData_v2><Report name="r">`
      + item('10.0.0.1', '443', '<plugin_output>\n  line1\nline2 &amp; <b>x</b>\n</plugin_output>'.replace('<b>x</b>', 'x'))
      + item('10.0.0.2', '443', '<plugin_output>   </plugin_output>')
      + item('10.0.0.3', '80', '')
      + item('10.0.0.4', '8080', '<plugin_output>second</plugin_output>')
      + `</Report></NessusClientData_v2>`;
    const [f] = parseNessusFile(file('o.nessus', xml));
    expect(f.pluginOutputs).toEqual([{ at: '10.0.0.1:443/tcp', text: 'line1\nline2 & x' }, { at: '10.0.0.4:8080/tcp', text: 'second' }]);
    expect(parseNessusFile(file('c.csv', CSV))[0].pluginOutputs).toEqual([]);
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
