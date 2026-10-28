import { BadRequestException } from '@nestjs/common';
import * as sax from 'sax';
import { StringDecoder } from 'string_decoder';
import { CsvRowStream, normalizeCsvHeader } from './csv-validation.util';

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
  /** <plugin_output> per host:port the plugin fired on (empty/missing outputs are not recorded). From <plugin_output> in .nessus, or the Plugin Output column in .csv. */
  pluginOutputs: { at: string; text: string }[];
}

const SEVERITY_BY_LEVEL: NessusSeverity[] = ['Info', 'Low', 'Medium', 'High', 'Critical'];
const SEVERITY_BY_RISK: Record<string, NessusSeverity> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'Info', info: 'Info', informational: 'Info',
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// eslint-disable-next-line no-control-regex
/** Control characters other than tab, newline and carriage return. */
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
/** A NUL in the start of the file means binary content; further in, stray control characters are scan output. */
const BINARY_HEAD_BYTES = 8192;

/**
 * The most plugin output a finding keeps when imported (the rest is cut with a marker, see
 * FindingsService.nessusPocText). The readers never hold more than this per plugin (one character extra, so
 * "longer than the cap" is still detectable), which keeps a scan with gigabytes of output in bounded memory.
 */
export const NESSUS_POC_MAX = 32000;

/** A CSV field is cut at this length: real descriptions are far shorter, and a runaway quoted field must not eat memory. */
const MAX_CSV_FIELD_CHARS = 1024 * 1024;

/**
 * Uploaded scan files are treated strictly as data: XML is parsed without entity/DTD support
 * (any DOCTYPE/ENTITY is rejected up front), CSV is split into plain strings, nothing is
 * evaluated, and every value is kept as text. An upload is read as it arrives (see scanStreamFor);
 * this is the same reader run over a file already held in memory.
 */
export function parseNessusFile(file: { originalname?: string; buffer?: Buffer } | undefined): NessusFinding[] {
  if (!file?.buffer || file.buffer.length === 0) throw new BadRequestException('No file uploaded, or the file is empty.');
  const stream = scanStreamFor(file.originalname);
  stream.write(file.buffer);
  return stream.end();
}

/** The reader for a scan file, chosen by its extension. An unsupported type is refused before any of the file is read. */
export function scanStreamFor(originalname?: string): ScanStream {
  const name = (originalname || '').toLowerCase();
  if (name.endsWith('.nessus')) return new NessusXmlStream();
  if (name.endsWith('.csv')) return new NessusCsvStream();
  throw new BadRequestException('Unsupported file type. Upload a Nessus .nessus (XML) or .csv export.');
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

/**
 * What the readers share. A file is fed in chunk by chunk and never kept: only the findings extracted from it
 * are, so a scan of any size is processed in memory proportional to its findings. The checks on the raw bytes
 * (an Office/zip archive, binary content) and the folding of repeated plugin hits into one finding live here.
 */
export abstract class ScanStream {
  private decoder = new StringDecoder('utf8');
  private readonly found = new Map<string, NessusFinding>();
  /** Endpoints seen per plugin, so folding a host in is O(1) instead of re-deduping the list on every hit. */
  private readonly seen = new Map<string, Set<string>>();
  private readonly outputs = new Map<string, { count: number; chars: number }>();
  private head = Buffer.alloc(0);
  private bytes = 0;
  private started = false;

  /** Which text encoding the file turned out to be (from its byte-order mark): UTF-8 unless it is UTF-16. */
  private wide: 'le' | 'be' | null = null;
  private carry: Buffer | null = null;

  write(chunk: Buffer): void {
    const before = this.bytes;
    this.bytes += chunk.length;
    if (this.head.length < 4) {
      // PK\x03\x04: a zip/Office container is never a valid .nessus or .csv.
      this.head = Buffer.concat([this.head, chunk.subarray(0, 4 - this.head.length)]);
      if (this.head.length === 4 && this.head.equals(ZIP_MAGIC)) {
        throw new BadRequestException('File content is a binary/Office archive, not a Nessus .nessus or .csv export.');
      }
    }
    // Excel and some tools save "Unicode text": UTF-16 with a byte-order mark. Read it instead of refusing it.
    if (before === 0 && chunk.length >= 2) {
      if (chunk[0] === 0xff && chunk[1] === 0xfe) this.wide = 'le';
      else if (chunk[0] === 0xfe && chunk[1] === 0xff) this.wide = 'be';
      if (this.wide) this.decoder = new StringDecoder('utf16le');
    }
    // A NUL near the start of a UTF-8 file means binary content.
    if (!this.wide && before < BINARY_HEAD_BYTES && chunk.subarray(0, BINARY_HEAD_BYTES - before).includes(0)) {
      throw new BadRequestException('File does not look like a text Nessus export (it contains binary data).');
    }
    let text = this.decoder.write(this.wide === 'be' ? this.swapped(chunk) : chunk);
    if (!this.started && text) {
      this.started = true;
      text = text.replace(/^\uFEFF/, '');
    }
    this.feed(text);
  }

  /** Big-endian UTF-16 to little-endian, keeping a byte that is cut off at the end of a chunk for the next one. */
  private swapped(chunk: Buffer): Buffer {
    const all = this.carry ? Buffer.concat([this.carry, chunk]) : chunk;
    const even = all.length - (all.length % 2);
    this.carry = even < all.length ? Buffer.from(all.subarray(even)) : null;
    return Buffer.from(all.subarray(0, even)).swap16();
  }

  end(): NessusFinding[] {
    if (this.bytes === 0) throw new BadRequestException('No file uploaded, or the file is empty.');
    this.feed(this.decoder.end());
    this.finish();
    if (this.found.size === 0) throw new BadRequestException('No findings were found in the file.');
    return [...this.found.values()];
  }

  /** Decoded text of the file, in order. */
  protected abstract consume(text: string): void;
  /** The file has ended: flush the parser and reject a file that turned out to be incomplete. */
  protected abstract finish(): void;

  private feed(text: string) {
    if (!text) return;
    // Scan output often carries stray control characters (escape sequences from banners and prompts): they are
    // replaced by a space, and the file is still read, instead of the whole upload being refused for them.
    this.consume(text.replace(CONTROL_CHARS, ' '));
  }

  /** One hit of a plugin on one endpoint. `create` builds the finding the first time the plugin is seen. */
  protected hit(key: string, at: string, output: string, create: () => Omit<NessusFinding, 'affected' | 'pluginOutputs'>) {
    // A plugin's outputs only matter up to the stored cap. Once past it, and with at least two held (which decides
    // how they are laid out), later ones are dropped, so a plugin firing on thousands of hosts stays small.
    const kept = this.outputs.get(key) ?? { count: 0, chars: 0 };
    const keepOutput = !!output && (kept.count < 2 || kept.chars < NESSUS_POC_MAX);
    if (keepOutput) {
      kept.count++;
      kept.chars += output.length;
      this.outputs.set(key, kept);
    }

    const existing = this.found.get(key);
    if (!existing) {
      this.found.set(key, { ...create(), affected: [at], pluginOutputs: keepOutput ? [{ at, text: output }] : [] });
      return;
    }
    let seen = this.seen.get(key);
    if (!seen) {
      existing.affected = dedupe(existing.affected);
      seen = new Set(existing.affected);
      this.seen.set(key, seen);
    }
    const endpointKey = at.trim();
    if (endpointKey && !seen.has(endpointKey)) {
      seen.add(endpointKey);
      existing.affected.push(endpointKey);
    }
    if (keepOutput) existing.pluginOutputs.push({ at, text: output });
  }
}

/**
 * Reader for a .nessus (XML) export. Same rules as the rest of the importer: no DTD/entities (a DOCTYPE is
 * rejected), values are kept as text and nothing is evaluated.
 */
export class NessusXmlStream extends ScanStream {
  private readonly parser = sax.parser(true, { trim: false, normalize: false, lowercase: false, xmlns: false, position: false });
  private depth = 0;
  private host = '';
  private item: { attrs: Record<string, string>; host: string; depth: number; fields: Record<string, string[]> } | null = null;
  private child: { tag: string; text: string } | null = null;

  constructor() {
    super();
    const p = this.parser;
    p.onerror = () => { throw new BadRequestException('Malformed Nessus file: it is not valid XML.'); };
    p.ondoctype = () => { throw new BadRequestException('Malformed Nessus file: DTD/entity declarations are not allowed.'); };
    p.onopentag = (tag) => this.open(tag.name, tag.attributes as Record<string, string>);
    p.onclosetag = () => this.close();
    p.ontext = (t) => this.text(t);
    p.oncdata = (t) => this.text(t);
  }

  static parse(buffer: Buffer): NessusFinding[] {
    const stream = new NessusXmlStream();
    stream.write(buffer);
    return stream.end();
  }

  protected consume(text: string) {
    this.parser.write(text);
  }

  protected finish() {
    this.parser.close();
  }

  private open(name: string, attrs: Record<string, string>) {
    if (++this.depth === 1 && name !== 'NessusClientData_v2') {
      throw new BadRequestException('Unsupported XML: expected a Nessus v2 (.nessus) export.');
    }
    if (name === 'ReportHost') this.host = attrs.name || '';
    else if (name === 'ReportItem') this.item = { attrs, host: this.host, depth: this.depth, fields: {} };
    else if (this.item && this.depth === this.item.depth + 1) this.child = { tag: name, text: '' };
  }

  private text(t: string) {
    // ponytail: plugin_output is read up to 4x what is ever stored; blank space beyond that in front of the text is not expected.
    if (this.child && (this.child.tag !== 'plugin_output' || this.child.text.length <= 4 * (NESSUS_POC_MAX + 1))) this.child.text += t;
  }

  private close() {
    const item = this.item;
    if (item && this.child && this.depth === item.depth + 1) {
      (item.fields[this.child.tag] ??= []).push(this.child.text.trim());
      this.child = null;
    } else if (item && this.depth === item.depth) {
      this.item = null;
      this.addItem(item);
    }
    this.depth--;
  }

  private addItem({ attrs, host, fields }: { attrs: Record<string, string>; host: string; fields: Record<string, string[]> }) {
    const key = attrs.pluginID || '';
    const name = attrs.pluginName || '';
    if (!key || !name) return;

    const text = (tag: string) => fields[tag]?.[0] ?? '';
    const all = (tag: string) => fields[tag] ?? [];
    const at = endpoint(host, attrs.port || '', attrs.protocol || '');
    // Raw text as exported; only surrounding blank space is trimmed. Missing/empty stays empty, nothing is invented.
    const output = text('plugin_output').slice(0, NESSUS_POC_MAX + 1);

    this.hit(key, at, output, () => {
      const level = parseInt(attrs.severity ?? '', 10);
      const v3 = toScore(text('cvss3_base_score'));
      const v2 = toScore(text('cvss_base_score'));
      const vector3 = text('cvss3_vector');
      const xrefs = all('xref');
      const cwe = dedupe([...all('cwe'), ...xrefs.filter((x) => /^CWE:/i.test(x)).map((x) => 'CWE-' + x.split(':')[1])]);
      return {
        key,
        name,
        severity: SEVERITY_BY_LEVEL[level] ?? SEVERITY_BY_RISK[text('risk_factor').toLowerCase()] ?? 'Info',
        cvssScore: v3 ?? v2,
        cvssVersion: v3 !== null || vector3 ? '3' : v2 !== null ? '2' : null,
        // The scan's own <cvss3_vector> is used as-is whenever present; the v2 vector only when the item has no v3 data at all.
        cvssVector: vector3 || (v3 === null ? text('cvss_vector') : '') || null,
        description: text('description'),
        impact: text('synopsis'),
        remediation: text('solution'),
        references: dedupe([...text('see_also').split(/\s+/), ...xrefs.filter((x) => !/^CWE:/i.test(x))]).join('\n'),
        cveId: dedupe(all('cve')).join(', ') || null,
        cweId: cwe.join(', ') || null,
      };
    });
  }
}

/** A whole .nessus held as one string (tests, small inputs); uploads stream through NessusXmlStream directly. */
export function parseNessusXml(xml: string): NessusFinding[] {
  return NessusXmlStream.parse(Buffer.from(xml, 'utf8'));
}

/** Reader for a Nessus .csv export: one row per plugin per host, folded into one finding per plugin. */
export class NessusCsvStream extends ScanStream {
  private rows: CsvRowStream | null = null;
  /** The start of the file, until its first line is complete and the delimiter can be chosen from the header. */
  private pending = '';
  private idx: Record<'plugin' | 'name' | 'risk' | 'host' | 'port' | 'protocol' | 'cve' | 'cwe' | 'v3' | 'v2' | 'synopsis' | 'description' | 'solution' | 'seeAlso' | 'pluginOutput' | 'xref', number> | null = null;
  private dataRows = 0;

  protected consume(text: string) {
    if (this.rows) {
      this.rows.write(text);
      return;
    }
    this.pending += text;
    const nl = this.pending.indexOf('\n');
    // Wait for the whole header line (or a generous amount of text without one) before choosing the delimiter.
    if (nl < 0 && this.pending.length < 1024 * 1024) return;
    this.startRows();
  }

  /**
   * Nessus writes commas, but a CSV re-saved from a spreadsheet in some regions uses semicolons or tabs. The
   * header line decides: whichever of the three separates it into the most columns.
   */
  private startRows() {
    const head = this.pending.slice(0, Math.max(this.pending.indexOf('\n'), 0) || this.pending.length);
    const count = (d: string) => head.split(d).length;
    const delimiter = ([',', ';', '\t'] as const).reduce((best, d) => (count(d) > count(best) ? d : best), ',' as ',' | ';' | '\t');
    this.rows = new CsvRowStream((row) => this.row(row), { maxFieldChars: MAX_CSV_FIELD_CHARS, delimiter });
    const text = this.pending;
    this.pending = '';
    this.rows.write(text);
  }

  protected finish() {
    if (!this.rows) this.startRows();
    this.rows!.end();
    if (!this.idx || this.dataRows === 0) throw new BadRequestException('The CSV file is empty or has no data rows.');
  }

  private columns(header: string[]) {
    const headers = header.map(normalizeCsvHeader);
    const col = (...names: string[]) => headers.findIndex((h) => names.map(normalizeCsvHeader).includes(h));
    const idx = {
      plugin: col('Plugin ID'), name: col('Name'), risk: col('Risk'), host: col('Host'),
      port: col('Port'), protocol: col('Protocol'), cve: col('CVE'), cwe: col('CWE'),
      v3: col('CVSS v3.0 Base Score', 'CVSS v3 Base Score'), v2: col('CVSS v2.0 Base Score', 'CVSS Base Score'),
      synopsis: col('Synopsis'), description: col('Description'), solution: col('Solution'), seeAlso: col('See Also'),
      // Optional: an export made without the Plugin Output column simply has none, as before.
      pluginOutput: col('Plugin Output'),
      // Exports without a CWE column carry the CWE only inside XREF ("CWE:295"), as .nessus <xref> does.
      xref: col('XREF'),
    };
    const missing = (['plugin', 'name', 'risk', 'host'] as const).filter((k) => idx[k] < 0);
    if (missing.length) {
      throw new BadRequestException(
        `This does not look like a Nessus CSV export. Missing column(s): ${missing.map((m) => ({ plugin: 'Plugin ID', name: 'Name', risk: 'Risk', host: 'Host' }[m])).join(', ')}.`,
      );
    }
    return idx;
  }

  private row(row: string[]) {
    const blank = !row.some((cell) => cell.trim());
    if (!this.idx) {
      if (!blank) this.idx = this.columns(row); // blank lines ahead of the header are skipped
      return;
    }
    if (blank) return;
    this.dataRows++;
    const idx = this.idx;
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const key = get(idx.plugin);
    const name = get(idx.name);
    if (!key || !name) return;
    const at = endpoint(get(idx.host), get(idx.port), get(idx.protocol));

    // The row's Plugin Output is read exactly as the .nessus <plugin_output> is (trimmed, capped), per host:port, so
    // {VA Output} and the finding's PoC come out the same for both formats. An empty cell records nothing.
    // The first row of a plugin supplies everything but its endpoints and outputs.
    this.hit(key, at, get(idx.pluginOutput).slice(0, NESSUS_POC_MAX + 1), () => {
      const v3 = toScore(get(idx.v3));
      const v2 = toScore(get(idx.v2));
      return {
        key,
        name,
        severity: SEVERITY_BY_RISK[get(idx.risk).toLowerCase()] ?? 'Info',
        cvssScore: v3 ?? v2,
        cvssVersion: v3 !== null ? '3' : v2 !== null ? '2' : null,
        cvssVector: null, // Nessus CSV exports carry scores only, not vector strings
        description: get(idx.description),
        impact: get(idx.synopsis),
        remediation: get(idx.solution),
        references: dedupe(get(idx.seeAlso).split(/\s+/)).join('\n'),
        cveId: dedupe(get(idx.cve).split(/[,\s]+/)).join(', ') || null,
        cweId: get(idx.cwe) || dedupe([...get(idx.xref).matchAll(/\bCWE[\s:#-]*(\d+)/gi)].map((m) => `CWE-${m[1]}`)).join(', ') || null,
      };
    });
  }
}

/** A whole .csv held as one string (tests, small inputs); uploads stream through NessusCsvStream directly. */
export function parseNessusCsv(content: string): NessusFinding[] {
  const stream = new NessusCsvStream();
  stream.write(Buffer.from(content, 'utf8'));
  return stream.end();
}
