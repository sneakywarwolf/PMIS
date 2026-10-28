import { BadRequestException } from '@nestjs/common';
import * as sax from 'sax';
import JSZip from 'jszip';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';

/**
 * Fortify SCA results (.fpr, or the FVDL .xml inside it) read into PMIS findings. The field mapping and
 * normalisation rules follow the reference utility tmp/FPR-to-XLSXV2.0/fpr_to_excel_updated.py:
 *   Name          ClassInfo Type[: Subtype] (approved category prefixes dropped, see NAME_PREFIXES)
 *   Severity      InstanceSeverity score (>=4.5 Critical, >=3.5 High, >=2.5 Medium, >=1.5 Low, else Info),
 *                 or the exact-name overrides in SEVERITY_OVERRIDES
 *   Description   Description/Explanation (rich text cleaned, <Replace key=.../> filled per instance)
 *   Impact        Description/Abstract
 *   Remediation   Description/Recommendations
 *   References    Description/References, numbered "[n] Title, Author|Publisher, Source"
 *   CVE / CWE     found in the references / description metadata
 *   Instances     primary-trace location (path:line) of each active instance
 * Instances are grouped by (name, severity) and suppressed ones (audit.xml, .fpr only) are left out.
 *
 * Uploaded files are data only: nothing is executed, XML is read with sax (no entity expansion; any DOCTYPE is
 * refused), the archive is never extracted to disk, and every read is bounded (see the MAX_ constants).
 */

export interface FortifyFinding {
  /** Stable key (normalised name + severity) used for selection and duplicate detection. */
  key: string;
  name: string;
  severity: string;
  description: string;
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
  /** path:line of each instance (capped at MAX_INSTANCES). */
  affected: string[];
  instanceCount: number;
  /** Primary data-flow trace of the first instance, when Fortify recorded one. */
  trace: string;
  /** Set when the record can't be imported as-is; it is listed in the preview but not selectable. */
  problem?: string;
}

export interface FortifyResult {
  findings: FortifyFinding[];
  /** Active (non-suppressed) instances read. */
  activeInstances: number;
  suppressedInstances: number;
  /** false for a bare .xml: suppression lives in audit.xml, which only an .fpr carries. */
  suppressionApplied: boolean;
}

/** Largest XML document (audit.fvdl, or an uploaded .xml) read, after decompression. */
export const MAX_XML_BYTES = 512 * 1024 * 1024;
/** What is kept, not just what is read: distinct findings, rule descriptions and node-pool locations. */
const MAX_GROUPS = 5000;
const MAX_DESCRIPTIONS = 5000;
const MAX_POOL_NODES = 500000;
const tooMany = () => new BadRequestException('This Fortify file has more distinct findings than can be read safely.');
/** audit.xml (suppression data) is small in practice. */
const MAX_AUDIT_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
export const MAX_INSTANCES = 5000;
const MAX_NODES_PER_ELEMENT = 200000;
const MAX_TRACE_STEPS = 60;
export const FORTIFY_MAX_BYTES = 300 * 1024 * 1024;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// ─── Reference-utility rules ───

const NAME_PREFIXES = ['Key Management', 'Dynamic Code Evaluation', 'Android Bad Practices', 'Code Correctness', 'Cookie Security', 'Poor Logging Practice'];

const normName = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();

const SEVERITY_OVERRIDES: Record<string, string> = Object.fromEntries(
  Object.entries({
    High: ['Hardcoded Encryption Key', 'Hardcoded Key', 'Password Management: Hardcoded Password', 'Password Management: Password in Comment', 'Password Management: Password in Configuration File'],
    Medium: [
      'Android Misconfiguration: Debug Information', 'Command Injection', 'Cross-Site Scripting: Persistent', 'Cross-Site Scripting: Reflected', 'Code Injection', 'Insecure Randomness',
      'Privacy Violation', 'Privacy Violation: Autocomplete', 'Privacy Violation: Heap Inspection', 'Privacy Violation: iOS Property List', 'Privacy Violation: Shoulder Surfing',
      'Privilege Management: Android Data Storage', 'Privilege Management: Android Location', 'Weak Cryptographic Hash', 'Weak Cryptographic Hash: Insecure PBE Iteration Count', 'Weak Encryption',
      'Weak Encryption: Inadequate RSA Padding', 'Weak Encryption: Insecure Initialization Vector', 'Weak Encryption: Insecure Mode of Operation', 'Weak Encryption: Insufficient Key Size',
    ],
    Low: [
      'Access Specifier Manipulation', 'Missing Component Permission', 'Missing Google Play Services Updated Security Provider', 'Missing Network Security Configuration',
      'ASP.NET Misconfiguration: Debug Information', 'ASP.NET Misconfiguration: Excessive Session Timeout', 'ASP.NET Misconfiguration: Missing Error Handling', 'ASP.NET Misconfiguration: Request Validation Disabled',
      'Byte Array to String Conversion', 'Cookie Security: Cookie not Sent Over SSL', 'HTTPOnly not Set', 'HTTPOnly not Set on Application Cookie', 'HTTPOnly not Set on Session Cookie',
      'Overly Broad Session Cookie Path', 'Cross-Site Request Forgery', 'Hardcoded Domain in HTML', 'Header Manipulation', 'Hidden Field', 'HTML5: Form Validation Turned Off', 'HTML5: MIME Sniffing',
      'HTML5: Overly Permissive CORS Policy', 'HTML5: Overly Permissive Message Posting Policy', 'Insecure SSL: Overly Broad Certificate Trust', 'Insecure SSL: Server Identity Verification Disabled',
      'Insecure Storage: Android Backup Storage', 'Insecure Transport', 'Insecure Transport: Database', 'Insecure Transport: Disabled App Transport Security', 'Insecure Transport: Mail Transmission',
      'J2EE Misconfiguration: Excessive Session Timeout', 'Missing XML Validation', 'Often Misused: File Upload', 'Open Redirect', 'Password Management: Insecure Submission', 'Path Manipulation',
      'Poor Error Handling: Empty Catch Block', 'Poor Logging Practice: Use of a System Output Stream', 'Server-Side Request Forgery', 'Spring Boot Misconfiguration: DevTools Enabled',
      'System Information Leak', 'System Information Leak: External', 'System Information Leak: Internal', 'Trust Boundary Violation', 'Unreleased Resource: Streams',
      'Weak XML Schema: Unbounded Occurrences', 'XML External Entity Injection', 'Android: Clear Text Traffic Enabled', 'ASP.NET Misconfiguration: Information Disclosure', 'Persistent Cookie',
    ],
  }).flatMap(([sev, names]) => names.map((n) => [normName(n), sev])),
);

const SEVERITY_WORDS: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', moderate: 'Medium', low: 'Low', informational: 'Info', info: 'Info',
};

/** Fortify instance-severity score (1-5) or label to a PMIS severity; '' when it is neither. */
export function fortifySeverity(raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const word = SEVERITY_WORDS[v.toLowerCase()];
  if (word) return word;
  const score = parseFloat(v);
  if (!Number.isFinite(score)) return '';
  return score >= 4.5 ? 'Critical' : score >= 3.5 ? 'High' : score >= 2.5 ? 'Medium' : score >= 1.5 ? 'Low' : 'Info';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Fortify rich text (escaped HTML-ish markup with <Replace key=.../> placeholders) to plain text. */
export function cleanRichText(raw: string, replacements: Record<string, string> = {}): string {
  if (!raw) return '';
  let s = unescapeHtml(raw);
  s = s.replace(/<Replace\s+key=["']([^"']+)["'][^>]*\/?>/gi, (_m, k: string) => replacements[k] ?? '');
  s = s.replace(/<\/?(?:Paragraph|AltParagraph|Content|pre|code|b|i|ul|ol|li|br|p|div|table|tr|td|th)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = unescapeHtml(s);
  s = s.replace(/[ \t ]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function extractCweIds(...values: (string | null | undefined)[]): string {
  const explicit = /\bCWE\b\s*(?:(?:ID|identifier|number)\s*)?(?:[-:#]\s*|\s+)?(\d{1,5})\b/gi;
  const mitre = /cwe\.mitre\.org\/(?:data\/)?definitions\/(\d{1,5})(?:\.html)?/gi;
  const found: number[] = [];
  for (const value of values) {
    if (value == null) continue;
    const text = unescapeHtml(String(value));
    const hits: [number, number][] = [];
    for (const re of [explicit, mitre]) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) hits.push([m.index, parseInt(m[1], 10)]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    found.push(...hits.map((h) => h[1]));
  }
  return [...new Set(found)].map((n) => `CWE-${n}`).join(', ');
}

// ─── Streaming XML into small subtrees ───

interface XNode { name: string; attrs: Record<string, string>; text: string; children: XNode[] }

const local = (name: string) => name.slice(name.indexOf(':') + 1);
const child = (n: XNode | undefined, ...path: string[]): XNode | undefined => path.reduce<XNode | undefined>((cur, p) => cur?.children.find((c) => c.name === p), n);
const kids = (n: XNode | undefined, name: string) => (n?.children ?? []).filter((c) => c.name === name);
const textOf = (n: XNode | undefined, ...path: string[]) => (child(n, ...path)?.text ?? '').trim();

/**
 * Feeds XML chunks to sax and hands back every element whose path (from the root, local names) is one of
 * `wanted`, as a small tree, then forgets it. Memory stays at one element, not the document.
 */
class SubtreeReader {
  private parser = sax.parser(true, { trim: false, normalize: false });
  private stack: string[] = [];
  private building: XNode[] = [];
  private nodes = 0;
  bytes = 0;
  rootName = '';
  sawDoctype = false;

  constructor(private wanted: (path: string) => boolean, private onElement: (path: string, node: XNode) => void, private maxBytes: number) {
    const p = this.parser;
    p.onerror = (e) => {
      throw e;
    };
    p.ondoctype = () => {
      this.sawDoctype = true;
      throw new BadRequestException('This file declares a DOCTYPE/entities, which are not accepted for security reasons.');
    };
    p.onopentag = (tag) => {
      const name = local(tag.name);
      if (this.stack.length === 0) this.rootName = name;
      this.stack.push(name);
      if (this.building.length === 0 && !this.wanted(this.stack.join('/'))) return;
      if (++this.nodes > MAX_NODES_PER_ELEMENT) throw new BadRequestException('The file has an element that is too large to read safely.');
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(tag.attributes)) attrs[local(k)] = String(v);
      const node: XNode = { name, attrs, text: '', children: [] };
      this.building.at(-1)?.children.push(node);
      this.building.push(node);
    };
    const text = (t: string) => {
      const top = this.building.at(-1);
      if (top && top.text.length < 5 * 1024 * 1024) top.text += t;
    };
    p.ontext = text;
    p.oncdata = text;
    p.onclosetag = () => {
      const path = this.stack.join('/');
      this.stack.pop();
      if (this.building.length === 0) return;
      const done = this.building.pop()!;
      if (this.building.length === 0) {
        this.nodes = 0;
        this.onElement(path, done);
      }
    };
  }

  private wrap(err: unknown): never {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException(`The file is not valid XML: ${String((err as Error)?.message ?? err).split('\n')[0]}`);
  }

  write(chunk: string | Buffer) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) throw new BadRequestException('The XML inside this file is larger than the supported limit.');
    try {
      this.parser.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    } catch (e) {
      this.wrap(e);
    }
  }

  end() {
    try {
      this.parser.close();
    } catch (e) {
      this.wrap(e);
    }
  }
}

/** Reads a stream (a Node Readable or a JSZip stream) through a SubtreeReader. Multi-byte characters split across chunks are handled by the decoder. */
function pump(source: Pick<Readable, 'on' | 'pause'>, reader: SubtreeReader): Promise<void> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let failed = false;
    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      source.pause();
      reject(e);
    };
    source.on('data', (chunk: Buffer) => {
      if (failed) return;
      try {
        reader.write(decoder.write(chunk));
      } catch (e) {
        fail(e);
      }
    });
    source.on('error', fail);
    source.on('end', () => {
      if (failed) return;
      try {
        reader.write(decoder.end());
        reader.end();
        resolve();
      } catch (e) {
        fail(e);
      }
    });
  });
}

// ─── FVDL ───

type Loc = { path: string; line: string };
interface Group {
  name: string;
  severity: string;
  classId: string;
  repl: Record<string, string>;
  /** Locations in encounter order; a string is a NodeRef still to be resolved against the node pool. */
  locs: (Loc | string)[];
  trace: (Loc & { note: string } | { ref: string })[];
  count: number;
}

function nodeLocation(node: XNode | undefined): Loc | null {
  const sl = child(node, 'SourceLocation');
  return sl ? { path: sl.attrs.path ?? '', line: sl.attrs.line ?? '' } : null;
}

/** Primary location of one vulnerability instance, as the reference utility reads it: the default node, else the first with a location. */
function primaryLocation(vuln: XNode): { loc: Loc | string | null; trace: Group['trace'] } {
  const entries = kids(child(vuln, 'AnalysisInfo', 'Unified', 'Trace', 'Primary'), 'Entry');
  const nodes: { node?: XNode; ref?: string }[] = [];
  for (const e of entries) {
    for (const n of e.children) {
      if (n.name === 'Node') nodes.push({ node: n });
      else if (n.name === 'NodeRef' && n.attrs.id) nodes.push({ ref: n.attrs.id });
    }
  }
  const trace: Group['trace'] = nodes.slice(0, MAX_TRACE_STEPS).map((n) => {
    if (n.ref) return { ref: n.ref };
    const l = nodeLocation(n.node);
    return { path: l?.path ?? '', line: l?.line ?? '', note: (n.node!.attrs.label ?? textOf(n.node, 'Action')).trim() };
  });
  for (const n of nodes) {
    if (n.node?.attrs.isDefault?.toLowerCase() === 'true') {
      const l = nodeLocation(n.node);
      if (l) return { loc: l, trace };
    }
  }
  for (const n of nodes) {
    if (n.ref) return { loc: n.ref, trace };
    const l = nodeLocation(n.node);
    if (l) return { loc: l, trace };
  }
  return { loc: null, trace };
}

const fmtLoc = (l: Loc | null) => (!l ? 'Location not available' : l.path && l.line ? `${l.path}:${l.line}` : l.path || (l.line ? `Line ${l.line}` : 'Location not available'));

function readDescription(desc: XNode) {
  const refs: string[] = [];
  const cves: string[] = [];
  const cwes: string[] = [];
  for (const ref of kids(child(desc, 'References'), 'Reference')) {
    const title = textOf(ref, 'Title');
    const author = textOf(ref, 'Author');
    const publisher = textOf(ref, 'Publisher');
    const url = textOf(ref, 'Source') || textOf(ref, 'URL');
    const parts = [title, author || publisher, url].filter(Boolean);
    if (!parts.length) continue;
    refs.push(parts.join(', ')); // repeated references are kept, as in the reference utility
    const combined = parts.join(' ');
    for (const c of combined.match(/\bCVE-\d{4}-\d{4,}\b/gi) ?? []) if (!cves.includes(c.toUpperCase())) cves.push(c.toUpperCase());
    cwes.push(extractCweIds(combined));
  }
  const all: string[] = [];
  const walk = (n: XNode) => {
    if (n.text.trim()) all.push(n.text.trim());
    all.push(...Object.values(n.attrs));
    n.children.forEach(walk);
  };
  walk(desc);
  return {
    abstract: textOf(desc, 'Abstract'),
    explanation: textOf(desc, 'Explanation'),
    recommendations: textOf(desc, 'Recommendations'),
    references: refs.map((r, i) => `[${i + 1}] ${r}`).join('\n'),
    cve: cves.join(', '),
    cwe: extractCweIds(cwes.filter(Boolean).join(', '), refs.join('\n'), all.join(' ')),
  };
}

/** Parses an FVDL document (the XML inside an .fpr, or a standalone .xml export) from a stream. */
async function readFvdl(source: Readable, suppressed: Set<string>): Promise<FortifyResult> {
  const groups = new Map<string, Group>();
  const descriptions = new Map<string, ReturnType<typeof readDescription>>();
  const pool = new Map<string, Loc>();
  let active = 0;
  let skipped = 0;
  let vulnerabilities = 0;

  const reader = new SubtreeReader(
    (path) => ['FVDL/Vulnerabilities/Vulnerability', 'FVDL/Description', 'FVDL/UnifiedNodePool/Node'].includes(path),
    (path, node) => {
      if (path.endsWith('/Description')) {
        if (descriptions.size >= MAX_DESCRIPTIONS) throw tooMany();
        descriptions.set(node.attrs.classID ?? '', readDescription(node));
      } else if (path.endsWith('/Node')) {
        const l = nodeLocation(node);
        if (l && node.attrs.id) {
          if (pool.size >= MAX_POOL_NODES) throw tooMany();
          pool.set(node.attrs.id, l);
        }
      } else {
        vulnerabilities++;
        const inst = child(node, 'InstanceInfo');
        const info = child(node, 'ClassInfo');
        if (!inst || !info) return;
        const instanceId = textOf(inst, 'InstanceID');
        if (instanceId && suppressed.has(instanceId)) {
          skipped++;
          return;
        }
        active++;
        const type = textOf(info, 'Type') || 'Unknown Finding';
        const subtype = textOf(info, 'Subtype');
        const original = subtype && !type.toLowerCase().includes(subtype.toLowerCase()) ? `${type}: ${subtype}` : type;
        let name = original;
        for (const prefix of NAME_PREFIXES) {
          if (name.startsWith(`${prefix}:`)) {
            name = name.slice(prefix.length + 1).trim();
            break;
          }
        }
        const severity = SEVERITY_OVERRIDES[normName(original)] ?? SEVERITY_OVERRIDES[normName(name)] ?? (fortifySeverity(textOf(inst, 'InstanceSeverity') || textOf(inst, 'Severity')) || (textOf(inst, 'InstanceSeverity') || textOf(inst, 'Severity')));
        const { loc, trace } = primaryLocation(node);
        const key = `${normName(name)}|${severity}`;
        let g = groups.get(key);
        if (!g) {
          const repl: Record<string, string> = {};
          for (const d of kids(child(node, 'AnalysisInfo', 'Unified', 'ReplacementDefinitions'), 'Def')) if (d.attrs.key && d.attrs.value !== undefined) repl[d.attrs.key] = d.attrs.value;
          if (groups.size >= MAX_GROUPS) throw tooMany();
          g = { name, severity, classId: textOf(info, 'ClassID'), repl, locs: [], trace, count: 0 };
          groups.set(key, g);
        }
        g.count++;
        // ponytail: past 2x the cap further locations are only counted, not kept; raise MAX_INSTANCES if reports need more.
        if (g.locs.length < MAX_INSTANCES * 2) g.locs.push(loc ?? { path: '', line: '' });
      }
    },
    MAX_XML_BYTES,
  );
  await pump(source, reader);
  if (reader.rootName !== 'FVDL') throw new BadRequestException('This is not a Fortify FVDL results file (no <FVDL> root element).');
  if (vulnerabilities === 0) throw new BadRequestException('No vulnerabilities were found in this Fortify file.');
  if (active === 0) throw new BadRequestException(`All ${skipped} issues in this Fortify file are suppressed, so there is nothing to import.`);

  const resolve = (l: Loc | string): Loc => (typeof l === 'string' ? pool.get(l) ?? { path: '', line: '' } : l);
  const findings: FortifyFinding[] = [];
  for (const g of groups.values()) {
    const first = resolve(g.locs[0]);
    const desc = descriptions.get(g.classId);
    const repl = { ...g.repl, ...(first.path && { 'PrimaryLocation.file': first.path }), ...(first.line && { 'PrimaryLocation.line': first.line }) };
    const seen = new Set<string>();
    const affected: string[] = [];
    for (const l of g.locs) {
      const s = fmtLoc(resolve(l));
      if (!seen.has(s)) {
        seen.add(s);
        affected.push(s);
      }
    }
    const traceLines = g.trace.map((t) => ('ref' in t ? { ...(pool.get(t.ref) ?? { path: '', line: '' }), note: '' } : t)).filter((t) => t.path || t.note)
      .map((t, i) => `${i + 1}. ${fmtLoc(t)}${t.note ? ` - ${t.note}` : ''}`);
    findings.push({
      key: `${normName(g.name)}|${g.severity}`,
      name: g.name,
      severity: g.severity || 'Unknown',
      description: cleanRichText(desc?.explanation ?? '', repl),
      impact: cleanRichText(desc?.abstract ?? '', repl),
      remediation: cleanRichText(desc?.recommendations ?? '', repl),
      references: desc?.references ?? '',
      cveId: desc?.cve || null,
      cweId: desc?.cwe || null,
      affected: affected.slice(0, MAX_INSTANCES),
      instanceCount: g.count,
      trace: traceLines.length ? `Fortify data-flow trace of the first instance:\n${traceLines.join('\n')}` : '',
      ...(!['Critical', 'High', 'Medium', 'Low', 'Info'].includes(g.severity) && { problem: g.severity ? `Severity "${g.severity}" is not recognised.` : 'No severity in the file.' }),
    });
  }
  const order = ['Critical', 'High', 'Medium', 'Low', 'Info'];
  findings.sort((a, b) => (order.indexOf(a.severity) + 1 || 9) - (order.indexOf(b.severity) + 1 || 9));
  return { findings, activeInstances: active, suppressedInstances: skipped, suppressionApplied: false };
}

async function readSuppressed(source: Readable): Promise<Set<string>> {
  const out = new Set<string>();
  // audit.xml's root element varies by Fortify version, so match IssueList/Issue under whatever the root is.
  const reader = new SubtreeReader(
    (p) => /^[^/]+\/IssueList\/Issue$/.test(p),
    (_p, n) => {
      const id = n.attrs.instanceId ?? n.attrs.instanceID;
      if (id && (n.attrs.suppressed ?? 'false').toLowerCase() === 'true') out.add(id);
    },
    MAX_AUDIT_BYTES,
  );
  await pump(source, reader);
  return out;
}

const byBaseName = (zip: JSZip, names: string[]) => {
  const entries = zip.file(/.*/).filter((f) => !f.dir);
  for (const wanted of names) {
    // A top-level entry wins; otherwise the same name in a subfolder.
    const hit = entries.find((f) => f.name.toLowerCase() === wanted) ?? entries.find((f) => f.name.split('/').pop()!.toLowerCase() === wanted);
    if (hit) return hit;
  }
  return undefined;
};

export async function parseFortifyFile(file: { originalname?: string; buffer?: Buffer } | undefined): Promise<FortifyResult> {
  if (!file?.buffer || file.buffer.length === 0) throw new BadRequestException('No file uploaded, or the file is empty.');
  const name = (file.originalname || '').toLowerCase();
  const isZip = file.buffer.subarray(0, 4).equals(ZIP_MAGIC);

  if (name.endsWith('.fpr')) {
    if (!isZip) throw new BadRequestException('This is not a valid Fortify .fpr file (it is not an FPR/ZIP archive).');
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file.buffer);
    } catch {
      throw new BadRequestException('This is not a valid Fortify .fpr file (the archive is damaged).');
    }
    if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) throw new BadRequestException('This archive has too many entries to be a Fortify .fpr file.');
    const fvdl = byBaseName(zip, ['audit.fvdl', 'audit.fvdl.old']);
    if (!fvdl) throw new BadRequestException('No audit.fvdl or audit.fvdl.old was found inside this .fpr file.');
    const audit = byBaseName(zip, ['audit.xml']);
    // ponytail: a damaged audit.xml fails the whole import rather than silently including suppressed issues.
    const suppressed = audit ? await readSuppressed(audit.nodeStream() as unknown as Readable) : new Set<string>();
    const result = await readFvdl(fvdl.nodeStream() as unknown as Readable, suppressed);
    return { ...result, suppressionApplied: !!audit };
  }
  if (name.endsWith('.xml') || name.endsWith('.fvdl')) {
    if (isZip) throw new BadRequestException('This file is an archive. Upload it with the .fpr extension.');
    return readFvdl(Readable.from([file.buffer]), new Set());
  }
  throw new BadRequestException('Unsupported file type. Upload a Fortify .fpr, or an FVDL .xml or .fvdl file.');
}

/** The proof-of-concept text kept on an imported finding: the primary data-flow trace, when the file has one. */
export const fortifyPocText = (f: Pick<FortifyFinding, 'trace'>): string | null => f.trace || null;
