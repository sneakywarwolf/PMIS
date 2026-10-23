import { Injectable } from '@nestjs/common';
import * as JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PLACEHOLDER_RE = /\{([^{}]+)\}/g;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_RE = /^xl\/worksheets\/[^/]+\.xml$/;

// {Project Status} / {Compliance Status}: same wording and colours as the Word engine.
const STATUS_RE = /^(project|compliance)[\s_-]*status$/i;
const STATUS_LOOKS: Record<string, { value: string; fill: string }> = {
  compliant: { value: 'Compliant', fill: 'FF92D050' },
  'non-compliant': { value: 'Non-Compliant', fill: 'FFFF0000' },
};
const statusLook = (status?: string | null) => STATUS_LOOKS[(status || '').trim().toLowerCase().replace(/[\s_]+/g, '-')] ?? null;

/**
 * Fills `{Parameter}` placeholders in an .xlsx template.
 *
 * The workbook is edited at the XML level (like the Word engine), never rebuilt, so sheet names,
 * order, styles, merged cells, formulas, widths and everything else in the package are left as
 * uploaded. Only the text of string cells that contain a placeholder is rewritten. It knows nothing
 * about which parameters exist: the caller supplies the same resolver Word reports use.
 *
 * Out of scope for now: finding-level placeholders (one value per finding) are not expanded into
 * extra rows, and text inside drawings, headers/footers and comments is not scanned.
 */
@Injectable()
export class XlsxTemplateService {
  /** Raw placeholder names (e.g. "Client Name") used by cells on any worksheet, in first-seen order. */
  async extractPlaceholders(xlsx: Buffer): Promise<string[]> {
    const zip = await this.load(xlsx);
    const shared = await this.readShared(zip);
    const found = new Set<string>();
    const scan = (text: string) => {
      for (const m of text.matchAll(PLACEHOLDER_RE)) {
        const raw = m[1].trim();
        if (raw) found.add(raw);
      }
    };

    for (const path of this.sheetPaths(zip)) {
      const doc = this.parse(await zip.file(path)!.async('text'));
      for (const c of Array.from(doc.getElementsByTagNameNS(NS, 'c'))) {
        const type = c.getAttribute('t');
        if (type === 's') {
          const idx = parseInt(c.getElementsByTagNameNS(NS, 'v').item(0)?.textContent ?? '', 10);
          if (Number.isInteger(idx) && shared.texts[idx] !== undefined) scan(shared.texts[idx]);
        } else if (type === 'inlineStr') {
          const is = c.getElementsByTagNameNS(NS, 'is').item(0);
          if (is) scan(this.textNodes(is).map((t) => t.textContent ?? '').join(''));
        } else {
          const v = this.strValue(c);
          if (v) scan(v.textContent ?? '');
        }
      }
    }
    return [...found];
  }

  /**
   * Returns a copy of the workbook with every resolvable placeholder replaced; unresolved ones stay literal.
   * `{Project Status}` / `{Compliance Status}` print the project's status (Compliant / Non-Compliant, empty
   * for anything else) and, for those two, give the cell a green / red background when the placeholder is all
   * the cell holds. Any other status, or a cell with other text, keeps the cell's own style exactly as the template has it.
   */
  async fill(xlsx: Buffer, resolve: (raw: string) => string | undefined, options?: { complianceStatus?: string | null }): Promise<Buffer> {
    const zip = await this.load(xlsx);
    const look = statusLook(options?.complianceStatus);
    const subst = (s: string) =>
      s.replace(PLACEHOLDER_RE, (m, raw: string) => {
        const name = raw.trim();
        if (!name) return m;
        const v = STATUS_RE.test(name) ? look?.value ?? '' : resolve(name);
        return v === undefined ? m : v;
      });

    // Cells holding the status placeholder are found now, before their text is replaced.
    if (look) await this.colourStatusCells(zip, look.fill);

    // Shared strings are workbook-wide: one replacement is seen identically by every cell on every sheet.
    const shared = await this.readShared(zip);
    if (shared.doc && shared.changedBy(subst)) {
      zip.file('xl/sharedStrings.xml', this.serialize(shared.doc));
    }

    for (const path of this.sheetPaths(zip)) {
      const xml = await zip.file(path)!.async('text');
      if (!xml.includes('inlineStr') && !xml.includes('t="str"')) continue;
      const doc = this.parse(xml);
      let changed = false;
      for (const is of Array.from(doc.getElementsByTagNameNS(NS, 'is'))) {
        if (this.replaceInString(is, subst)) changed = true;
      }
      for (const c of Array.from(doc.getElementsByTagNameNS(NS, 'c'))) {
        const v = this.strValue(c);
        const old = v?.textContent ?? '';
        if (v && subst(old) !== old) {
          v.textContent = subst(old);
          changed = true;
        }
      }
      if (changed) zip.file(path, this.serialize(doc));
    }

    // Formulas that read a filled cell would otherwise show their old cached result until recalculated.
    const wb = await zip.file('xl/workbook.xml')?.async('text');
    if (wb && /<calcPr\b/.test(wb) && !/fullCalcOnLoad=/.test(wb)) {
      zip.file('xl/workbook.xml', wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'));
    }

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  // ---------------------------------------------------------------------------

  /** Gives every cell whose text is just a status placeholder a copy of its own style with a solid `argb` fill. */
  private async colourStatusCells(zip: any, argb: string): Promise<void> {
    const stylesXml = await zip.file('xl/styles.xml')?.async('text');
    if (!stylesXml) return;
    const shared = await this.readShared(zip);
    // Only a cell holding nothing but the status placeholder is coloured; with other text beside it
    // ("{Compliance Status} Report Delivered") just the text is filled and the style is left alone.
    const hasStatus = (text: string) =>
      [...text.matchAll(PLACEHOLDER_RE)].some((m) => STATUS_RE.test(m[1].trim()))
      && !text.replace(PLACEHOLDER_RE, (m, name: string) => (STATUS_RE.test(name.trim()) ? '' : m)).trim();

    const styles = this.parse(stylesXml);
    const first = (name: string) => Array.from(styles.getElementsByTagNameNS(NS, name)).find((e) => e.parentNode === styles.documentElement) as Element | undefined;
    const fills = first('fills');
    const cellXfs = first('cellXfs');
    if (!fills || !cellXfs) return;

    let fillId = -1;
    const clones = new Map<number, number>();
    const styleFor = (orig: number): number => {
      if (fillId < 0) {
        const fill = styles.createElementNS(NS, 'fill');
        const pattern = styles.createElementNS(NS, 'patternFill');
        pattern.setAttribute('patternType', 'solid');
        const fg = styles.createElementNS(NS, 'fgColor');
        fg.setAttribute('rgb', argb);
        const bg = styles.createElementNS(NS, 'bgColor');
        bg.setAttribute('indexed', '64');
        pattern.appendChild(fg);
        pattern.appendChild(bg);
        fill.appendChild(pattern);
        fills.appendChild(fill);
        fillId = Array.from(fills.childNodes).filter((n) => n.nodeType === 1).length - 1;
        fills.setAttribute('count', String(fillId + 1));
      }
      if (!clones.has(orig)) {
        const xfs = Array.from(cellXfs.childNodes).filter((n) => n.nodeType === 1) as Element[];
        const xf = (xfs[orig] ?? xfs[0]).cloneNode(true) as Element;
        xf.setAttribute('fillId', String(fillId));
        xf.setAttribute('applyFill', '1');
        cellXfs.appendChild(xf);
        clones.set(orig, xfs.length);
        cellXfs.setAttribute('count', String(xfs.length + 1));
      }
      return clones.get(orig)!;
    };

    let touched = false;
    for (const path of this.sheetPaths(zip)) {
      const doc = this.parse(await zip.file(path)!.async('text'));
      let changed = false;
      for (const c of Array.from(doc.getElementsByTagNameNS(NS, 'c'))) {
        const type = c.getAttribute('t');
        let text = '';
        if (type === 's') {
          const idx = parseInt(c.getElementsByTagNameNS(NS, 'v').item(0)?.textContent ?? '', 10);
          text = shared.texts[idx] ?? '';
        } else if (type === 'inlineStr') {
          const is = c.getElementsByTagNameNS(NS, 'is').item(0);
          text = is ? this.textNodes(is).map((t) => t.textContent ?? '').join('') : '';
        } else {
          text = this.strValue(c)?.textContent ?? '';
        }
        if (!hasStatus(text)) continue;
        c.setAttribute('s', String(styleFor(parseInt(c.getAttribute('s') ?? '0', 10) || 0)));
        changed = true;
      }
      if (changed) {
        zip.file(path, this.serialize(doc));
        touched = true;
      }
    }
    if (touched) zip.file('xl/styles.xml', this.serialize(styles));
  }

  private async load(xlsx: Buffer) {
    const zip = await JSZip.loadAsync(xlsx);
    if (!zip.file('xl/workbook.xml')) throw new Error('Not a valid .xlsx workbook (xl/workbook.xml missing)');
    return zip;
  }

  /** The <v> of a plain string cell (t="str", as many writers emit instead of shared strings); null for formula cells, whose <v> is a cached result. */
  private strValue(c: Element): Element | null {
    if (c.getAttribute('t') !== 'str' || c.getElementsByTagNameNS(NS, 'f').length) return null;
    return c.getElementsByTagNameNS(NS, 'v').item(0);
  }

  private sheetPaths(zip: any): string[] {
    return Object.keys(zip.files).filter((p) => SHEET_RE.test(p));
  }

  private parse(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'text/xml');
  }

  private serialize(doc: Document): string {
    const xml = new XMLSerializer().serializeToString(doc);
    return xml.startsWith('<?xml') ? xml : XML_DECL + xml;
  }

  /** The <t> elements that hold visible text: direct <t> and run <t>, never phonetic (<rPh>) text. */
  private textNodes(parent: Element): Element[] {
    const out: Element[] = [];
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (el.localName === 't') out.push(el);
      else if (el.localName === 'r') {
        for (let c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 1 && (c as Element).localName === 't') out.push(c as Element);
        }
      }
    }
    return out;
  }

  private setText(t: Element, value: string) {
    t.textContent = value;
    t.setAttribute('xml:space', 'preserve'); // keeps leading/trailing spaces and line breaks
  }

  /**
   * Replaces placeholders inside one string item. A placeholder inside a single run is replaced in
   * place (rich-text formatting of the other runs is kept); one split across runs is merged into
   * the first run.
   */
  private replaceInString(item: Element, subst: (s: string) => string): boolean {
    const nodes = this.textNodes(item);
    let changed = false;
    for (const t of nodes) {
      const old = t.textContent ?? '';
      const next = subst(old);
      if (next !== old) {
        this.setText(t, next);
        changed = true;
      }
    }
    const full = nodes.map((t) => t.textContent ?? '').join('');
    if (nodes.length > 1 && /\{[^{}]+\}/.test(full)) {
      const next = subst(full);
      if (next !== full) {
        this.setText(nodes[0], next);
        for (const t of nodes.slice(1)) this.setText(t, '');
        changed = true;
      }
    }
    return changed;
  }

  private async readShared(zip: any) {
    const xml = await zip.file('xl/sharedStrings.xml')?.async('text');
    if (!xml) return { doc: null as Document | null, texts: [] as string[], changedBy: (_s: (v: string) => string) => false };
    const doc = this.parse(xml);
    const items = Array.from(doc.getElementsByTagNameNS(NS, 'si'));
    const texts = items.map((si) => this.textNodes(si).map((t) => t.textContent ?? '').join(''));
    return {
      doc,
      texts,
      changedBy: (subst: (v: string) => string) => items.map((si) => this.replaceInString(si, subst)).some(Boolean),
    };
  }
}
