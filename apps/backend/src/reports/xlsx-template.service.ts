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
 * A group of template rows that repeat once per record (scope entries, findings, ports). A row belongs to the
 * first set whose `claims` accepts the raw placeholder names found in it; it is then emitted once per entry of
 * `rows`, each entry resolving that row's placeholders (anything it returns undefined for falls back to the
 * workbook-wide resolver). No entries: the row stays once with its claimed placeholders emptied.
 */
export interface RowSet {
  claims: (names: string[]) => boolean;
  rows: ((raw: string) => string | undefined)[];
}

const MAX_ROW = 1048576;
const MAX_CELL_CHARS = 32767;

/** Moves a cell/range reference for `k` rows inserted after row `at`. Whole-column ranges are left alone. */
function shiftRef(ref: string, at: number, k: number, single: 'move' | 'grow' = 'move'): string {
  return ref.split(' ').map((part) => {
    const m = /^(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?$/.exec(part);
    if (!m) return part;
    const [, c1, r1, c2, r2] = m;
    let s = +r1;
    let e = r2 ? +r2 : s;
    if (s > at) { s += k; e = Math.min(e + k, MAX_ROW); }
    else if (e >= at && e < MAX_ROW && (r2 || single === 'grow')) e += k;
    return !r2 && s === e ? `${c1}${s}` : `${c1}${s}:${c2 ?? c1}${e}`;
  }).join(' ');
}

/**
 * Fills `{Parameter}` placeholders in an .xlsx template.
 *
 * The workbook is edited at the XML level (like the Word engine), never rebuilt, so sheet names,
 * order, styles, merged cells, formulas, widths and everything else in the package are left as
 * uploaded. Only the text of string cells that contain a placeholder is rewritten. It knows nothing
 * about which parameters exist: the caller supplies the same resolver Word reports use.
 *
 * Rows that repeat per record (see RowSet) are cloned in place: the rows below move down, and merged ranges,
 * conditional formatting, validations, filters and the dimension follow. Text inside drawings, headers/footers
 * and comments is not scanned.
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
  async fill(xlsx: Buffer, resolve: (raw: string) => string | undefined, options?: { complianceStatus?: string | null; rowSets?: RowSet[] }): Promise<Buffer> {
    const zip = await this.load(xlsx);
    const look = statusLook(options?.complianceStatus);
    const make = (res: (raw: string) => string | undefined) => (s: string) =>
      s.replace(PLACEHOLDER_RE, (m, raw: string) => {
        const name = raw.trim();
        if (!name) return m;
        const v = STATUS_RE.test(name) ? look?.value ?? '' : res(name);
        return v === undefined ? m : v;
      });
    const subst = make(resolve);

    // Cells holding the status placeholder are found now, before their text is replaced.
    if (look) await this.colourStatusCells(zip, look.fill);

    // Repeating rows first, while the shared strings still hold the template's placeholders.
    if (options?.rowSets?.length) await this.expandRows(zip, options.rowSets, make, resolve);

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

  private cellText(c: Element, sharedTexts: string[]): string {
    const type = c.getAttribute('t');
    if (type === 's') return sharedTexts[parseInt(c.getElementsByTagNameNS(NS, 'v').item(0)?.textContent ?? '', 10)] ?? '';
    if (type === 'inlineStr') {
      const is = c.getElementsByTagNameNS(NS, 'is').item(0);
      return is ? this.textNodes(is).map((t) => t.textContent ?? '').join('') : '';
    }
    // A plain number (no t attribute) reads as its digits, so a leading "1" can be recognised as a running number.
    if (!type || type === 'n') return c.getElementsByTagNameNS(NS, 'v').item(0)?.textContent ?? '';
    return this.strValue(c)?.textContent ?? '';
  }

  /** Writes text into a (non-formula) cell as an inline string, so cloned rows' cells don't share one string. */
  private setCellText(c: Element, text: string): void {
    while (c.firstChild) c.removeChild(c.firstChild);
    c.setAttribute('t', 'inlineStr');
    const is = c.ownerDocument.createElementNS(NS, 'is');
    const t = c.ownerDocument.createElementNS(NS, 't');
    this.setText(t, text.slice(0, MAX_CELL_CHARS));
    is.appendChild(t);
    c.appendChild(is);
  }

  private setRowNumber(row: Element, n: number): void {
    row.setAttribute('r', String(n));
    for (const c of Array.from(row.getElementsByTagNameNS(NS, 'c'))) c.setAttribute('r', (c.getAttribute('r') ?? '').replace(/\d+$/, String(n)));
  }

  /** Clones each row claimed by a RowSet once per record, moving everything below it down. */
  private async expandRows(zip: any, rowSets: RowSet[], make: (res: (raw: string) => string | undefined) => (s: string) => string, resolve: (raw: string) => string | undefined): Promise<void> {
    const shared = await this.readShared(zip);
    const wbXml: string = await zip.file('xl/workbook.xml').async('text');
    const relsXml: string = (await zip.file('xl/_rels/workbook.xml.rels')?.async('text')) ?? '';
    const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const sheets = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
      const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(relsXml)?.[0].match(/Target="([^"]+)"/)?.[1] ?? '';
      return { name: /name="([^"]*)"/.exec(m[0])?.[1] ?? '', path: target.startsWith('/') ? target.slice(1) : 'xl/' + target };
    });
    const moves: { sheet: string; at: number; k: number }[] = [];

    for (const sheet of sheets) {
      const file = zip.file(sheet.path);
      if (!file) continue;
      const doc = this.parse(await file.async('text'));
      const claimed: { row: Element; set: RowSet; names: string[] }[] = [];
      for (const row of Array.from(doc.getElementsByTagNameNS(NS, 'row'))) {
        const names = Array.from(row.getElementsByTagNameNS(NS, 'c'))
          .flatMap((c) => [...this.cellText(c, shared.texts).matchAll(PLACEHOLDER_RE)].map((m) => m[1].trim()))
          .filter(Boolean);
        const set = names.length ? rowSets.find((rs) => rs.claims(names)) : undefined;
        if (set) claimed.push({ row, set, names });
      }
      if (!claimed.length) continue;

      // Bottom to top: rows above a shift keep the numbers they were read with.
      for (const { row, set, names } of claimed.reverse()) {
        const at = parseInt(row.getAttribute('r') ?? '', 10);
        const count = Math.max(set.rows.length, 1);
        const resolvers = set.rows.length ? set.rows : [(raw: string) => (names.includes(raw) ? '' : undefined)];
        if (count > 1) {
          this.shiftSheet(doc, at, count - 1);
          moves.push({ sheet: sheet.name, at, k: count - 1 });
        }
        const template = row.cloneNode(true) as Element;
        const rows: Element[] = [row];
        for (let i = 1; i < count; i++) {
          const clone = template.cloneNode(true) as Element;
          this.setRowNumber(clone, at + i);
          rows[i - 1].parentNode!.insertBefore(clone, rows[i - 1].nextSibling);
          rows.push(clone);
        }
        rows.forEach((target, i) => {
          const sub = make((raw) => resolvers[i](raw) ?? resolve(raw));
          Array.from(target.getElementsByTagNameNS(NS, 'c')).forEach((c, ci) => {
            if (c.getElementsByTagNameNS(NS, 'f').length) return;
            const text = this.cellText(c, shared.texts);
            if (/\{[^{}]+\}/.test(text)) this.setCellText(c, sub(text));
            else if (i > 0 && ci === 0 && text.trim() === '1') {
              // A literal "1" leading the row is a running number; each cloned row continues it.
              while (c.firstChild) c.removeChild(c.firstChild);
              c.removeAttribute('t');
              const v = c.ownerDocument.createElementNS(NS, 'v');
              v.textContent = String(i + 1);
              c.appendChild(v);
            }
          });
        });
        // A merge sitting on the template row is repeated on every clone.
        const merges = doc.getElementsByTagNameNS(NS, 'mergeCells').item(0);
        if (merges) {
          for (const m of Array.from(merges.getElementsByTagNameNS(NS, 'mergeCell'))) {
            const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m.getAttribute('ref') ?? '');
            if (!mm || +mm[2] !== at || +mm[4] !== at) continue;
            for (let i = 1; i < count; i++) {
              const add = m.cloneNode(true) as Element;
              add.setAttribute('ref', `${mm[1]}${at + i}:${mm[3]}${at + i}`);
              merges.appendChild(add);
            }
          }
          merges.setAttribute('count', String(merges.getElementsByTagNameNS(NS, 'mergeCell').length));
        }
      }
      zip.file(sheet.path, this.serialize(doc));
    }

    // Workbook-level references to the moved ranges (filter databases, print areas).
    let next = wbXml;
    for (const { sheet, at, k } of moves) {
      const esc = unescape(sheet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;');
      next = next.replace(new RegExp(`('?${esc}'?!)(\\$?[A-Z]{1,3}\\$?\\d+(?::\\$?[A-Z]{1,3}\\$?\\d+)?)`, 'g'), (_m, pre: string, ref: string) => pre + shiftRef(ref, at, k));
    }
    if (next !== wbXml) zip.file('xl/workbook.xml', next);
  }

  /** Makes room for k rows after row `at`: later rows move down and every range in the sheet follows. */
  private shiftSheet(doc: Document, at: number, k: number): void {
    for (const row of Array.from(doc.getElementsByTagNameNS(NS, 'row'))) {
      const r = parseInt(row.getAttribute('r') ?? '', 10);
      if (r > at) this.setRowNumber(row, r + k);
    }
    const ranges: [string, string, 'move' | 'grow'][] = [
      ['mergeCell', 'ref', 'move'], ['conditionalFormatting', 'sqref', 'grow'], ['dataValidation', 'sqref', 'grow'],
      ['hyperlink', 'ref', 'move'], ['dimension', 'ref', 'move'], ['autoFilter', 'ref', 'move'],
    ];
    for (const [tag, attr, mode] of ranges) {
      for (const el of Array.from(doc.getElementsByTagNameNS(NS, tag))) {
        const ref = el.getAttribute(attr);
        // A merge lying on the template row is repeated per clone (see expandRows), not stretched.
        if (ref && !(tag === 'mergeCell' && new RegExp(`^[A-Z]+${at}:[A-Z]+${at}$`).test(ref))) el.setAttribute(attr, shiftRef(ref, at, k, mode));
      }
    }
  }

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
