import { Injectable } from '@nestjs/common';
import * as JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PLACEHOLDER_RE = /\{([^{}]+)\}/g;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_RE = /^xl\/worksheets\/[^/]+\.xml$/;

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
        }
      }
    }
    return [...found];
  }

  /** Returns a copy of the workbook with every resolvable placeholder replaced; unresolved ones stay literal. */
  async fill(xlsx: Buffer, resolve: (raw: string) => string | undefined): Promise<Buffer> {
    const zip = await this.load(xlsx);
    const subst = (s: string) =>
      s.replace(PLACEHOLDER_RE, (m, raw: string) => {
        const name = raw.trim();
        if (!name) return m;
        const v = resolve(name);
        return v === undefined ? m : v;
      });

    // Shared strings are workbook-wide: one replacement is seen identically by every cell on every sheet.
    const shared = await this.readShared(zip);
    if (shared.doc && shared.changedBy(subst)) {
      zip.file('xl/sharedStrings.xml', this.serialize(shared.doc));
    }

    for (const path of this.sheetPaths(zip)) {
      const xml = await zip.file(path)!.async('text');
      if (!xml.includes('inlineStr')) continue;
      const doc = this.parse(xml);
      let changed = false;
      for (const is of Array.from(doc.getElementsByTagNameNS(NS, 'is'))) {
        if (this.replaceInString(is, subst)) changed = true;
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

  private async load(xlsx: Buffer) {
    const zip = await JSZip.loadAsync(xlsx);
    if (!zip.file('xl/workbook.xml')) throw new Error('Not a valid .xlsx workbook (xl/workbook.xml missing)');
    return zip;
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
