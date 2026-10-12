import { BadRequestException } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';
import { parseCsv, normalizeCsvHeader } from './csv-validation.util';

export type NessusSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

/** One Nessus plugin, with every host:port it fired on folded into `affected`. */
export interface NessusFinding {
  /** Nessus plugin ID: the stable key used for selection and duplicate detection. */
  key: string;
  name: string;
  severity: NessusSeverity;
  cvssScore: number | null;
  cvssVector: string | null;
  /** Which CVSS version cvssScore (and cvssVector, if any) belongs to. */
  cvssVersion: '3' | '2' | null;
  description: string;
  /** Nessus has no "impact" field; its plugin synopsis is the closest equivalent. */
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
  affected: string[];
  /** <plugin_output> per host:port the plugin fired on (empty/missing outputs are not recorded). .nessus only. */
  pluginOutputs: { at: string; text: string }[];
}

const SEVERITY_BY_LEVEL: NessusSeverity[] = ['Info', 'Low', 'Medium', 'High', 'Critical'];
const SEVERITY_BY_RISK: Record<string, NessusSeverity> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'Info', info: 'Info', informational: 'Info',
};

/**
 * Uploaded scan files are treated strictly as data: XML is parsed without entity/DTD support
 * (any DOCTYPE/ENTITY is rejected up front), CSV is split into plain strings, nothing is
 * evaluated, and every value is kept as text.
 */
export function parseNessusFile(file: { originalname?: string; buffer?: Buffer } | undefined): NessusFinding[] {
  if (!file?.buffer || file.buffer.length === 0) throw new BadRequestException('No file uploaded, or the file is empty.');
  // PK\x03\x04: a zip/Office container is never a valid .nessus or .csv.
  if (file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new BadRequestException('File content is a binary/Office archive, not a Nessus .nessus or .csv export.');
  }
  const text = file.buffer.toString('utf-8').replace(/^﻿/, '');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new BadRequestException('File does not look like a text Nessus export.');

  const name = (file.originalname || '').toLowerCase();
  let findings: NessusFinding[];
  if (name.endsWith('.nessus')) findings = parseNessusXml(text);
  else if (name.endsWith('.csv')) findings = parseNessusCsv(text);
  else throw new BadRequestException('Unsupported file type. Upload a Nessus .nessus (XML) or .csv export.');

  if (findings.length === 0) throw new BadRequestException('No findings were found in the file.');
  return findings;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function endpoint(host: string, port: string, protocol: string): string {
  return port && port !== '0' ? `${host}:${port}/${protocol || 'tcp'}` : host;
}

function toScore(raw: string | null | undefined): number | null {
  const n = parseFloat(raw ?? '');
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

/** Folds repeated plugin hits (one per host/port) into a single finding per plugin. */
function merge(map: Map<string, NessusFinding>, f: NessusFinding) {
  const existing = map.get(f.key);
  if (!existing) map.set(f.key, f);
  else {
    existing.affected = dedupe([...existing.affected, ...f.affected]);
    existing.pluginOutputs.push(...f.pluginOutputs);
  }
}

export function parseNessusXml(xml: string): NessusFinding[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new BadRequestException('Malformed Nessus file: DTD/entity declarations are not allowed.');
  }
  const problems: string[] = [];
  const doc = new DOMParser({ onError: (level: string, msg: string) => level !== 'warning' && problems.push(msg) } as any)
    .parseFromString(xml, 'text/xml');
  const root = doc?.documentElement;
  if (!root || problems.length) throw new BadRequestException('Malformed Nessus file: it is not valid XML.');
  if (root.nodeName !== 'NessusClientData_v2') {
    throw new BadRequestException('Unsupported XML: expected a Nessus v2 (.nessus) export.');
  }

  const out = new Map<string, NessusFinding>();
  const text = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const all = (el: Element, tag: string) => Array.from(el.getElementsByTagName(tag)).map((n) => n.textContent?.trim() ?? '');

  for (const host of Array.from(root.getElementsByTagName('ReportHost'))) {
    const hostName = host.getAttribute('name') || '';
    for (const item of Array.from(host.getElementsByTagName('ReportItem'))) {
      const key = item.getAttribute('pluginID') || '';
      const name = item.getAttribute('pluginName') || '';
      if (!key || !name) continue;

      const level = parseInt(item.getAttribute('severity') ?? '', 10);
      const severity = SEVERITY_BY_LEVEL[level] ?? SEVERITY_BY_RISK[text(item, 'risk_factor').toLowerCase()] ?? 'Info';
      const v3 = toScore(text(item, 'cvss3_base_score'));
      const v2 = toScore(text(item, 'cvss_base_score'));
      const vector3 = text(item, 'cvss3_vector');
      const at = endpoint(hostName, item.getAttribute('port') || '', item.getAttribute('protocol') || '');
      // Raw text as exported; only surrounding blank space is trimmed. Missing/empty stays empty, nothing is invented.
      const output = text(item, 'plugin_output');
      const xrefs = all(item, 'xref');
      const cwe = dedupe([...all(item, 'cwe'), ...xrefs.filter((x) => /^CWE:/i.test(x)).map((x) => 'CWE-' + x.split(':')[1])]);

      merge(out, {
        key,
        name,
        severity,
        cvssScore: v3 ?? v2,
        cvssVersion: v3 !== null || vector3 ? '3' : v2 !== null ? '2' : null,
        // The scan's own <cvss3_vector> is used as-is whenever present; the v2 vector only when the item has no v3 data at all.
        cvssVector: vector3 || (v3 === null ? text(item, 'cvss_vector') : '') || null,
        description: text(item, 'description'),
        impact: text(item, 'synopsis'),
        remediation: text(item, 'solution'),
        references: dedupe([...text(item, 'see_also').split(/\s+/), ...xrefs.filter((x) => !/^CWE:/i.test(x))]).join('\n'),
        cveId: dedupe(all(item, 'cve')).join(', ') || null,
        cweId: cwe.join(', ') || null,
        affected: [at],
        pluginOutputs: output ? [{ at, text: output }] : [],
      });
    }
  }
  return [...out.values()];
}

export function parseNessusCsv(content: string): NessusFinding[] {
  const rows = parseCsv(content.trim());
  if (rows.length < 2) throw new BadRequestException('The CSV file is empty or has no data rows.');

  const headers = rows[0].map(normalizeCsvHeader);
  const col = (...names: string[]) => headers.findIndex((h) => names.map(normalizeCsvHeader).includes(h));
  const idx = {
    plugin: col('Plugin ID'), name: col('Name'), risk: col('Risk'), host: col('Host'),
    port: col('Port'), protocol: col('Protocol'), cve: col('CVE'), cwe: col('CWE'),
    v3: col('CVSS v3.0 Base Score', 'CVSS v3 Base Score'), v2: col('CVSS v2.0 Base Score', 'CVSS Base Score'),
    synopsis: col('Synopsis'), description: col('Description'), solution: col('Solution'), seeAlso: col('See Also'),
  };
  const missing = (['plugin', 'name', 'risk', 'host'] as const).filter((k) => idx[k] < 0);
  if (missing.length) {
    throw new BadRequestException(
      `This does not look like a Nessus CSV export. Missing column(s): ${missing.map((m) => ({ plugin: 'Plugin ID', name: 'Name', risk: 'Risk', host: 'Host' }[m])).join(', ')}.`,
    );
  }

  const out = new Map<string, NessusFinding>();
  for (const row of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const key = get(idx.plugin);
    const name = get(idx.name);
    if (!key || !name) continue;
    const v3 = toScore(get(idx.v3));
    merge(out, {
      key,
      name,
      severity: SEVERITY_BY_RISK[get(idx.risk).toLowerCase()] ?? 'Info',
      cvssScore: v3 ?? toScore(get(idx.v2)),
      cvssVersion: v3 !== null ? '3' : toScore(get(idx.v2)) !== null ? '2' : null,
      cvssVector: null, // Nessus CSV exports carry scores only, not vector strings
      description: get(idx.description),
      impact: get(idx.synopsis),
      remediation: get(idx.solution),
      references: dedupe(get(idx.seeAlso).split(/\s+/)).join('\n'),
      cveId: dedupe(get(idx.cve).split(/[,\s]+/)).join(', ') || null,
      cweId: get(idx.cwe) || null,
      affected: [endpoint(get(idx.host), get(idx.port), get(idx.protocol))],
      pluginOutputs: [],
    });
  }
  return [...out.values()];
}
