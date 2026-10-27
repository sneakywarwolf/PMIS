import { ISSUE_LOG_DEFAULT_COLUMNS, resolveIssueLogColumns, validateIssueLogColumns, buildIssueLogCsv } from './issue-log';

describe('issue-log', () => {
  it('defaults to the 12 standard headers in order, no POC column', () => {
    expect(resolveIssueLogColumns(undefined).map((c) => c.label).join('|')).toBe(
      'S. No|Vulnerability Name|Affected URL|Risk Rating|CVSS Base Score|CVSS Vector|Status|Description|Impact|Remediation|Panacea Remarks|Client Remarks',
    );
  });

  it('honours admin order/enabled and rejects bad config', () => {
    const cols = [{ ...ISSUE_LOG_DEFAULT_COLUMNS[1] }, { ...ISSUE_LOG_DEFAULT_COLUMNS[0], enabled: false }];
    expect(resolveIssueLogColumns(cols).map((c) => c.key)).toEqual(['vulnerability_name']);
    expect(validateIssueLogColumns([{ key: 'nope', enabled: true }])).toMatch(/unknown/);
    expect(validateIssueLogColumns(cols.map((c) => ({ ...c, enabled: false })))).toMatch(/at least one/);
  });

  it('escapes quotes and neutralises formulas', () => {
    const csv = buildIssueLogCsv(resolveIssueLogColumns(undefined).slice(0, 1), [['=cmd"x']]);
    expect(csv).toContain(`"'=cmd""x"`);
  });

  it('writes header labels without surrounding quotes and keeps the column order', () => {
    const csv = buildIssueLogCsv(resolveIssueLogColumns(undefined), []);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toBe(
      'S. No,Vulnerability Name,Affected URL,Risk Rating,CVSS Base Score,CVSS Vector,Status,Description,Impact,Remediation,Panacea Remarks,Client Remarks',
    );
    expect(header).not.toMatch(/["“”]/);
  });

  it('still quotes data cells, including legitimate quotation marks in the data', () => {
    const cols = resolveIssueLogColumns(undefined).slice(0, 2);
    const csv = buildIssueLogCsv(cols, [['1', 'He said "hi", twice']]);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('S. No,Vulnerability Name');
    expect(lines[1]).toBe('"1","He said ""hi"", twice"');
  });

  it('quotes a header label only when CSV syntax requires it', () => {
    const csv = buildIssueLogCsv([{ key: 'x', label: 'A, B' }, { key: 'y', label: 'C' }], []);
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('"A, B",C');
  });
});
