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
});
