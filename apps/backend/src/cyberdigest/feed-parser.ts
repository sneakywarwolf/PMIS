import { DOMParser } from '@xmldom/xmldom';

/**
 * RSS 2.0 / Atom parser. Feed content is untrusted: DOCTYPE/ENTITY declarations are refused (no entity tricks), markup
 * is reduced to plain text here and never rendered as HTML later, and nothing is guessed - an unparseable or missing
 * date stays null.
 */
export class FeedParseError extends Error {}

export interface FeedItem {
  externalId: string;
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  /** Plain text taken from the feed's own description/summary. Never generated. */
  description: string;
}

const MAX_ITEMS = 200;

export function htmlToText(input: string): string {
  return input
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ') // entities may have decoded into tags; strip again, text only
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t) : null;
}

function child(el: Element, ...names: string[]): Element | null {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && names.includes((n as Element).nodeName)) return n as Element;
  }
  return null;
}

function text(el: Element, ...names: string[]): string {
  const c = child(el, ...names);
  return c ? (c.textContent || '').trim() : '';
}

export function parseFeed(xml: string): FeedItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FeedParseError('Feed contains a DOCTYPE/ENTITY declaration');
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: (m: string) => errors.push(m), fatalError: (m: string) => errors.push(m) } }).parseFromString(xml, 'text/xml');
  const root = doc?.documentElement;
  if (!root || errors.length) throw new FeedParseError('Malformed XML');

  const isAtom = root.nodeName === 'feed';
  const isRss = root.nodeName === 'rss' || root.nodeName === 'rdf:RDF';
  if (!isAtom && !isRss) throw new FeedParseError('Not an RSS or Atom feed');

  const nodes = Array.from(root.getElementsByTagName(isAtom ? 'entry' : 'item')).slice(0, MAX_ITEMS);
  const items: FeedItem[] = [];
  for (const el of nodes) {
    let url = '';
    if (isAtom) {
      const links = Array.from(el.getElementsByTagName('link'));
      const alt = links.find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate') ?? links[0];
      url = alt?.getAttribute('href') ?? '';
    } else {
      url = text(el, 'link');
    }
    const title = htmlToText(text(el, 'title'));
    if (!url || !title) continue; // an item without a link or title cannot be attributed
    const externalId = text(el, 'guid', 'id') || url;
    const authorEl = child(el, 'author', 'dc:creator');
    const author = authorEl ? htmlToText((child(authorEl, 'name')?.textContent || authorEl.textContent || '')) || null : null;
    items.push({
      externalId,
      url,
      title,
      author,
      publishedAt: parseDate(text(el, 'pubDate', 'published', 'dc:date')),
      updatedAt: parseDate(text(el, 'updated')),
      description: htmlToText(text(el, 'description', 'summary', 'content:encoded', 'content')),
    });
  }
  return items;
}
