import { validateProjectFindingFields } from './project-finding-fields.util';

const SEV = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const ok = {
  name: 'SQL Injection', severity: 'high', cvssScore: '8.1', cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
  description: 'd', impact: 'i', remediation: 'r', references: 'https://x', cveId: 'cve-2023-12345', cweId: 'CWE-89',
};

describe('validateProjectFindingFields', () => {
  it('accepts a complete record and normalises severity, ids and score', () => {
    const r = validateProjectFindingFields(ok, SEV);
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ severity: 'High', cvssScore: 8.1, cveId: 'CVE-2023-12345', cweId: 'CWE-89' });
  });

  it('only name, severity, description, impact, remediation and reference are required', () => {
    const r = validateProjectFindingFields({ ...ok, cvssScore: '', cvssVector: '', cveId: '', cweId: '' }, SEV);
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ cvssScore: null, cvssVector: null, cveId: null, cweId: null });
    const missing = validateProjectFindingFields({ ...ok, name: ' ', impact: '' }, SEV);
    expect(missing.errors).toEqual(expect.arrayContaining(['Vulnerability Name is required.', 'Impact is required.']));
  });

  it('rejects unsupported severity, out-of-range score and malformed vector / ids', () => {
    expect(validateProjectFindingFields({ ...ok, severity: 'Severe' }, SEV).errors.join()).toMatch(/Severity "Severe" is not supported/);
    expect(validateProjectFindingFields({ ...ok, cvssScore: '10.5' }, SEV).errors.join()).toMatch(/CVSS Score/);
    expect(validateProjectFindingFields({ ...ok, cvssScore: 'abc' }, SEV).errors.join()).toMatch(/CVSS Score/);
    expect(validateProjectFindingFields({ ...ok, cvssVector: 'AV:N/AC:L' }, SEV).errors.join()).toMatch(/CVSS Vector/);
    expect(validateProjectFindingFields({ ...ok, cveId: 'CVE-12' }, SEV).errors.join()).toMatch(/CVE ID/);
    expect(validateProjectFindingFields({ ...ok, cweId: 'XSS' }, SEV).errors.join()).toMatch(/CWE ID/);
  });

  it('computes the score from a v3 vector when no score is given, like the CVSS calculator', () => {
    const r = validateProjectFindingFields({ ...ok, cvssScore: '' }, SEV);
    expect(r.value?.cvssScore).toBe(9.1); // AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N is 9.1 in CVSS 3.1
  });

  it('accepts a CVSS v2 vector and a bare CWE number', () => {
    const r = validateProjectFindingFields({ ...ok, cvssVector: 'AV:N/AC:L/Au:N/C:P/I:P/A:P', cweId: '79' }, SEV);
    expect(r.errors).toEqual([]);
    expect(r.value?.cweId).toBe('CWE-79');
  });

  it('rejects over-long fields and control characters', () => {
    expect(validateProjectFindingFields({ ...ok, name: 'x'.repeat(301) }, SEV).errors.join()).toMatch(/too long/);
    expect(validateProjectFindingFields({ ...ok, description: 'a\u0000b' }, SEV).errors.join()).toMatch(/control characters/);
  });

  it('keeps legitimate quotes, newlines and leading "=" text as plain data', () => {
    const r = validateProjectFindingFields({ ...ok, description: 'He said "hi"\nline2', impact: '=1+1' }, SEV);
    expect(r.value?.description).toBe('He said "hi"\nline2');
    expect(r.value?.impact).toBe('=1+1');
  });
});
