import { NESSUS_POC_MAX, parseNessusFile } from './nessus-parser.util';

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
    // The same column in a .csv export is read per host:port the same way; an empty cell records nothing.
    expect(parseNessusFile(file('c.csv', CSV))[0].pluginOutputs).toEqual([{ at: '10.0.0.1:443/tcp', text: 'out' }]);
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

// The header row of a real Nessus CSV export (30 columns). The data rows are made up for the test.
const REAL_HEADER = ['Plugin ID', 'CVE', 'CVSS v2.0 Base Score', 'Risk', 'Host', 'Protocol', 'Port', 'Name', 'Synopsis', 'Description', 'Solution', 'See Also', 'Plugin Output', 'STIG Severity', 'CVSS v4.0 Base Score', 'CVSS v4.0 Base+Threat Score', 'CVSS v3.0 Base Score', 'CVSS v2.0 Temporal Score', 'CVSS v3.0 Temporal Score', 'VPR Score', 'EPSS Score', 'Risk Factor', 'BID', 'XREF', 'MSKB', 'Plugin Publication Date', 'Plugin Modification Date', 'Metasploit', 'Core Impact', 'CANVAS'];
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function realRow(o: Record<string, string>) {
  return REAL_HEADER.map((h) => q(o[h] ?? '')).join(',');
}
const realCsv = (rows: Record<string, string>[]) => [REAL_HEADER.join(','), ...rows.map(realRow)].join('\r\n') + '\r\n';

describe('Nessus .csv export with the real 30-column header', () => {
  const base = { 'Plugin ID': '51192', Risk: 'High', Protocol: 'tcp', Name: 'SSL Certificate Cannot Be Trusted', Synopsis: 'The SSL certificate cannot be trusted.', Description: 'The server\'s X.509 certificate\ncannot be trusted.', Solution: 'Purchase a trusted certificate.', 'See Also': 'https://www.itu.int/rec/T-REC-X.509/en https://en.wikipedia.org/wiki/X.509', 'CVSS v2.0 Base Score': '6.4', 'CVSS v3.0 Base Score': '6.5', 'CVSS v3.0 Temporal Score': '5.9', 'CVSS v4.0 Base Score': '7.1', 'Risk Factor': 'Medium', XREF: 'CWE:295', CVE: '' };

  it('reads each host\'s Plugin Output (multi-line, quoted, with commas) and keeps hosts and outputs paired', () => {
    const f = parseNessusFile(file('real.csv', realCsv([
      { ...base, Host: '10.0.0.1', Port: '443', 'Plugin Output': 'The following certificate was at the top of the certificate\nchain sent by the remote host, but it is signed by an unknown\ncertificate authority :\n\n|-Subject : CN=a, O="Acme"' },
      { ...base, Host: '10.0.0.2', Port: '8443', 'Plugin Output': 'second host output' },
      { ...base, Host: '10.0.0.3', Port: '443', 'Plugin Output': '' },
    ])));
    expect(f).toHaveLength(1);
    expect(f[0].affected).toEqual(['10.0.0.1:443/tcp', '10.0.0.2:8443/tcp', '10.0.0.3:443/tcp']);
    expect(f[0].pluginOutputs).toEqual([
      { at: '10.0.0.1:443/tcp', text: 'The following certificate was at the top of the certificate\nchain sent by the remote host, but it is signed by an unknown\ncertificate authority :\n\n|-Subject : CN=a, O="Acme"' },
      { at: '10.0.0.2:8443/tcp', text: 'second host output' },
    ]);
  });

  it('takes the Base scores by exact header (not the Temporal or v4.0 columns) and invents no vector', () => {
    const [f] = parseNessusFile(file('real.csv', realCsv([{ ...base, Host: '10.0.0.1', Port: '443' }])));
    expect(f).toMatchObject({ key: '51192', severity: 'High', cvssScore: 6.5, cvssVersion: '3', cvssVector: null, impact: 'The SSL certificate cannot be trusted.', remediation: 'Purchase a trusted certificate.', cweId: 'CWE-295' });
    // XREF without a CWE entry gives no CWE; nothing is guessed.
    expect(parseNessusFile(file('x.csv', realCsv([{ ...base, XREF: 'IAVB:2008-B-0001', Host: '10.0.0.1', Port: '443' }])))[0].cweId).toBeNull();
    expect(f.references).toBe('https://www.itu.int/rec/T-REC-X.509/en\nhttps://en.wikipedia.org/wiki/X.509');
    expect(f.pluginOutputs).toEqual([]); // an empty Plugin Output cell records nothing
  });

  it('gives the same plugin output as the equivalent .nessus file', () => {
    const output = 'line1\nline2';
    const xml = `<?xml version="1.0"?><NessusClientData_v2><Report name="r"><ReportHost name="10.0.0.1"><ReportItem port="443" protocol="tcp" severity="3" pluginID="51192" pluginName="SSL Certificate Cannot Be Trusted"><plugin_output>${output}</plugin_output></ReportItem></ReportHost></Report></NessusClientData_v2>`;
    const fromXml = parseNessusFile(file('a.nessus', xml))[0];
    const fromCsv = parseNessusFile(file('a.csv', realCsv([{ ...base, Host: '10.0.0.1', Port: '443', 'Plugin Output': output }])))[0];
    expect(fromCsv.pluginOutputs).toEqual(fromXml.pluginOutputs);
    expect(fromCsv.affected).toEqual(fromXml.affected);
  });

  it('caps a very long output like the XML reader does', () => {
    const [f] = parseNessusFile(file('big.csv', realCsv([{ ...base, Host: '10.0.0.1', Port: '443', 'Plugin Output': 'x'.repeat(NESSUS_POC_MAX + 5000) }])));
    expect(f.pluginOutputs[0].text.length).toBe(NESSUS_POC_MAX + 1);
  });

  it('still imports an export made without the Plugin Output column', () => {
    const header = REAL_HEADER.filter((h) => h !== 'Plugin Output');
    const row = header.map((h) => q(({ ...base, Host: '10.0.0.1', Port: '443' } as Record<string, string>)[h] ?? '')).join(',');
    const [f] = parseNessusFile(file('no-output.csv', `${header.join(',')}\n${row}\n`));
    expect(f.pluginOutputs).toEqual([]);
    expect(f.affected).toEqual(['10.0.0.1:443/tcp']);
  });
});

