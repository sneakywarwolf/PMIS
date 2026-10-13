import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';

const MAX_ENTRIES = 2000;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const DANGEROUS_ENTRY = /(^|\/)(vbaProject\.bin|vbaData\.xml)$|(^|\/)activeX\/|\.(exe|dll|bat|cmd|com|scr|js|vbs|ps1|msi|jar)$/i;
const XML_PART = /\.(xml|rels)$/i;

/**
 * Rejects a .docx that is not a plain data package before it is stored or parsed: wrong magic, zip bombs,
 * macros/ActiveX/executables, macro content types, DTD/entity declarations, and external template/OLE links
 * (remote template injection). Ordinary external hyperlinks are allowed; nothing is ever fetched.
 */
export async function assertSafeDocx(buffer: Buffer): Promise<void> {
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0x504b0304) {
    throw new BadRequestException('File is not a valid .docx package.');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BadRequestException('File is not a valid .docx package.');
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new BadRequestException('Template package has too many entries.');
  if (!zip.files['[Content_Types].xml'] || !zip.files['word/document.xml']) {
    throw new BadRequestException('File is not a valid .docx package.');
  }
  let total = 0;
  for (const n of names) {
    if (n.includes('..') || n.startsWith('/') || n.includes('\\')) throw new BadRequestException('Template package contains unsafe paths.');
    if (DANGEROUS_ENTRY.test(n)) throw new BadRequestException('Templates must not contain macros, ActiveX or executable content.');
    total += (zip.files[n] as any)._data?.uncompressedSize ?? 0;
  }
  if (total > MAX_UNCOMPRESSED_BYTES) throw new BadRequestException('Template package is too large when decompressed.');

  const contentTypes = await zip.files['[Content_Types].xml'].async('string');
  if (/macroEnabled|vbaProject/i.test(contentTypes)) throw new BadRequestException('Macro-enabled documents are not allowed.');

  for (const n of names) {
    if (!XML_PART.test(n) || zip.files[n].dir) continue;
    const xml = await zip.files[n].async('string');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestException('Template contains DTD/entity declarations.');
    if (n.endsWith('.rels')) {
      for (const rel of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
        // Word writes a local file:/// attachedTemplate into most documents (present in the shipped templates), so only
        // remote targets (http/https/ftp/UNC) are refused: those make Word fetch content or leak NTLM when opened.
        const remote = /Target="(?:https?:|ftps?:|\\\\|\/\/|file:\/\/[^\/"])/i.test(rel);
        if (/TargetMode="External"/i.test(rel) && /\/(attachedTemplate|oleObject|package|frame|externalLink)"/i.test(rel) && remote) {
          throw new BadRequestException('Templates must not reference external templates or OLE objects.');
        }
      }
    }
  }
}

/** Storage-safe filename: no path separators or odd characters, bounded length. */
export function safeFileName(name: string): string {
  const base = (name || 'file').split(/[\\/]/).pop() as string;
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';
}
