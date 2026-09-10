import { Injectable, Logger } from '@nestjs/common';
import * as JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

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

  // ---------------------------------------------------------------------------
  // Template field extraction (upload flow)
  // ---------------------------------------------------------------------------

  /**
   * Extract yellow-highlighted fields from a DOCX buffer.
   * Consecutive highlighted runs are merged first, because Word splits
   * placeholders such as "{Client Name, Location}" into several runs.
   */
  async extractYellowFields(docxBuffer: Buffer): Promise<TemplateField[]> {
    const { doc } = await this.loadDocument(docxBuffer);
    this.mergeAllHighlightedRuns(doc);

    const paragraphs = doc.getElementsByTagNameNS(this.W_NS, 'p');
    const fields: Map<string, TemplateField> = new Map();

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs.item(i);
      if (!para) continue;

      const runs = para.getElementsByTagNameNS(this.W_NS, 'r');
      for (let j = 0; j < runs.length; j++) {
        const run = runs.item(j);
        if (!run) continue;

        const rPr = this.getFirstChildByTagName(run, 'rPr');
        if (!rPr || !this.hasYellowHighlight(rPr)) continue;

        const cleanedText = this.getRunText(run).trim();
        if (!cleanedText || cleanedText.length < 2) continue;
        // Skip runs that are only braces/punctuation — fragments, not fields
        if (/^[{}\s.,/\\()\[\]]+$/.test(cleanedText)) continue;

        const normalizedName = this.normalizeFieldName(cleanedText);
        if (!normalizedName || fields.has(normalizedName)) continue;

        fields.set(normalizedName, {
          id: `field_${normalizedName}`,
          name: cleanedText,
          normalizedName,
          category: this.categorizeField(cleanedText),
          description: this.generateDescription(cleanedText),
          isRepeatable: this.isRepeatableField(cleanedText),
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
    const fields = await this.extractYellowFields(docxBuffer);
    const { doc } = await this.loadDocument(docxBuffer);
    this.mergeAllHighlightedRuns(doc);

    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    const tables = body ? body.getElementsByTagNameNS(this.W_NS, 'tbl') : ([] as any);

    let hasSummaryTable = false;
    let hasDetailedTable = false;
    for (let t = 0; t < tables.length; t++) {
      const table = tables.item(t);
      if (!table) continue;
      const text = this.getElementText(table).toLowerCase();
      const isDetailed = text.includes('cve/cwe');
      const isSummary =
        !isDetailed && text.includes('{vulnerability name}') && text.includes('{score value}');
      if (isDetailed && text.includes('{vulnerability name}')) hasDetailedTable = true;
      if (isSummary) hasSummaryTable = true;
    }

    const allText = fields.map((f) => f.normalizedName).join(' ');
    const mandatory: { label: string; present: boolean }[] = [
      { label: 'Summary table ({Vulnerability Name} + {Score Value})', present: hasSummaryTable },
      { label: 'Detailed findings table (with CVE/CWE ID)', present: hasDetailedTable },
      { label: 'Affected URL and Paths', present: allText.includes('affected_url') },
      { label: 'Authentication Type', present: allText.includes('authentication_type') },
      { label: 'Vulnerability Description', present: allText.includes('vulnerability_description') },
      { label: 'Reference Link', present: allText.includes('reference_link') },
      { label: 'POC reproduction Steps', present: allText.includes('poc_reproduction_steps') },
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

    // Step 2: fill the contact table row-aware (AVP / TL / Tester each get
    // their own phone/email/title — a generic rule cannot distinguish rows).
    // Filled runs lose their highlight, so the generic pass below skips them.
    if (contacts) {
      this.fillContactTable(doc, contacts);
    }

    // Step 3: replace project-info / contact / date fields via rules
    this.replaceFieldsWithRules(doc, rules);

    // Step 4: fill the template's own findings tables
    if (findings.length > 0) {
      this.fillFindingsTables(doc, findings, imageRegistry, severityColors);
    }

    // Step 5: serialize back
    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(doc);
    zip.file('word/document.xml', updatedXml);

    return zip.generateAsync({ type: 'nodebuffer' });
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

  private replaceFieldsWithRules(doc: Document, rules: FieldRule[]): void {
    const paragraphs = doc.getElementsByTagNameNS(this.W_NS, 'p');

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs.item(i);
      if (!para) continue;

      const runs = Array.from(para.getElementsByTagNameNS(this.W_NS, 'r'));
      for (const run of runs) {
        const rPr = this.getFirstChildByTagName(run, 'rPr');
        if (!rPr || !this.hasYellowHighlight(rPr)) continue;

        const currentText = this.getRunText(run).trim();
        if (!currentText) continue;
        const normalized = this.normalizeFieldName(currentText);

        const rule = rules.find((r) =>
          r.requireAll
            ? r.match.every((m) => normalized.includes(m))
            : r.match.some((m) => normalized.includes(m)),
        );
        if (rule) {
          this.setRunText(run, rule.value);
          this.removeYellowHighlight(rPr);
          this.clearBraceResidue(run);
        }
      }
    }
  }

  /**
   * After replacing a placeholder, remove orphaned brace fragments from
   * adjacent non-highlighted runs (e.g. "{Application Scope" + "}").
   */
  private clearBraceResidue(run: Element): void {
    for (const sibling of [this.adjacentElement(run, 1), this.adjacentElement(run, -1)]) {
      if (!sibling) continue;
      const localName = (sibling as any).localName || sibling.tagName;
      if (localName !== 'r') continue;
      const rPr = this.getFirstChildByTagName(sibling, 'rPr');
      if (rPr && this.hasYellowHighlight(rPr)) continue; // never touch other placeholders
      const text = this.getRunText(sibling).trim();
      if (text && text.length <= 2 && /^[{}\[\]()<>.,\s]+$/.test(text)) {
        this.setRunText(sibling, '');
      }
    }
  }

  private adjacentElement(el: Element, direction: 1 | -1): Element | null {
    let node = direction === 1 ? el.nextSibling : el.previousSibling;
    while (node) {
      if ((node as Element).tagName) return node as Element;
      node = direction === 1 ? node.nextSibling : node.previousSibling;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Findings tables
  // ---------------------------------------------------------------------------

  private fillFindingsTables(
    doc: Document,
    findings: FindingData[],
    imageRegistry: Map<string, RegisteredImage>,
    severityColors: Record<string, string>,
  ): void {
    const body = doc.getElementsByTagNameNS(this.W_NS, 'body').item(0);
    if (!body) return;

    // Snapshot the table list — we mutate the tree while processing
    const tables = Array.from(body.getElementsByTagNameNS(this.W_NS, 'tbl')) as Element[];

    const isDetailed = (t: Element) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('{vulnerability name}') && x.includes('cve/cwe');
    };
    const isSummary = (t: Element) => {
      const x = this.getElementText(t).toLowerCase();
      return x.includes('{vulnerability name}') && x.includes('{score value}') && !x.includes('cve/cwe');
    };

    const summaryTable = tables.find(isSummary);
    if (summaryTable) {
      this.widenFirstColumn(summaryTable);
      this.fillSummaryTable(doc, summaryTable, findings, severityColors);
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
        tbl = pristine.cloneNode(true) as Element;
        anchor.parentNode?.insertBefore(tbl, anchor.nextSibling);
      }
      this.fillDetailedBlock(doc, tbl, finding, imageRegistry, severityColors);

      anchor = tbl;
      if (i < findings.length - 1) {
        // Page break so each finding starts on its own page.
        const pageBreak = this.createPageBreakParagraph(doc);
        tbl.parentNode?.insertBefore(pageBreak, tbl.nextSibling);
        anchor = pageBreak;
      }
    });

    // Remove unused placeholder tables
    for (let i = findings.length; i < detailedTables.length; i++) {
      detailedTables[i].parentNode?.removeChild(detailedTables[i]);
    }
  }

  private createPageBreakParagraph(doc: Document): Element {
    const p = doc.createElementNS(this.W_NS, 'w:p');
    const run = doc.createElementNS(this.W_NS, 'w:r');
    const br = doc.createElementNS(this.W_NS, 'w:br');
    br.setAttributeNS(this.W_NS, 'w:type', 'page');
    run.appendChild(br);
    p.appendChild(run);
    return p;
  }

  /** Widens a table's first column (grid + every row's first cell) by ~3px. */
  private widenFirstColumn(table: Element): void {
    const deltaTwips = 45; // 3px at 96 DPI (1px = 15 twips)

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
  private fillSummaryTable(doc: Document, table: Element, findings: FindingData[], severityColors: Record<string, string>): void {
    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const placeholderRows = rows.filter((r) =>
      this.getElementText(r).toLowerCase().includes('{vulnerability name}'),
    );
    if (placeholderRows.length === 0) return;

    const templateRow = placeholderRows[0];
    const anchor = placeholderRows[0];

    for (const finding of findings) {
      const clone = templateRow.cloneNode(true) as Element;
      this.fillSummaryRow(clone, finding, severityColors);
      table.insertBefore(clone, anchor);
    }

    for (const row of placeholderRows) {
      table.removeChild(row);
    }
  }

  private fillSummaryRow(row: Element, finding: FindingData, severityColors: Record<string, string>): void {
    const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
    for (const cell of cells) {
      const text = this.getElementText(cell).trim();
      const lower = text.toLowerCase();

      if (lower.includes('{vulnerability name}')) {
        this.replaceCellValue(cell, finding.title);
      } else if (lower.includes('{score value}')) {
        this.replaceCellValue(cell, finding.cvssScore?.toString() ?? 'N/A');
      } else if (/^\d+\.?$/.test(text)) {
        this.replaceCellValue(cell, `${finding.no}.`);
      } else if (['critical', 'high', 'medium', 'low', 'info'].includes(lower)) {
        this.replaceCellValue(cell, finding.severity);
        const color = severityColors[finding.severity];
        if (color) this.setCellShading(cell, color);
      } else if (['open', 'fixed', 'closed', 'accepted risk'].includes(lower)) {
        this.replaceCellValue(cell, finding.reportStatus || 'Open');
      }
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
  ): void {
    const rows = Array.from(table.getElementsByTagNameNS(this.W_NS, 'tr'));
    const isPocStepRow = (row: Element) => {
      const text = this.getElementText(row).toLowerCase();
      return text.includes('poc reproduction') || text.includes('poc snapshot') || /step\s*1/.test(text);
    };

    for (const row of rows) {
      if (!isPocStepRow(row)) {
        this.fillDetailedRow(row, finding, severityColors);
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

  private fillDetailedRow(row: Element, finding: FindingData, severityColors: Record<string, string>): void {
    const cells = Array.from(row.getElementsByTagNameNS(this.W_NS, 'tc'));
    if (cells.length === 0) return;

    // Title row: "1." | "{Vulnerability Name}"
    if (this.getElementText(row).toLowerCase().includes('{vulnerability name}')) {
      if (cells[0] && /^\d+\.?$/.test(this.getElementText(cells[0]).trim())) {
        this.replaceCellValue(cells[0], `${finding.no}.`);
      }
      if (cells[1]) this.replaceCellValue(cells[1], finding.title);
      return;
    }

    const label = this.getElementText(cells[0]).trim().toLowerCase().replace(/:$/, '');
    const valueCell = cells[1];
    if (!valueCell) return;

    const cvssText = finding.cvssScore != null
      ? `${finding.cvssScore}${finding.cvssVector ? ` / ${finding.cvssVector}` : ''}`
      : 'N/A';
    const cveCwe = [finding.cveId, finding.cweId].filter(Boolean).join(' / ') || 'N/A';

    if (label.includes('severity')) {
      this.replaceCellValue(valueCell, finding.severity);
      const color = severityColors[finding.severity];
      if (color) this.setCellShading(valueCell, color);
    } else if (label.includes('cvss')) {
      this.replaceCellValue(valueCell, cvssText);
    } else if (label.includes('cve/cwe')) {
      this.replaceCellValue(valueCell, cveCwe);
    } else if (label.includes('affected')) {
      this.replaceCellValue(valueCell, finding.affectedInstances || 'N/A');
    } else if (label.includes('authentication')) {
      this.replaceCellValue(valueCell, finding.authenticationType || 'N/A');
    } else if (label.includes('vulnerability dependency')) {
      this.replaceCellValue(valueCell, finding.vulnerabilityDependency || 'N/A');
    } else if (label.includes('description')) {
      this.replaceCellValue(valueCell, finding.description || 'N/A');
    } else if (label.includes('impact')) {
      this.replaceCellValue(valueCell, finding.impact || 'N/A');
    } else if (label.includes('remediation')) {
      this.replaceCellValue(valueCell, finding.remediation || 'N/A');
    } else if (label.includes('reference')) {
      this.replaceCellValue(valueCell, finding.references || 'N/A');
    }
    // Rows like the "POC" banner row are left untouched
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
  private setStepCellText(cell: Element, stepNo: number, description: string): void {
    const doc = cell.ownerDocument;
    const para = cell.getElementsByTagNameNS(this.W_NS, 'p').item(0);
    if (!para) return;

    for (const run of Array.from(para.getElementsByTagNameNS(this.W_NS, 'r'))) {
      para.removeChild(run);
    }

    const makeRun = (text: string, bold: boolean) => {
      const run = doc.createElementNS(this.W_NS, 'w:r');
      if (bold) {
        const rPr = doc.createElementNS(this.W_NS, 'w:rPr');
        rPr.appendChild(doc.createElementNS(this.W_NS, 'w:b'));
        run.appendChild(rPr);
      }
      const t = doc.createElementNS(this.W_NS, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = text;
      run.appendChild(t);
      return run;
    };

    para.appendChild(makeRun(`STEP ${stepNo}: `, true));
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
