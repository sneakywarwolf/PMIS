/**
 * Starts a browser download for a URL or blob without navigating away.
 * Report URLs are presigned with Content-Disposition: attachment (filename
 * included), so cross-origin the header — not the `download` attribute —
 * is what forces the save.
 */
export function triggerDownload(href: string, fileName?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  URL.revokeObjectURL(url);
}
