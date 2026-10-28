import JSZip from 'jszip';
import { cleanRichText, extractCweIds, fortifySeverity, parseFortifyFile } from './fortify-parser.util';

// Synthetic FVDL laid out like Fortify's (no real .fpr was available when this was written).
const vuln = (id: string, type: string, sub: string, sev: string, loc: string) => `
  <Vulnerability>
    <ClassInfo><ClassID>C1</ClassID><Type>${type}</Type>${sub ? `<Subtype>${sub}</Subtype>` : ''}</ClassInfo>
    <InstanceInfo><InstanceID>${id}</InstanceID><InstanceSeverity>${sev}</InstanceSeverity></InstanceInfo>
    <AnalysisInfo><Unified>
      <ReplacementDefinitions><Def key="Foo" value="bar"/></ReplacementDefinitions>
      <Trace><Primary>${loc}</Primary></Trace>
    </Unified></AnalysisInfo>
  </Vulnerability>`;
const node = (path: string, line: number, def = true) =>
  `<Entry><Node isDefault="${def}" label="step"><SourceLocation path="${path}" line="${line}"/><Action>Call x()</Action></Node></Entry>`;

const fvdl = (body: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<FVDL xmlns="xmlns://www.fortifysoftware.com/schema/fvdl">
  <Vulnerabilities>${body}</Vulnerabilities>${extra}
  <Description classID="C1">
    <Abstract>&lt;Content&gt;Abstract of &lt;Replace key="PrimaryLocation.file"/&gt; &amp;amp; more&lt;/Content&gt;</Abstract>
    <Explanation>&lt;Paragraph&gt;Uses &lt;Replace key="Foo"/&gt;.&lt;/Paragraph&gt;</Explanation>
    <Recommendations>Fix it.</Recommendations>
    <References>
      <Reference><Title>OWASP A1</Title><Author>OWASP</Author><Source>https://owasp.org/x</Source></Reference>
      <Reference><Title>CWE ID 89</Title><Publisher>MITRE</Publisher><Source>https://cwe.mitre.org/data/definitions/89.html CVE-2020-1234</Source></Reference>
    </References>
  </Description>
</FVDL>`;

const upload = (originalname: string, content: string | Buffer) => ({ originalname, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
const fpr = async (files: Record<string, string>) => {
  const zip = new JSZip();
  Object.entries(files).forEach(([n, c]) => zip.file(n, c));
  return zip.generateAsync({ type: 'nodebuffer' });
};

const body = [
  vuln('a', 'SQL Injection', '', '4.0', node('src/A.java', 10)),
  vuln('b', 'SQL Injection', '', '4.0', node('src/B.java', 20)),
  vuln('c', 'Key Management: Hardcoded Encryption Key', '', '2.0', node('src/C.java', 5)),
  vuln('d', 'Dead Code', 'Unused Field', '1.0', node('src/D.java', 1)),
].join('');

describe('parseFortifyFile', () => {
  it('reads an .fpr: groups instances, maps fields, applies the reference utility rules', async () => {
    const r = await parseFortifyFile(upload('x.fpr', await fpr({ 'audit.fvdl': fvdl(body) })));
    expect(r.activeInstances).toBe(4);
    const sqli = r.findings.find((f) => f.name === 'SQL Injection')!;
    expect(sqli.severity).toBe('High');
    expect(sqli.affected).toEqual(['src/A.java:10', 'src/B.java:20']);
    expect(sqli.instanceCount).toBe(2);
    expect(sqli.description).toBe('Uses bar.');
    expect(sqli.impact).toBe('Abstract of src/A.java & more');
    expect(sqli.remediation).toBe('Fix it.');
    expect(sqli.references).toBe('[1] OWASP A1, OWASP, https://owasp.org/x\n[2] CWE ID 89, MITRE, https://cwe.mitre.org/data/definitions/89.html CVE-2020-1234');
    expect(sqli.cweId).toBe('CWE-89');
    expect(sqli.cveId).toBe('CVE-2020-1234');
    expect(sqli.trace).toContain('1. src/A.java:10 - step');
    // approved prefix dropped; name override sets High
    expect(r.findings.map((f) => f.name)).toEqual(expect.arrayContaining(['Hardcoded Encryption Key', 'Dead Code: Unused Field']));
    expect(r.findings.find((f) => f.name === 'Hardcoded Encryption Key')!.severity).toBe('High');
    expect(r.findings.find((f) => f.name === 'Dead Code: Unused Field')!.severity).toBe('Info');
    // highest severity first
    expect(r.findings[r.findings.length - 1].severity).toBe('Info');
  });

  it('leaves out instances suppressed in audit.xml', async () => {
    const audit = '<AuditData><IssueList><Issue instanceId="a" suppressed="true"/><Issue instanceId="b" suppressed="false"/></IssueList></AuditData>';
    const r = await parseFortifyFile(upload('x.fpr', await fpr({ 'audit.fvdl': fvdl(body), 'audit.xml': audit })));
    expect(r.suppressedInstances).toBe(1);
    expect(r.suppressionApplied).toBe(true);
    expect(r.findings.find((f) => f.name === 'SQL Injection')!.affected).toEqual(['src/B.java:20']);
  });

  it('reads a bare FVDL .xml the same way, without suppression', async () => {
    const r = await parseFortifyFile(upload('x.xml', fvdl(body)));
    expect(r.suppressionApplied).toBe(false);
    expect(r.findings.find((f) => f.name === 'SQL Injection')!.affected).toHaveLength(2);
  });

  it('reads a standalone .fvdl like an .xml', async () => {
    const r = await parseFortifyFile(upload('audit.fvdl', fvdl(body)));
    expect(r.findings.find((f) => f.name === 'SQL Injection')!.affected).toHaveLength(2);
  });

  it('resolves NodeRef locations from the node pool', async () => {
    const ref = '<Entry><NodeRef id="7"/></Entry>';
    const pool = '<UnifiedNodePool><Node id="7" isDefault="true"><SourceLocation path="src/P.java" line="3"/></Node></UnifiedNodePool>';
    const r = await parseFortifyFile(upload('x.xml', fvdl(vuln('a', 'XSS', '', '3.0', ref), pool)));
    expect(r.findings[0].affected).toEqual(['src/P.java:3']);
  });

  it('flags an unrecognised severity instead of guessing', async () => {
    const r = await parseFortifyFile(upload('x.xml', fvdl(vuln('a', 'Odd', '', 'bogus', node('a', 1)))));
    expect(r.findings[0].problem).toMatch(/not recognised/);
  });

  it('rejects bad input without parsing it further', async () => {
    await expect(parseFortifyFile(undefined)).rejects.toThrow(/No file/);
    await expect(parseFortifyFile(upload('x.fpr', ''))).rejects.toThrow(/empty/);
    await expect(parseFortifyFile(upload('x.fpr', 'not a zip'))).rejects.toThrow(/not a valid Fortify/);
    await expect(parseFortifyFile(upload('x.txt', 'x'))).rejects.toThrow(/Unsupported/);
    await expect(parseFortifyFile(upload('x.fpr', await fpr({ 'other.txt': 'x' })))).rejects.toThrow(/audit\.fvdl/);
    await expect(parseFortifyFile(upload('x.xml', '<FVDL><Vulnerabilities></FVDL>'))).rejects.toThrow(/not valid XML/);
    await expect(parseFortifyFile(upload('x.xml', '<Other/>'))).rejects.toThrow(/not a Fortify FVDL/);
    await expect(parseFortifyFile(upload('x.xml', '<FVDL><Vulnerabilities/></FVDL>'))).rejects.toThrow(/No vulnerabilities/);
    await expect(parseFortifyFile(upload('x.xml', await fpr({ 'audit.fvdl': fvdl(body) })))).rejects.toThrow(/archive/);
    await expect(parseFortifyFile(upload('x.fvdl', await fpr({ 'audit.fvdl': fvdl(body) })))).rejects.toThrow(/archive/);
  });

  it('refuses a DOCTYPE / entity declaration', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE FVDL [<!ENTITY x SYSTEM "file:///etc/passwd">]>${fvdl(body)}`;
    await expect(parseFortifyFile(upload('x.xml', evil))).rejects.toThrow(/DOCTYPE/);
  });
});

describe('helpers', () => {
  it('maps severity scores and labels', () => {
    expect(['5', '4', '3', '2', '1', 'medium', '', 'x'].map(fortifySeverity)).toEqual(['Critical', 'High', 'Medium', 'Low', 'Info', 'Medium', '', '']);
  });
  it('extracts distinct CWE ids from text and MITRE URLs', () => {
    expect(extractCweIds('CWE ID 79, CWE-79 and https://cwe.mitre.org/data/definitions/89.html')).toBe('CWE-79, CWE-89');
  });
  it('cleans rich text', () => {
    expect(cleanRichText('&lt;Paragraph&gt;a  &lt;b&gt;b&lt;/b&gt;&lt;/Paragraph&gt;')).toBe('a \nb');
  });
});

describe('limits', () => {
  it('rejects a file with more distinct findings than the cap', async () => {
    const many = Array.from({ length: 5001 }, (_, i) => vuln(`i${i}`, `Type ${i}`, '', '4.0', node('a', 1))).join('');
    await expect(parseFortifyFile(upload('x.xml', fvdl(many)))).rejects.toThrow(/more distinct findings/);
  });
  it('rejects a single element that is larger than the per-element budget', async () => {
    const huge = '<Def key="a" value="' + 'x'.repeat(9 * 1024 * 1024) + '"/>';
    const v = vuln('a', 'Big', '', '4.0', node('a', 1)).replace('<ReplacementDefinitions>', '<ReplacementDefinitions>' + huge);
    await expect(parseFortifyFile(upload('x.xml', fvdl(v)))).rejects.toThrow(/too large/);
  });
});
