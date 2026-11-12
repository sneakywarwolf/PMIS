/**
 * `s.replace(/<[^>]+>/g, ...)` and similar tag patterns are quadratic when the text holds many `<` and no closing `>`: every `<`
 * scans to the end of the text before it fails (a 64 KB value of "<b <b <b ..." took 2.5 s and blocks the whole single-threaded
 * server; an uploaded Fortify file can hold thousands of them). A tag can only end at a `>`, so nothing after the last `>` can
 * match: run the pattern on the part up to it and keep the rest as is. Inside that part every `<` has a `>` after it, so each
 * attempt is bounded by the next `>` and the whole replacement is linear.
 */
export function replaceTags(text: string, tagPattern: RegExp, replacement: string | ((substring: string, ...args: any[]) => string)): string {
  const cut = text.lastIndexOf('>') + 1;
  if (cut === 0) return text;
  return text.slice(0, cut).replace(tagPattern, replacement as any) + text.slice(cut);
}

/** Removes trailing `.,:/-` characters without a backtracking regex (`/[.,:/-]+$/` is quadratic on long runs of them). */
export function trimTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && '.,:/-'.includes(text[end - 1])) end--;
  return text.slice(0, end);
}
