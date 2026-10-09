import { Injectable, Logger } from '@nestjs/common';
import * as JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { NmapPortRecord } from '../common/nmap-parser.util';

export interface TemplateField {
  id: string;
  name: string;
  normalizedName: string;
  category: 'project_info' | 'vulnerability' | 'contact' | 'date' | 'other';
  description: string;
  isRepeatable: boolean;
}

export interface FieldRule {
  /** Normalized substrings to match against the placeholder text */
  match: string[];
  /** Value to insert */
  value: string;
  /** If true, ALL substrings must be present (e.g. a merged "Start Date ... End Date ..." run). Default: any match wins */
  requireAll?: boolean;
  /** Occurrence-ordered values: the Nth matching placeholder in the document gets values[N] (used when one placeholder name repeats with different values). */
  values?: string[];
}

export interface PocStepData {
  stepNo: number;
  description: string;
  imageKey?: string | null;
}

export interface PocImage {
  key: string;
  buffer: Buffer;
  extension: string; // 'png' | 'jpg' | 'jpeg' | 'gif'
}

export interface PersonValues {
  fullName: string;
  designation: string;
  phone: string;
  email: string;
}

export interface ContactValues {
  avp?: PersonValues;
  tl?: PersonValues;
  tester?: PersonValues;
}

export interface NetworkScopeRow {
  ip: string;
  domainHostname: string;
  purpose: string;
}

export interface ToolUsedRow {
  name: string;
  version: string;
  licenseType: string;
}

export interface FindingData {
  no: number;
  title: string;
  severity: string;
  cvssScore: number | null;
  cvssVector: string | null;
  description: string;
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
  affectedInstances: string;
  authenticationType: string | null;
  vulnerabilityDependency: string | null;
  reportStatus: string;
  /** e.g. 'VA Finding' for scan imports; null for library findings. */
  classification?: string | null;
  pocSteps: PocStepData[];
}

export interface TemplateAnalysis {
  fields: TemplateField[];
  hasSummaryTable: boolean;
  hasDetailedTable: boolean;
  missingMandatory: string[];
  warnings: string[];
}

interface RegisteredImage {
  rId: string;
  mediaName: string;
  widthEmu: number;
  heightEmu: number;
}

const EMU_PER_PX = 9525; // 96 DPI
const MAX_IMAGE_WIDTH_EMU = 5029200; // 5.5 inches

/** Fallback if the caller doesn't pass admin-configured colors (matches settings.defaults.ts). */
const DEFAULT_SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#3b82f6', Info: '#6b7280',
};

@Injectable()
export class DocxManipulatorService {
  private readonly logger = new Logger(DocxManipulatorService.name);
  private readonly W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  private readonly R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  private readonly WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  private readonly A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  private readonly PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  private readonly RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  private readonly CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
  /** Matches a single {Parameter} placeholder; braces don't nest so this stays non-greedy without lookahead tricks. */
  private readonly PLACEHOLDER_RE = /\{([^{}]+)\}/g;

  // ---------------------------------------------------------------------------
  // Template field extraction (upload flow)
  // ---------------------------------------------------------------------------

  /**
   * Extract `{Parameter}` placeholders from a DOCX buffer. Parameter
   * detection no longer depends on yellow highlighting — only literal
   * {...} text counts. Scoped to paragraphs outside any table, so this
   * never sees (or interferes with) the findings/summary/contact tables,
   * which keep their own dedicated, highlight-based cell-filling logic.
   */
  async extractPlaceholderFields(docxBuffer: Buffer): Promise<TemplateField[]> {
    const { doc } = await this.loadDocument(docxBuffer);
    const paragraphs = Array.from(doc.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    const fields: Map<string, TemplateField> = new Map();

    // Extraction is read-only reporting of what's literally in the
    // template, so — unlike the generation-time replacement pass — it
    // scans everywhere, including the findings/contact tables. Those
    // tables are populated by their own dedicated logic at generation
    // time, but their {Parameter} placeholders still need to show up in
    // Template Mapping for Admin visibility.
    for (const para of paragraphs) {
      const fullText = this.getParagraphRunSpans(para).map((s) => s.text).join('');
      const re = new RegExp(this.PLACEHOLDER_RE);
      let match: RegExpExecArray | null;
      while ((match = re.exec(fullText))) {
        const raw = match[1].trim();
        if (!raw) continue;

        const normalizedName = this.normalizeFieldName(raw);
        if (!normalizedName || fields.has(normalizedName)) continue;

        fields.set(normalizedName, {
          id: `field_${normalizedName}`,
          name: raw,
          normalizedName,
          category: this.categorizeField(raw),
          description: this.generateDescription(raw),
          isRepeatable: this.isRepeatableField(raw),
        });
      }
    }

    return Array.from(fields.values());
  }

  /**
   * Analyze a template for the upload-validation flow: fields plus
   * structural checks on the mandatory findings tables.
   */
  async analyzeTemplate(docxBuffer: Buffer): Promise<TemplateAnalysis> {
    const fields = await this.extractPlaceholderFields(docxBuffer);
    const { doc } = await this.loadDocument(docxBuffer);
    this.mergeAllHighlightedRuns(doc);

    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    const tables = body ? body.getElementsByTagNameNS(this.W_NS, 'tbl') : ([] as any);

    let hasSummaryTable = false;
    let hasDetailedTable = false;
    let hasPocRow = false;
    for (let t = 0; t < tables.length; t++) {
      const table = tables.item(t);
      if (!table) continue;
      const text = this.getElementText(table).toLowerCase();
      // Same classification the generator uses (fillFindingsTables): a CVE/CWE
      // header without description/remediation placeholders is a summary table.
      const hasTitle = text.includes('{vulnerability name}') || text.includes('{finding title}');
      const hasCveCwe = text.includes('cve/cwe') || text.includes('{cve/cwe}') || text.includes('{cvss vector}');
      const hasDetailBody = ['{vulnerability description}', '{description}', '{vulnerability remediation}', '{remediation}'].some((k) => text.includes(k));
      if (hasTitle && hasCveCwe && hasDetailBody) {
        hasDetailedTable = true;
        // Same POC-row detection fillDetailedBlock() uses to expand steps.
        if (/poc reproduction|poc snapshot|step\s*1|\{steps\}|\{poc\}/.test(text)) hasPocRow = true;
      }
      if (hasTitle && !hasDetailBody && (hasCveCwe || text.includes('{score value}') || text.includes('{cvss score}'))) hasSummaryTable = true;
    }

    // Required-field keys accept every alias resolveFindingParameter() understands.
    const allText = fields.map((f) => f.normalizedName).join(' ');
    const mandatory: { label: string; present: boolean }[] = [
      { label: 'Summary table ({Vulnerability Name} + {Score Value})', present: hasSummaryTable },
      { label: 'Detailed findings table (with CVE/CWE ID)', present: hasDetailedTable },
      { label: 'Affected URL and Paths', present: ['affected_url', 'affected_instances', 'affected'].some((k) => allText.includes(k)) },
      { label: 'Vulnerability Description', present: allText.includes('vulnerability_description') },
      { label: 'Reference Link', present: ['reference_link', 'vulnerability_references', 'references'].some((k) => allText.includes(k)) },
      { label: 'POC reproduction Steps', present: hasPocRow || allText.includes('poc_reproduction_steps') },
      { label: 'POC Snapshot', present: allText.includes('poc_snapshot') },
    ];

    const missingMandatory = mandatory.filter((m) => !m.present).map((m) => m.label);
    const warnings: string[] = [];
    const suspicious = fields.filter((f) => f.normalizedName.length < 3);
    if (suspicious.length > 0) {
      warnings.push(
        `Suspicious short fields detected (possible split placeholders): ${suspicious
          .map((f) => `"${f.name}"`)
          .join(', ')}`,
      );
    }
    // Optional: not every report type shows it, so it never blocks activation.
    if (!allText.includes('authentication_type')) warnings.push('Authentication Type placeholder not found (optional).');
    if (!hasSummaryTable) warnings.push('Summary-of-findings table was not detected.');
    if (!hasDetailedTable) warnings.push('Detailed-findings table was not detected.');

    return { fields, hasSummaryTable, hasDetailedTable, missingMandatory, warnings };
  }

  // ---------------------------------------------------------------------------
  // Report generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a report by filling template placeholders with rule-based values,
   * filling the template's own summary + detailed findings tables, and
   * embedding POC step images.
   */
  async generateReport(
    templateBuffer: Buffer,
    rules: FieldRule[],
    findings: FindingData[],
    images: PocImage[] = [],
    contacts?: ContactValues,
    severityColors: Record<string, string> = DEFAULT_SEVERITY_COLORS,
    networkScope: NetworkScopeRow[] = [],
    nmapPorts: NmapPortRecord[] = [],
    toolsUsed: ToolUsedRow[] = [],
    reportName?: string,
  ): Promise<Buffer> {
    const zip = await JSZip.loadAsync(templateBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('text');
    if (!documentXml) {
      throw new Error('Invalid DOCX: document.xml not found');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(documentXml, 'text/xml');

    // Step 0: register POC images (media files, relationships, content types)
    const imageRegistry = await this.registerImages(zip, images);

    // Step 1: merge split highlighted runs so placeholders are whole
    this.mergeAllHighlightedRuns(doc);

    // Step 1.5: {Report Name} resolves to the final generated filename and,
    // unlike the generic project-info rules below, must populate every
    // occurrence regardless of whether it sits inside a table cell (cover
    // page / footer layouts commonly use tables) — so it runs first, over
    // every paragraph in the document, ahead of all other placeholder passes.
    if (reportName) {
      this.fillReportNamePlaceholder(doc, reportName);
    }

    // Step 2: fill the contact table row-aware (AVP / TL / Tester each get
    // their own phone/email/title — a generic rule cannot distinguish rows).
    // Filled runs lose their highlight, so the generic pass below skips them.
    if (contacts) {
      this.fillContactTable(doc, contacts);
    }

    // Step 2.5: fill the {Network Scope} table (Network testing projects only —
    // a no-op if the template has no such table). Row-cloned like the
    // findings summary table, one row per scope entry, so multiple
    // IP/Domain/Purpose entries stay independently associated.
    this.fillNetworkScopeTable(doc, networkScope);
    this.fillNmapPortsTable(doc, nmapPorts);
    this.fillToolsUsedTable(doc, toolsUsed);

    // Step 3: replace {Parameter} placeholders (project-info / contact / date)
    // using the same rule set and match semantics as before — only the
    // placeholder syntax and replacement precision changed, not the
    // rule-resolution priority (admin-mapped > generic > custom).
    this.replacePlaceholders(doc, this.buildResolver(rules));

    // Step 3.5: serial-number columns ({S No} in e.g. the Engagement Scope asset table)
    this.numberSerialColumns(doc);

    // Step 4: fill the template's own findings tables
    if (findings.length > 0) {
      // Unresolved finding-table {Parameter}s are left as literal text —
      // same as any other unmapped placeholder — never a reason to block
      // generation. Logged for developer diagnostics only.
      const unresolvedFindingParams = new Set<string>();
      this.fillFindingsTables(doc, findings, imageRegistry, severityColors, unresolvedFindingParams);
      if (unresolvedFindingParams.size > 0) {
        this.logger.debug(`Unresolved finding-table parameter(s) left as literal: ${[...unresolvedFindingParams].join(', ')}`);
      }
    }

    // Step 4.5: severity charts (e.g. Cert-In "Risk Matrix") — counts from the findings
    await this.updateSeverityCharts(zip, findings);

    // Step 5: serialize back
    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(doc);
    zip.file('word/document.xml', updatedXml);

    await this.markFieldsForUpdate(zip);

    return zip.generateAsync({ type: 'nodebuffer' });
  }

  /**
   * Table of Contents (and every other field) is recalculated by Word, not by
   * us — page numbers need a layout engine. Setting w:updateFields makes Word
   * refresh them when the report is opened (it asks the user once).
   * ponytail: Word shows an "update fields?" prompt on open; a server-side
   * LibreOffice pass could pre-render the TOC if that prompt is unwanted.
   */
  private async markFieldsForUpdate(zip: any): Promise<void> {
    await this.refreshDateFieldResults(zip);
    const path = 'word/settings.xml';
    let xml: string | undefined = await zip.file(path)?.async('text');
    if (!xml || xml.includes('w:updateFields')) return;
    const tag = '<w:updateFields w:val="true"/>';
    // CT_Settings order: updateFields precedes hdrShapeDefaults/footnotePr/endnotePr/compat
    const next = xml.match(/<w:(hdrShapeDefaults|footnotePr|endnotePr|compat)[\s>\/]/);
    xml = next ? xml.slice(0, next.index) + tag + xml.slice(next.index) : xml.replace('</w:settings>', tag + '</w:settings>');
    zip.file(path, xml);
  }

  /**
   * DATE fields (e.g. the cover-page date) recalculate in Word on open, but
   * previewers/converters show the cached result — still the template's
   * date. Rewrite that cached text to today in the field's own \@ format
   * (same run, so formatting is untouched). Only simple month/day/year
   * pictures are handled; anything else is left for Word to refresh.
   */
  private async refreshDateFieldResults(zip: any): Promise<void> {
    const path = 'word/document.xml';
    const xml: string | undefined = await zip.file(path)?.async('text');
    if (!xml) return;
    const now = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const out = xml.replace(
      /(DATE\s*\\@\s*(?:&quot;|")([^"&]+)(?:&quot;|")[\s\S]*?fldCharType="separate"\/><\/w:r>\s*<w:r[ >](?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>)[^<]*(<\/w:t>)/g,
      (all, head, fmt, tail) => {
        if (/[^MdyY ,\/.\-]/.test(fmt.replace(/MMMM|MMM/g, ''))) return all; // unsupported picture: let Word refresh it
        const text = fmt
          .replace(/MMMM/g, months[now.getMonth()])
          .replace(/MMM/g, months[now.getMonth()].slice(0, 3))
          .replace(/MM/g, String(now.getMonth() + 1).padStart(2, '0'))
          .replace(/M/g, String(now.getMonth() + 1))
          .replace(/dd/g, String(now.getDate()).padStart(2, '0'))
          .replace(/d/g, String(now.getDate()))
          .replace(/yyyy/gi, String(now.getFullYear()))
          .replace(/yy/gi, String(now.getFullYear()).slice(2));
        return head + text + tail;
      },
    );
    if (out !== xml) zip.file(path, out);
  }

  /**
   * A table's first-column {S No} placeholder that step 3 left unresolved
   * (it's a row index, not a project value) becomes 1, 2, 3... by row.
   * Findings/summary/contact tables are skipped — they number via their
   * own per-finding resolution.
   */
  private numberSerialColumns(doc: Document): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;
    for (const table of Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[]) {
      if (this.isProtectedTable(table)) continue;
      const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
      let n = 0;
      for (const row of rows) {
        const cell = row.getElementsByTagNameNS(this.W_NS, 'tc').item(0);
        if (!cell || !/^\{\s*s\.?\s*no\.?\s*\}$/i.test(this.getElementText(cell).trim())) continue;
        n++;
        for (const para of Array.from(cell.getElementsByTagNameNS(this.W_NS, 'p')) as Element[]) {
          this.replacePlaceholdersInParagraph(para, () => String(n));
        }
      }
    }
  }

  /**
   * Template-driven severity chart fill: any chart whose series are named
   * after severities (Critical/High/Medium/Low/Info) gets each series' own
   * category point set to that severity's finding count — in the chart cache
   * (what Word renders) and in the embedded workbook (so "Edit Data" in Word
   * shows the same numbers). Charts without severity series are untouched.
   */
  private async updateSeverityCharts(zip: any, findings: FindingData[]): Promise<void> {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
      const k = (f.severity || '').toLowerCase().startsWith('info') ? 'info' : (f.severity || '').toLowerCase();
      if (k in counts) counts[k]++;
    }
    const sevKey = (name: string) => (name.toLowerCase().startsWith('info') ? 'info' : name.toLowerCase());

    for (const chartPath of Object.keys(zip.files).filter((n) => /^word\/charts\/chart[^/]*\.xml$/.test(n))) {
      let xml: string = await zip.file(chartPath).async('text');
      const cellUpdates: Record<string, number> = {};

      const updated = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
        const name = ser.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/)?.[1]?.trim() ?? '';
        const key = sevKey(name);
        if (!(key in counts)) return ser;
        const cats = [...(ser.match(/<c:cat>[\s\S]*?<\/c:cat>/)?.[0] ?? '').matchAll(/<c:pt idx="(\d+)"><c:v>([^<]*)<\/c:v>/g)];
        const catIdx = cats.find((m) => sevKey(m[2].trim()) === key)?.[1];
        if (catIdx === undefined) return ser;
        const ref = ser.match(/<c:val>[\s\S]*?<c:f>([^<]*)<\/c:f>/)?.[1] ?? '';
        const col = ref.match(/\$([A-Z]+)\$(\d+)/);
        if (col) cellUpdates[`${col[1]}${parseInt(col[2], 10) + parseInt(catIdx, 10)}`] = counts[key];
        return ser.replace(/(<c:val>[\s\S]*?<c:ptCount val="\d+"\/>)[\s\S]*?(<\/c:numCache>)/, `$1<c:pt idx="${catIdx}"><c:v>${counts[key]}</c:v></c:pt>$2`);
      });
      let result = updated;
      if (result === xml) {
        // Alternate layout: one series whose categories are the severities
        // (value i = count of category i), e.g. a simple "Risk Matrix" bar/pie.
        result = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
          const cats = [...(ser.match(/<c:cat>[\s\S]*?<\/c:cat>/)?.[0] ?? '').matchAll(/<c:pt idx="(\d+)"><c:v>([^<]*)<\/c:v>/g)];
          if (cats.length === 0 || !cats.every((m) => sevKey(m[2].trim()) in counts)) return ser;
          const pts = cats.map((m) => `<c:pt idx="${m[1]}"><c:v>${counts[sevKey(m[2].trim())]}</c:v></c:pt>`).join('');
          return ser.replace(/(<c:val>[\s\S]*?<c:ptCount val="\d+"\/>)[\s\S]*?(<\/c:numCache>)/, `$1${pts}$2`);
        });
        if (result === xml) continue;
      }
      zip.file(chartPath, result);

      // Embedded workbook (best-effort: only cells the template already has)
      const relsPath = chartPath.replace('charts/', 'charts/_rels/') + '.rels';
      const rels: string | undefined = await zip.file(relsPath)?.async('text');
      const target = rels?.match(/Target="\.\.\/(embeddings\/[^"]+\.xlsx)"/)?.[1];
      const wbFile = target && zip.file(`word/${target}`);
      if (!wbFile) continue;
      const wb = await JSZip.loadAsync(await wbFile.async('nodebuffer'));
      const sheetPath = 'xl/worksheets/sheet1.xml';
      let sheet: string | undefined = await wb.file(sheetPath)?.async('text');
      if (!sheet) continue;
      for (const [cell, value] of Object.entries(cellUpdates)) {
        sheet = sheet.replace(new RegExp(`(<c r="${cell}"[^>]*>)<v>[^<]*</v>`), `$1<v>${value}</v>`);
      }
      wb.file(sheetPath, sheet);
      zip.file(`word/${target}`, await wb.generateAsync({ type: 'nodebuffer' }));
    }
  }

  /**
   * Row-aware fill of the contact-details table:
   * rows are "AVP Name", "Team Lead Name", "Tester Name"; each row has its
   * own highlighted Title / Contact Number / Email id cells.
   */
  private fillContactTable(doc: Document, contacts: ContactValues): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];
    const contactTable = tables.find((t) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('avp name') && x.includes('team lead name') && x.includes('tester name');
    });
    if (!contactTable) return;

    const rows = Array.from(contactTable.getElementsByTagNameNS(this.W_NS, 'tr'));
    for (const row of rows) {
      const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
      if (cells.length === 0) continue;

      const nameText = this.getElementText(cells[0]).toLowerCase();
      const person = nameText.includes('avp')
        ? contacts.avp
        : nameText.includes('team lead')
          ? contacts.tl
          : nameText.includes('tester')
            ? contacts.tester
            : undefined;
      if (!person) continue;

      cells.forEach((cell, cellIndex) => {
        const runs = Array.from(cell.getElementsByTagNameNS(this.W_NS, 'r'));
        for (const run of runs) {
          const rPr = this.getFirstChildByTagName(run, 'rPr');
          if (!rPr || !this.hasYellowHighlight(rPr)) continue;

          const normalized = this.normalizeFieldName(this.getRunText(run).trim());
          let value: string | null = null;
          if (cellIndex === 0 || normalized.includes('name')) {
            value = person.fullName;
          } else if (normalized.includes('contact') || normalized.includes('phone')) {
            value = person.phone;
          } else if (normalized.includes('email')) {
            value = person.email;
          } else if (normalized.includes('title')) {
            value = person.designation;
          }
          if (value !== null) {
            this.setRunText(run, value || 'N/A');
            this.removeYellowHighlight(rPr);
          }
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Simple field replacement
  // ---------------------------------------------------------------------------

  /**
   * Builds a normalizedName -> value lookup from the existing FieldRule[]
   * (admin-mapped rules first, then generic, then custom — order set by the
   * caller in reports.service.ts, untouched). Matching predicate is copied
   * verbatim from the old highlight-based replacer so resolution behavior
   * is unchanged; only the placeholder syntax it's applied to is new.
   */
  private buildResolver(rules: FieldRule[]): (normalizedName: string) => string | undefined {
    return (normalizedName: string) => {
      const rule = rules.find((r) =>
        r.requireAll
          ? r.match.every((m) => normalizedName.includes(m))
          : r.match.some((m) => normalizedName.includes(m)),
      );
      if (rule?.values) return rule.values.shift(); // exhausted -> undefined -> left literal
      return rule ? rule.value : undefined;
    };
  }

  /**
   * True only for the specific tables the existing pipeline owns: the
   * findings/summary tables and the AVP/TL/Tester contact table — detected
   * with the exact same marker text fillFindingsTables/fillContactTable
   * already key off. A plain layout table (e.g. a cover-page info grid
   * using {Client Name}-style placeholders) is NOT protected, so its
   * placeholders are still extracted/replaced normally.
   */
  private isProtectedTable(table: Element): boolean {
    const text = this.getElementText(table).toLowerCase();
    const hasTitle = text.includes('{vulnerability name}') || text.includes('{finding title}');
    const hasCveCwe = text.includes('cve/cwe') || text.includes('{cve/cwe}') || text.includes('{cvss vector}');
    const isDetailed = hasTitle && hasCveCwe;
    const isSummary = !isDetailed && hasTitle && (text.includes('{score value}') || text.includes('{cvss score}'));
    const isContact = text.includes('avp name') && text.includes('team lead name') && text.includes('tester name');
    return isDetailed || isSummary || isContact;
  }

  /** True if this node sits inside one of the protected tables above. */
  private isInsideTable(node: Node): boolean {
    let cur: Node | null = node.parentNode;
    while (cur) {
      const localName = (cur as any).localName || (cur as Element).tagName;
      if (localName === 'tbl' || localName === 'w:tbl') return this.isProtectedTable(cur as Element);
      cur = cur.parentNode;
    }
    return false;
  }

  /** Direct <w:r> children of a paragraph with each run's text and its [start,end) offset in the paragraph's concatenated text. */
  private getParagraphRunSpans(para: Element): { run: Element; text: string; start: number; end: number }[] {
    const runs: Element[] = [];
    for (let i = 0; i < para.childNodes.length; i++) {
      const child = para.childNodes.item(i);
      const localName = (child as any).localName || (child as Element).tagName;
      if (localName === 'r' || localName === 'w:r') runs.push(child as Element);
    }
    let offset = 0;
    return runs.map((run) => {
      const text = this.getRunText(run);
      const span = { run, text, start: offset, end: offset + text.length };
      offset += text.length;
      return span;
    });
  }

  /**
   * Replaces every resolvable {Parameter} placeholder in non-table
   * paragraphs. Unresolved placeholders (no rule matches) are left as
   * literal text, untouched — never silently blanked or guessed.
   */
  /**
   * {Report Name}: the final generated filename, resolved everywhere it
   * appears — including inside tables — unlike the generic project-info
   * pass below, which intentionally skips table paragraphs (those are
   * handled by their own dedicated table fillers).
   */
  private fillReportNamePlaceholder(doc: Document, reportName: string): void {
    const paragraphs = Array.from(doc.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    const resolver = (n: string) => (n === 'report_name' ? reportName : undefined);
    for (const para of paragraphs) {
      this.replacePlaceholdersInParagraph(para, resolver);
    }
  }

  private replacePlaceholders(doc: Document, resolveValue: (normalizedName: string) => string | undefined): void {
    const paragraphs = Array.from(doc.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    for (const para of paragraphs) {
      if (this.isInsideTable(para)) continue;
      this.replacePlaceholdersInParagraph(para, resolveValue);
    }
  }

  private replacePlaceholdersInParagraph(para: Element, resolveValue: (n: string) => string | undefined): void {
    // Re-reads the paragraph's runs fresh each iteration (rather than
    // caching stale offsets) so multiple placeholders sharing a single run
    // (e.g. "{Start Date} to {End Date}" typed as one run) resolve
    // correctly instead of one replacement overwriting another.
    for (let guard = 0; guard < 100; guard++) {
      const spans = this.getParagraphRunSpans(para);
      const fullText = spans.map((s) => s.text).join('');
      const re = new RegExp(this.PLACEHOLDER_RE);
      let m: RegExpExecArray | null;
      let target: { start: number; end: number; value: string } | null = null;
      while ((m = re.exec(fullText))) {
        const raw = m[1].trim();
        const normalizedName = this.normalizeFieldName(raw);
        if (!raw || !normalizedName) continue; // "{}" / punctuation-only — not a real placeholder
        const value = resolveValue(normalizedName);
        if (value !== undefined) {
          target = { start: m.index, end: m.index + m[0].length, value };
          break;
        }
      }
      if (!target) break; // nothing left to resolve — remaining placeholders stay literal

      const overlapping = spans.filter((s) => s.start < target!.end && s.end > target!.start);
      if (overlapping.length === 0) break;
      const first = overlapping[0];
      const last = overlapping[overlapping.length - 1];
      const before = first.text.slice(0, Math.max(0, target.start - first.start));
      const after = last.text.slice(Math.max(0, target.end - last.start));
      this.setRunText(first.run, before + target.value + after);
      for (let j = 1; j < overlapping.length; j++) {
        if (overlapping[j].run !== first.run) {
          overlapping[j].run.parentNode?.removeChild(overlapping[j].run);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Findings tables
  // ---------------------------------------------------------------------------

  private fillFindingsTables(
    doc: Document,
    findings: FindingData[],
    imageRegistry: Map<string, RegisteredImage>,
    severityColors: Record<string, string>,
    unresolved: Set<string>,
  ): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    // Snapshot the table list — we mutate the tree while processing
    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];

    const hasTitle = (x: string) => x.includes('{vulnerability name}') || x.includes('{finding title}');
    const hasScore = (x: string) => x.includes('{score value}') || x.includes('{cvss score}');
    const hasCveCwe = (x: string) => x.includes('cve/cwe') || x.includes('{cve/cwe}') || x.includes('{cvss vector}');
    // A "CVE/CWE" column header also appears in row-repeating summary tables
    // (header row + one {Parameter} row, e.g. Cert-In). Those carry no
    // description/remediation placeholders — only a real per-finding detail
    // block does — so they're classified as summary, not detailed.
    const hasDetailBody = (x: string) =>
      ['{vulnerability description}', '{description}', '{vulnerability remediation}', '{remediation}'].some((k) => x.includes(k));
    const isDetailed = (t: Element) => {
      const x = this.getElementText(t).toLowerCase();
      return hasTitle(x) && hasCveCwe(x) && hasDetailBody(x);
    };
    const isSummary = (t: Element) => {
      const x = this.getElementText(t).toLowerCase();
      return hasTitle(x) && !hasDetailBody(x) && (hasCveCwe(x) || hasScore(x));
    };

    const summaryTable = tables.find(isSummary);
    if (summaryTable) {
      // Only score-style summaries get the wider S.No column; a multi-column
      // summary (e.g. Cert-In) keeps the template's own column sizing.
      if (hasScore(this.getElementText(summaryTable).toLowerCase())) this.widenFirstColumn(summaryTable);
      this.fillSummaryTable(doc, summaryTable, findings, severityColors, unresolved);
    }

    // Templates ship with one detailed-findings table PER finding slot
    // (pre-numbered 1..N). Fill table i with finding i; clone for extra
    // findings; remove unused placeholder tables.
    const detailedTables = tables.filter(isDetailed);
    if (detailedTables.length === 0) return;

    // Widen before cloning the pristine copy, so every finding's table —
    // original template slots and clones alike — gets the wider column.
    detailedTables.forEach((t) => this.widenFirstColumn(t));
    const pristine = detailedTables[0].cloneNode(true) as Element;

    // `anchor` tracks the node after which the next NEW table must be
    // inserted, so clones for finding 3, 4, 5... land in order instead of
    // all being inserted right after the original last placeholder table.
    let anchor: Element = detailedTables[detailedTables.length - 1];

    findings.forEach((finding, i) => {
      let tbl = detailedTables[i];
      if (!tbl) {
        // Beyond the template's own static finding slots (finding 5, 6, 7...
        // for a template with 4 slots): each gets its own page, inserted
        // only once the previous finding's table is fully complete.
        const pageBreak = this.createPageBreakParagraph(doc);
        anchor.parentNode?.insertBefore(pageBreak, anchor.nextSibling);
        tbl = pristine.cloneNode(true) as Element;
        pageBreak.parentNode?.insertBefore(tbl, pageBreak.nextSibling);
      }
      this.fillDetailedBlock(doc, tbl, finding, imageRegistry, severityColors, unresolved);
      anchor = tbl;
    });

    // Remove unused placeholder tables
    for (let i = findings.length; i < detailedTables.length; i++) {
      detailedTables[i].parentNode?.removeChild(detailedTables[i]);
    }
  }

  /**
   * A page break needs a paragraph to carry it, but that paragraph's own
   * line still reserves vertical space — inheriting the template's default
   * paragraph spacing/font size left a visible gap around every break.
   * Zero the spacing and shrink the run so the paragraph mark is ~1pt tall.
   */
  /**
   * A page break needs a paragraph to carry it, but that paragraph's own
   * line still reserves vertical space — inheriting the template's default
   * paragraph spacing/font size left a visible gap around every break.
   * Zero the spacing and shrink the run so the paragraph mark is ~1pt tall.
   */
  private createPageBreakParagraph(doc: Document): Element {
    const p = doc.createElementNS(this.W_NS, 'w:p');

    const pPr = doc.createElementNS(this.W_NS, 'w:pPr');
    const spacing = doc.createElementNS(this.W_NS, 'w:spacing');
    spacing.setAttributeNS(this.W_NS, 'w:before', '0');
    spacing.setAttributeNS(this.W_NS, 'w:after', '0');
    spacing.setAttributeNS(this.W_NS, 'w:line', '240');
    spacing.setAttributeNS(this.W_NS, 'w:lineRule', 'auto');
    pPr.appendChild(spacing);
    const pRPr = doc.createElementNS(this.W_NS, 'w:rPr');
    pRPr.appendChild(doc.createElementNS(this.W_NS, 'w:sz')).setAttributeNS(this.W_NS, 'w:val', '2');
    pPr.appendChild(pRPr);
    p.appendChild(pPr);

    const run = doc.createElementNS(this.W_NS, 'w:r');
    const rPr = doc.createElementNS(this.W_NS, 'w:rPr');
    const sz = doc.createElementNS(this.W_NS, 'w:sz');
    sz.setAttributeNS(this.W_NS, 'w:val', '2');
    rPr.appendChild(sz);
    run.appendChild(rPr);
    const br = doc.createElementNS(this.W_NS, 'w:br');
    br.setAttributeNS(this.W_NS, 'w:type', 'page');
    run.appendChild(br);
    p.appendChild(run);
    return p;
  }

  /** Widens a table's first column (grid + every row's first cell) by ~3px. */
  private widenFirstColumn(table: Element): void {
    const deltaTwips = 645; // 43px (3+5+10px, plus a further 25px) at 96 DPI (1px = 15 twips)

    const grid = this.getFirstChildByTagName(table, 'tblGrid');
    const firstCol = grid?.getElementsByTagNameNS(this.W_NS, 'gridCol').item(0);
    if (firstCol) {
      const w = parseInt(firstCol.getAttributeNS(this.W_NS, 'w') || '0', 10);
      firstCol.setAttributeNS(this.W_NS, 'w:w', String(w + deltaTwips));
    }

    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    for (const row of rows) {
      const firstCell = row.getElementsByTagNameNS(this.W_NS, 'tc').item(0);
      if (!firstCell) continue;
      const tcPr = this.getFirstChildByTagName(firstCell, 'tcPr');
      const tcW = tcPr && this.getFirstChildByTagName(tcPr, 'tcW');
      if (!tcW) continue;
      const type = tcW.getAttributeNS(this.W_NS, 'type');
      if (type && type !== 'dxa') continue; // only widen fixed-width columns
      const w = parseInt(tcW.getAttributeNS(this.W_NS, 'w') || '0', 10);
      tcW.setAttributeNS(this.W_NS, 'w:w', String(w + deltaTwips));
    }
  }

  /** Summary of Findings: S.No | Findings | CVSS Base Score | Severity | Status */
  private fillSummaryTable(doc: Document, table: Element, findings: FindingData[], severityColors: Record<string, string>, unresolved: Set<string>): void {
    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const placeholderRows = rows.filter((r) => {
      const t = this.getElementText(r).toLowerCase();
      return t.includes('{vulnerability name}') || t.includes('{finding title}');
    });
    if (placeholderRows.length === 0) return;

    const templateRow = placeholderRows[0];
    const anchor = placeholderRows[0];

    for (const finding of findings) {
      const clone = templateRow.cloneNode(true) as Element;
      this.fillSummaryRow(clone, finding, severityColors, unresolved);
      table.insertBefore(clone, anchor);
    }

    for (const row of placeholderRows) {
      table.removeChild(row);
    }
  }

  /**
   * Fills a summary row purely by resolving whatever {Parameter}
   * placeholders its cells contain — same engine as the rest of the
   * document, just resolved against this one finding instead of the
   * project. No row-position or literal-text heuristics.
   */
  private fillSummaryRow(row: Element, finding: FindingData, severityColors: Record<string, string>, unresolved: Set<string>): void {
    const resolver = (n: string) => {
      const v = this.resolveFindingParameter(n, finding);
      if (v === undefined) unresolved.add(n);
      return v;
    };
    const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
    for (const cell of cells) {
      const paragraphs = Array.from(cell.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
      for (const para of paragraphs) {
        this.replacePlaceholdersInParagraph(para, resolver);
      }
      if (this.getElementText(cell).trim() === finding.severity) {
        const color = severityColors[finding.severity];
        if (color) this.setCellShading(cell, color);
      }
    }
  }

  /**
   * {Network Scope}: table with {IP} | {Domain&Hostname} | {Purpose} rows.
   * Located by header/placeholder-row content rather than a fixed table
   * index, same approach as the findings summary table. A no-op when the
   * template has no such table (e.g. non-Network report).
   */
  private fillNetworkScopeTable(doc: Document, scope: NetworkScopeRow[]): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];
    const table = tables.find((t) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('{ip}') && x.includes('{purpose}');
    });
    if (!table) return;

    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const placeholderRows = rows.filter((r) => this.getElementText(r).toLowerCase().includes('{ip}'));
    if (placeholderRows.length === 0) return;

    const templateRow = placeholderRows[0];
    const anchor = placeholderRows[0];

    for (const entry of scope) {
      const clone = templateRow.cloneNode(true) as Element;
      this.fillNetworkScopeRow(clone, entry);
      table.insertBefore(clone, anchor);
    }

    for (const row of placeholderRows) {
      table.removeChild(row);
    }
  }

  /** Each of {IP}/{Domain&Hostname}/{Purpose} falls back to "NA" independently, per row. */
  private fillNetworkScopeRow(row: Element, entry: NetworkScopeRow): void {
    const resolver = (n: string) => {
      if (n.includes('ip')) return entry.ip || 'NA';
      if (n.includes('domain')) return entry.domainHostname || 'NA';
      if (n.includes('purpose')) return entry.purpose || 'NA';
      return undefined;
    };
    const paragraphs = Array.from(row.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    for (const para of paragraphs) {
      this.replacePlaceholdersInParagraph(para, resolver);
    }
  }

  /**
   * {Tool Name} / {Tool Version} / {Open Source/Licensed}: table of tools
   * used, one row per tool. Same clone-per-record approach as the Network
   * Scope table. A no-op when the template has no such table.
   */
  private fillToolsUsedTable(doc: Document, tools: ToolUsedRow[]): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];
    const table = tables.find((t) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('{tool name}') && x.includes('{tool version}');
    });
    if (!table) return;

    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const placeholderRows = rows.filter((r) => this.getElementText(r).toLowerCase().includes('{tool name}'));
    if (placeholderRows.length === 0) return;

    const templateRow = placeholderRows[0];
    const anchor = placeholderRows[0];

    tools.forEach((entry, i) => {
      const clone = templateRow.cloneNode(true) as Element;
      this.fillToolsUsedRow(clone, entry, i + 1);
      table.insertBefore(clone, anchor);
    });

    for (const row of placeholderRows) {
      table.removeChild(row);
    }
  }

  /** Each of {S.No}/{Tool Name}/{Tool Version}/{Open Source/Licensed} falls back to "NA" independently, per row. */
  private fillToolsUsedRow(row: Element, entry: ToolUsedRow, sNo: number): void {
    const resolver = (n: string) => {
      if (n.includes('s_no') || n === 'sno') return String(sNo);
      if (n.includes('tool_name')) return entry.name || 'NA';
      if (n.includes('tool_version')) return entry.version || 'NA';
      if (n.includes('open_source') || n.includes('licensed')) return entry.licenseType || 'NA';
      return undefined;
    };
    const paragraphs = Array.from(row.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    for (const para of paragraphs) {
      this.replacePlaceholdersInParagraph(para, resolver);
    }
  }

  /**
   * {network.nmap_ip} / {port} / {Protocol} / {Service} / {Status}: table
   * fed by an imported Nmap scan. Same clone-per-record approach as the
   * Network Scope table — one row per record, never merged across hosts.
   */
  private fillNmapPortsTable(doc: Document, records: NmapPortRecord[]): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];
    const table = tables.find((t) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('nmap') && x.includes('{port}');
    });
    if (!table) return;

    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const placeholderRows = rows.filter((r) => this.getElementText(r).toLowerCase().includes('{port}'));
    if (placeholderRows.length === 0) return;

    const templateRow = placeholderRows[0];
    const anchor = placeholderRows[0];

    for (const record of records) {
      const clone = templateRow.cloneNode(true) as Element;
      this.fillNmapPortsRow(clone, record);
      table.insertBefore(clone, anchor);
    }

    for (const row of placeholderRows) {
      table.removeChild(row);
    }
  }

  private fillNmapPortsRow(row: Element, record: NmapPortRecord): void {
    const resolver = (n: string) => {
      if (n.includes('nmap')) return record.ip || 'NA';
      if (n.includes('port')) return record.port || 'NA';
      if (n.includes('protocol')) return record.protocol || 'NA';
      if (n.includes('service')) return record.service || 'NA';
      if (n.includes('status')) return record.status || 'NA';
      return undefined;
    };
    const paragraphs = Array.from(row.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
    for (const para of paragraphs) {
      this.replacePlaceholdersInParagraph(para, resolver);
    }
  }

  /**
   * Detailed Findings: one template table represents ONE finding block.
   * Fill its label/value rows in place; expand the POC step row into one
   * row per POC step (with embedded snapshot).
   */
  private fillDetailedBlock(
    doc: Document,
    table: Element,
    finding: FindingData,
    imageRegistry: Map<string, RegisteredImage>,
    severityColors: Record<string, string>,
    unresolved: Set<string>,
  ): void {
    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const isPocStepRow = (row: Element) => {
      const text = this.getElementText(row).toLowerCase();
      return (
        text.includes('poc reproduction') || text.includes('poc snapshot') || /step\s*1/.test(text) ||
        text.includes('{steps}') || text.includes('{poc}')
      );
    };

    for (const row of rows) {
      if (!isPocStepRow(row)) {
        this.fillDetailedRow(row, finding, severityColors, unresolved);
        continue;
      }

      // Expand into one row per POC step
      const pocSteps = finding.pocSteps || [];
      if (pocSteps.length === 0) {
        const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
        if (cells[0]) this.replaceCellValue(cells[0], 'POC: N/A');
        if (cells[1]) this.replaceCellValue(cells[1], 'N/A');
        continue;
      }
      for (const step of pocSteps) {
        const clone = row.cloneNode(true) as Element;
        const cells = Array.from(clone.getElementsByTagNameNS(this.W_NS, 'tc'));
        if (cells[0]) this.setStepCellText(cells[0], step.stepNo, step.description);
        if (cells[1]) {
          const img = step.imageKey ? imageRegistry.get(step.imageKey) : undefined;
          if (img) {
            this.setCellImage(doc, cells[1], img);
          } else {
            this.replaceCellValue(cells[1], 'N/A');
          }
        }
        table.insertBefore(clone, row);
      }
      table.removeChild(row);
    }
  }

  /**
   * Fills a detailed-block row purely by resolving whatever {Parameter}
   * placeholders its cells contain — the same engine used for the rest of
   * the document and the summary table, just resolved against this one
   * finding. Replaces the old row-label/digit-position heuristics: a
   * finding-table cell must now contain an explicit {Finding Title},
   * {Severity}, {CVSS Vector}, {CVE/CWE}, etc. placeholder to be filled.
   */
  private fillDetailedRow(row: Element, finding: FindingData, severityColors: Record<string, string>, unresolved: Set<string>): void {
    const resolver = (n: string) => {
      const v = this.resolveFindingParameter(n, finding);
      if (v === undefined) unresolved.add(n);
      return v;
    };
    const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
    for (const cell of cells) {
      // A cell may combine {Severity} with other values (e.g. Cert-In's
      // "{Severity} | {CVSS Score} | {CVSS Vector}") — it's still the severity cell.
      const hadSeverity = /\{\s*severity\s*\}/i.test(this.getElementText(cell));
      const paragraphs = Array.from(cell.getElementsByTagNameNS(this.W_NS, 'p')) as Element[];
      for (const para of paragraphs) {
        this.replacePlaceholdersInParagraph(para, resolver);
      }
      if (hadSeverity || this.getElementText(cell).trim() === finding.severity) {
        const color = severityColors[finding.severity];
        if (color) this.setCellShading(cell, color);
      }
    }
  }

  /**
   * Per-finding Application Parameter Registry — the finding-scoped
   * counterpart to reports.service.ts's project/report parameter
   * resolver. FindingData already carries every value a template could
   * need, so resolution here is a straightforward canonical-name lookup;
   * several aliases are accepted per parameter to match the naming
   * variants used across existing and new templates.
   */
  resolveFindingParameter(normalizedName: string, finding: FindingData): string | undefined {
    const cvssCombined = finding.cvssScore != null
      ? `${finding.cvssScore}${finding.cvssVector ? ` | ${finding.cvssVector}` : ''}`
      : 'N/A';
    const cveCwe = [finding.cveId, finding.cweId].filter(Boolean).join(' / ') || 'N/A';

    const registry: Record<string, string> = {
      s_no: `${finding.no}.`,
      finding_no: `${finding.no}.`,
      sno: `${finding.no}.`,
      finding_title: finding.title,
      vulnerability_name: finding.title,
      severity: finding.severity,
      cvss_score: finding.cvssScore != null ? String(finding.cvssScore) : 'N/A',
      score_value: finding.cvssScore != null ? String(finding.cvssScore) : 'N/A',
      cvss_vector: finding.cvssVector || 'N/A',
      cvss: cvssCombined,
      cve_cwe: cveCwe,
      cve_id: finding.cveId || 'N/A',
      cve: finding.cveId || 'N/A',
      cwe_id: finding.cweId || 'N/A',
      cwe: finding.cweId || 'N/A',
      description: finding.description || 'N/A',
      vulnerability_description: finding.description || 'N/A',
      impact: finding.impact || 'N/A',
      vulnerability_impact: finding.impact || 'N/A',
      remediation: finding.remediation || 'N/A',
      vulnerability_remediation: finding.remediation || 'N/A',
      reference: finding.references || 'N/A',
      references: finding.references || 'N/A',
      reference_link: finding.references || 'N/A',
      vulnerability_references: finding.references || 'N/A',
      affected: finding.affectedInstances || 'N/A',
      affected_url: finding.affectedInstances || 'N/A',
      affected_instances: finding.affectedInstances || 'N/A',
      authentication: finding.authenticationType || 'N/A',
      authentication_type: finding.authenticationType || 'N/A',
      vulnerability_dependency: finding.vulnerabilityDependency || 'N/A',
      status: finding.reportStatus || 'Open',
      report_status: finding.reportStatus || 'Open',
    };
    return registry[normalizedName];
  }

  // ---------------------------------------------------------------------------
  // Image embedding
  // ---------------------------------------------------------------------------

  private async registerImages(zip: any, images: PocImage[]): Promise<Map<string, RegisteredImage>> {
    const registry = new Map<string, RegisteredImage>();
    if (images.length === 0) return registry;

    // Relationships
    const relsPath = 'word/_rels/document.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('text');
    if (!relsXml) {
      this.logger.warn('document.xml.rels not found — images will be skipped');
      return registry;
    }
    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');

    let maxRid = 0;
    const existing = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < existing.length; i++) {
      const id = existing.item(i)?.getAttribute('Id') || '';
      const m = id.match(/rId(\d+)/);
      if (m) maxRid = Math.max(maxRid, parseInt(m[1], 10));
    }

    // Content types
    const ctPath = '[Content_Types].xml';
    const ctXml = await zip.file(ctPath)?.async('text');
    const ctDoc = ctXml ? parser.parseFromString(ctXml, 'text/xml') : null;
    const ensuredExtensions = new Set<string>();

    let index = 0;
    for (const image of images) {
      index++;
      const ext = image.extension.toLowerCase().replace('jpeg', 'jpg');
      const mediaName = `poc_image_${index}.${ext}`;
      zip.file(`word/media/${mediaName}`, image.buffer);

      maxRid++;
      const rId = `rId${maxRid}`;
      const rel = relsDoc.createElementNS(this.RELS_NS, 'Relationship');
      rel.setAttribute('Id', rId);
      rel.setAttribute(
        'Type',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      );
      rel.setAttribute('Target', `media/${mediaName}`);
      relsDoc.documentElement.appendChild(rel);

      if (ctDoc && !ensuredExtensions.has(ext)) {
        ensuredExtensions.add(ext);
        this.ensureContentTypeDefault(ctDoc, ext, ext === 'png' ? 'image/png' : 'image/jpeg');
      }

      const dims = this.getImageDimensions(image.buffer, ext);
      let widthEmu = dims.width * EMU_PER_PX;
      let heightEmu = dims.height * EMU_PER_PX;
      if (widthEmu > MAX_IMAGE_WIDTH_EMU) {
        const scale = MAX_IMAGE_WIDTH_EMU / widthEmu;
        widthEmu = MAX_IMAGE_WIDTH_EMU;
        heightEmu = Math.round(heightEmu * scale);
      }

      registry.set(image.key, { rId, mediaName, widthEmu, heightEmu });
    }

    const serializer = new XMLSerializer();
    zip.file(relsPath, serializer.serializeToString(relsDoc));
    if (ctDoc) {
      zip.file(ctPath, serializer.serializeToString(ctDoc));
    }

    return registry;
  }

  private ensureContentTypeDefault(ctDoc: Document, extension: string, contentType: string): void {
    const defaults = ctDoc.getElementsByTagName('Default');
    for (let i = 0; i < defaults.length; i++) {
      if (defaults.item(i)?.getAttribute('Extension') === extension) return;
    }
    const el = ctDoc.createElementNS(this.CT_NS, 'Default');
    el.setAttribute('Extension', extension);
    el.setAttribute('ContentType', contentType);
    ctDoc.documentElement.appendChild(el);
  }

  private getImageDimensions(buffer: Buffer, ext: string): { width: number; height: number } {
    try {
      if (ext === 'png' && buffer.length > 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
      if (ext === 'jpg') {
        let offset = 2;
        while (offset + 9 < buffer.length) {
          if (buffer[offset] !== 0xff) break;
          const marker = buffer[offset + 1];
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return {
              height: buffer.readUInt16BE(offset + 5),
              width: buffer.readUInt16BE(offset + 7),
            };
          }
          const len = buffer.readUInt16BE(offset + 2);
          offset += 2 + len;
        }
      }
    } catch {
      // fall through to default
    }
    return { width: 800, height: 450 };
  }

  private setCellImage(doc: Document, cell: Element, img: RegisteredImage): void {
    // Clear existing paragraphs' text
    const paragraphs = Array.from(cell.getElementsByTagNameNS(this.W_NS, 'p'));
    for (const p of paragraphs) {
      cell.removeChild(p);
    }

    const para = doc.createElementNS(this.W_NS, 'w:p');
    const run = doc.createElementNS(this.W_NS, 'w:r');
    const drawing = doc.createElementNS(this.W_NS, 'w:drawing');

    const inline = doc.createElementNS(this.WP_NS, 'wp:inline');
    const extent = doc.createElementNS(this.WP_NS, 'wp:extent');
    extent.setAttribute('cx', String(img.widthEmu));
    extent.setAttribute('cy', String(img.heightEmu));
    inline.appendChild(extent);

    const docPr = doc.createElementNS(this.WP_NS, 'wp:docPr');
    docPr.setAttribute('id', String(Math.floor(Math.random() * 100000) + 1));
    docPr.setAttribute('name', img.mediaName);
    inline.appendChild(docPr);

    const graphic = doc.createElementNS(this.A_NS, 'a:graphic');
    const graphicData = doc.createElementNS(this.A_NS, 'a:graphicData');
    graphicData.setAttribute(
      'uri',
      'http://schemas.openxmlformats.org/drawingml/2006/picture',
    );

    const pic = doc.createElementNS(this.PIC_NS, 'pic:pic');

    const nvPicPr = doc.createElementNS(this.PIC_NS, 'pic:nvPicPr');
    const cNvPr = doc.createElementNS(this.PIC_NS, 'pic:cNvPr');
    cNvPr.setAttribute('id', '0');
    cNvPr.setAttribute('name', img.mediaName);
    nvPicPr.appendChild(cNvPr);
    nvPicPr.appendChild(doc.createElementNS(this.PIC_NS, 'pic:cNvPicPr'));
    pic.appendChild(nvPicPr);

    const blipFill = doc.createElementNS(this.PIC_NS, 'pic:blipFill');
    const blip = doc.createElementNS(this.A_NS, 'a:blip');
    blip.setAttributeNS(this.R_NS, 'r:embed', img.rId);
    blipFill.appendChild(blip);
    const stretch = doc.createElementNS(this.A_NS, 'a:stretch');
    stretch.appendChild(doc.createElementNS(this.A_NS, 'a:fillRect'));
    blipFill.appendChild(stretch);
    pic.appendChild(blipFill);

    const spPr = doc.createElementNS(this.PIC_NS, 'pic:spPr');
    const xfrm = doc.createElementNS(this.A_NS, 'a:xfrm');
    const off = doc.createElementNS(this.A_NS, 'a:off');
    off.setAttribute('x', '0');
    off.setAttribute('y', '0');
    xfrm.appendChild(off);
    const ext = doc.createElementNS(this.A_NS, 'a:ext');
    ext.setAttribute('cx', String(img.widthEmu));
    ext.setAttribute('cy', String(img.heightEmu));
    xfrm.appendChild(ext);
    spPr.appendChild(xfrm);
    const prstGeom = doc.createElementNS(this.A_NS, 'a:prstGeom');
    prstGeom.setAttribute('prst', 'rect');
    prstGeom.appendChild(doc.createElementNS(this.A_NS, 'a:avLst'));
    spPr.appendChild(prstGeom);
    pic.appendChild(spPr);

    graphicData.appendChild(pic);
    graphic.appendChild(graphicData);
    inline.appendChild(graphic);
    drawing.appendChild(inline);
    run.appendChild(drawing);
    para.appendChild(run);
    cell.appendChild(para);
  }

  // ---------------------------------------------------------------------------
  // Run merging (fixes placeholders split across multiple runs by Word)
  // ---------------------------------------------------------------------------

  private mergeAllHighlightedRuns(doc: Document): void {
    const paragraphs = doc.getElementsByTagNameNS(this.W_NS, 'p');
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs.item(i);
      if (para) this.mergeHighlightedRunsInParagraph(para);
    }
  }

  private mergeHighlightedRunsInParagraph(para: Element): void {
    let target: Element | null = null;
    const children = para.childNodes;

    // Iterate over a snapshot because we mutate during the walk
    const snapshot: Element[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i);
      if (child && (child as Element).tagName) snapshot.push(child as Element);
    }

    for (const child of snapshot) {
      const localName = (child as any).localName || child.tagName;
      if (localName !== 'r' && localName !== 'w:r') {
        // Non-run elements (bookmarks, proofErr) do not break a merge group
        continue;
      }
      const rPr = this.getFirstChildByTagName(child, 'rPr');
      const highlighted = rPr && this.hasYellowHighlight(rPr);

      if (highlighted) {
        if (target) {
          // Merge this run into the target run
          const text = this.getRunText(child);
          if (text) {
            const textNodes = target.getElementsByTagNameNS(this.W_NS, 't');
            const firstText = textNodes.item(0);
            if (firstText?.firstChild) {
              // NOTE: xmldom nodeValue is stale after writes — use .data for read+write
              const tn: any = firstText.firstChild;
              tn.data = (tn.data || '') + text;
            } else if (firstText) {
              firstText.textContent = text;
            }
          }
          para.removeChild(child);
        } else {
          target = child;
        }
      } else {
        target = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Low-level helpers
  // ---------------------------------------------------------------------------

  private async loadDocument(docxBuffer: Buffer): Promise<{ zip: any; doc: Document }> {
    const zip = await JSZip.loadAsync(docxBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('text');
    if (!documentXml) {
      throw new Error('Invalid DOCX: document.xml not found');
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(documentXml, 'text/xml');
    return { zip, doc };
  }

  private getRunText(run: Element): string {
    const textNodes = run.getElementsByTagNameNS(this.W_NS, 't');
    let text = '';
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes.item(i);
      // Read .data first: xmldom nodeValue is stale after writes
      const v: any = node?.firstChild;
      if (v) text += v.data ?? v.nodeValue ?? '';
    }
    return text;
  }

  private setRunText(run: Element, text: string): void {
    const textNodes = run.getElementsByTagNameNS(this.W_NS, 't');
    const first = textNodes.item(0);
    if (first) {
      if (first.firstChild) {
        // NOTE: xmldom nodeValue is stale after writes — use .data
        (first.firstChild as any).data = text;
      } else {
        first.textContent = text;
      }
      for (let i = textNodes.length - 1; i > 0; i--) {
        const tn = textNodes.item(i);
        if (tn) run.removeChild(tn);
      }
    } else {
      const doc = run.ownerDocument;
      const t = doc.createElementNS(this.W_NS, 'w:t');
      t.textContent = text;
      run.appendChild(t);
    }
  }

  /** Renders "STEP n: description" with only the "STEP n:" label bold. */
  /**
   * Writes "Step N: description" into the template's step cell. Both runs
   * clone the template label run's own formatting (font, size, colour, bold,
   * ...) — only the description drops bold/italic-style emphasis the label
   * carries — and the label keeps the template's own wording/case
   * ("STEP 1: " vs "Step 1:") with just the number swapped.
   */
  private setStepCellText(cell: Element, stepNo: number, description: string): void {
    const doc = cell.ownerDocument;
    const para = cell.getElementsByTagNameNS(this.W_NS, 'p').item(0);
    if (!para) return;

    const labelRun = Array.from(para.getElementsByTagNameNS(this.W_NS, 'r')).find((r) => this.getRunText(r).trim()) ?? null;
    const templateRPr = labelRun ? this.getFirstChildByTagName(labelRun, 'rPr') : null;
    const labelText = labelRun ? this.getRunText(labelRun) : '';
    const label = (/\d/.test(labelText) ? labelText.replace(/\d+/, String(stepNo)) : `Step ${stepNo}:`).replace(/(\S)$/, '$1 ');

    for (const run of Array.from(para.getElementsByTagNameNS(this.W_NS, 'r'))) {
      para.removeChild(run);
    }

    const makeRun = (text: string, emphasis: boolean) => {
      const run = doc.createElementNS(this.W_NS, 'w:r');
      if (templateRPr) {
        const rPr = templateRPr.cloneNode(true) as Element;
        if (!emphasis) {
          for (const tag of ['b', 'bCs']) {
            for (const n of Array.from(rPr.getElementsByTagNameNS(this.W_NS, tag))) rPr.removeChild(n);
          }
        }
        run.appendChild(rPr);
      }
      const t = doc.createElementNS(this.W_NS, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = text;
      run.appendChild(t);
      return run;
    };

    para.appendChild(makeRun(label, true));
    para.appendChild(makeRun(description, false));
  }

  private replaceCellValue(cell: Element, value: string): void {
    const runs = Array.from(cell.getElementsByTagNameNS(this.W_NS, 'r'));
    // Prefer the highlighted run; otherwise the first run with text; otherwise first run
    const highlighted = runs.find((r) => {
      const rPr = this.getFirstChildByTagName(r, 'rPr');
      return rPr && this.hasYellowHighlight(rPr);
    });
    const target =
      highlighted ||
      runs.find((r) => this.getRunText(r).trim().length > 0) ||
      runs[0];

    if (target) {
      this.setRunText(target, value);
      const rPr = this.getFirstChildByTagName(target, 'rPr');
      if (rPr) this.removeYellowHighlight(rPr);
      // Clear any other runs in the cell that held placeholder fragments
      for (const r of runs) {
        if (r !== target) this.setRunText(r, '');
      }
    }
  }

  /** Sets a table cell's background fill to the given hex color (e.g. "#ef4444"). */
  private setCellShading(cell: Element, hexColor: string): void {
    const doc = cell.ownerDocument;
    let tcPr = this.getFirstChildByTagName(cell, 'tcPr');
    if (!tcPr) {
      tcPr = doc.createElementNS(this.W_NS, 'w:tcPr');
      cell.insertBefore(tcPr, cell.firstChild);
    }
    const existing = tcPr.getElementsByTagNameNS(this.W_NS, 'shd');
    for (let i = existing.length - 1; i >= 0; i--) {
      const node = existing.item(i);
      if (node) tcPr.removeChild(node);
    }
    const shd = doc.createElementNS(this.W_NS, 'w:shd');
    shd.setAttributeNS(this.W_NS, 'w:val', 'clear');
    shd.setAttributeNS(this.W_NS, 'w:color', 'auto');
    shd.setAttributeNS(this.W_NS, 'w:fill', hexColor.replace('#', ''));
    tcPr.appendChild(shd);
  }

  private hasYellowHighlight(rPr: Element): boolean {
    const highlights = rPr.getElementsByTagNameNS(this.W_NS, 'highlight');
    for (let i = 0; i < highlights.length; i++) {
      const val = highlights.item(i)?.getAttributeNS(this.W_NS, 'val');
      if (val && val.toLowerCase() === 'yellow') return true;
    }
    const shadings = rPr.getElementsByTagNameNS(this.W_NS, 'shd');
    for (let i = 0; i < shadings.length; i++) {
      const fill = shadings.item(i)?.getAttributeNS(this.W_NS, 'fill');
      if (fill && ['ffff00', 'ffee00', 'ffd700'].includes(fill.toLowerCase())) return true;
    }
    return false;
  }

  private removeYellowHighlight(rPr: Element): void {
    const highlights = rPr.getElementsByTagNameNS(this.W_NS, 'highlight');
    for (let i = highlights.length - 1; i >= 0; i--) {
      const highlight = highlights.item(i);
      if (highlight && highlight.getAttributeNS(this.W_NS, 'val')?.toLowerCase() === 'yellow') {
        rPr.removeChild(highlight);
      }
    }
    const shadings = rPr.getElementsByTagNameNS(this.W_NS, 'shd');
    for (let i = shadings.length - 1; i >= 0; i--) {
      const shading = shadings.item(i);
      const fill = shading?.getAttributeNS(this.W_NS, 'fill');
      if (shading && fill && ['ffff00', 'ffee00', 'ffd700'].includes(fill.toLowerCase())) {
        rPr.removeChild(shading);
      }
    }
  }

  private normalizeFieldName(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 100);
  }

  private categorizeField(text: string): TemplateField['category'] {
    const lower = text.toLowerCase();
    if (
      lower.includes('vulnerability') || lower.includes('score') || lower.includes('cve') ||
      lower.includes('cwe') || lower.includes('affected url') || lower.includes('poc') ||
      lower.includes('snapshot') || lower.includes('description') || lower.includes('reference')
    ) {
      return 'vulnerability';
    }
    if (
      lower.includes('name') || lower.includes('client') || lower.includes('application') ||
      lower.includes('api') || lower.includes('scope') || lower.includes('purpose') ||
      lower.includes('limitation') || lower.includes('environment') || lower.includes('box') ||
      lower.includes('tools') || lower.includes('login')
    ) {
      return 'project_info';
    }
    if (
      lower.includes('contact') || lower.includes('email') || lower.includes('phone') ||
      lower.includes('lead') || lower.includes('avp') || lower.includes('tester') ||
      lower.includes('reviewer')
    ) {
      return 'contact';
    }
    if (lower.includes('date') || lower.includes('month')) {
      return 'date';
    }
    return 'other';
  }

  private generateDescription(text: string): string {
    return text.replace(/[{}[\]]/g, '').replace(/^\s+/, '').replace(/\s+$/, '');
  }

  private isRepeatableField(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('vulnerability') || lower.includes('score') ||
      lower.includes('cve') || lower.includes('cwe') ||
      lower.includes('description') || lower.includes('poc') ||
      lower.includes('snapshot') || lower.includes('affected')
    );
  }

  private getElementText(element: Element): string {
    const textNodes = element.getElementsByTagNameNS(this.W_NS, 't');
    let text = '';
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes.item(i);
      const v: any = node?.firstChild;
      if (v) text += v.data ?? v.nodeValue ?? '';
    }
    return text;
  }

  private getFirstChildByTagName(parent: Element, tagName: string): Element | null {
    const children = parent.getElementsByTagNameNS(this.W_NS, tagName);
    return children.length > 0 ? children.item(0) : null;
  }
}
