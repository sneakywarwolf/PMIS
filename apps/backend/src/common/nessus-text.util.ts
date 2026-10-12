/**
 * Report-time cleanup for text that came from a Nessus scan (a VA finding's Description and plugin output).
 * The stored data is never changed; only what is printed in the Word report is tidied.
 *
 * Fixes: runs of spaces/tabs, trailing spaces, odd indentation, runs of blank lines, and the hard line
 * wrapping Nessus applies to prose. Keeps: paragraph breaks (blank lines), bullet/numbered lines, every
 * character of the content (punctuation, CVE IDs, numbers) and the order of the text.
 *
 * ponytail: unwrapping is deliberately conservative: a line is joined to the previous one only when the
 * previous line is long, does not end a sentence, and the next line continues in lower case. Anything
 * uncertain keeps its own line, because wrongly joining command output costs more than a stray break.
 */

/** Marks a line break inside a single report value; the Word writer turns it into a real <w:br/>. */
export const LINE_SEP = ' ';

const LIST_MARKER = /^(?:[-*•–]|\d{1,3}[.)]|[a-z][.)]|\(\d{1,3}\))\s+/;
const MIN_WRAPPED_LINE = 50;

export function cleanNessusText(input: string | null | undefined): string {
  if (!input) return '';
  const raw = input.replace(/\r\n?/g, '\n').split('\n');

  type Line = { text: string; list: boolean; indent: number };
  const lines: Line[] = raw.map((l) => {
    const noTabs = l.replace(/\t/g, ' ').replace(/ /g, ' ');
    const body = noTabs.trim().replace(/ {2,}/g, ' ');
    const list = LIST_MARKER.test(body);
    const lead = noTabs.length - noTabs.trimStart().length;
    // List items keep a light indent so nesting stays readable; everything else loses its indentation.
    const indent = list ? (lead === 0 ? 0 : lead < 4 ? 2 : 4) : 0;
    return { text: body, list, indent };
  });

  const out: string[] = [];
  let prev: Line | null = null; // last non-blank physical line
  let blankPending = false;
  for (const line of lines) {
    if (!line.text) {
      blankPending = out.length > 0;
      prev = null;
      continue;
    }
    if (blankPending) {
      out.push('');
      blankPending = false;
    }
    const continues =
      prev !== null &&
      !line.list &&
      prev.text.length >= MIN_WRAPPED_LINE &&
      !/[.:;!?]$/.test(prev.text) &&
      /^[a-z(]/.test(line.text);
    if (continues) {
      out[out.length - 1] += ' ' + line.text;
      prev = { ...line, text: out[out.length - 1].trim() };
    } else {
      out.push(' '.repeat(line.indent) + line.text);
      prev = line;
    }
  }
  return out.join('\n');
}

/** Cleaned text with its line breaks marked for the Word writer; '' stays '' (never invented). */
export function nessusTextForReport(input: string | null | undefined): string {
  return cleanNessusText(input).replace(/\n/g, LINE_SEP);
}
