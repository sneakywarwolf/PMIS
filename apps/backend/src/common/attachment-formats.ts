/**
 * Every file format PMIS accepts as an upload, per place it is accepted, with the size limit the Admin can set
 * (Settings > Attachments). The catalog is the single list: the settings defaults and validation, the Settings
 * screen and the upload checks are all built from it.
 *
 * `defaultMb` is the limit that applied before the setting existed, so nothing changes until an Admin changes it.
 * `maxMb` is the highest limit an Admin may set (uploads are held in memory, or read as a stream for scans).
 */
export interface AttachmentFormat {
  /** `<purpose>.<extension>`: the key of the setting. */
  key: string;
  purpose: string;
  extension: string;
  /** Other file names that count as this format (".jpeg" for "jpg"). */
  aliases?: string[];
  label: string;
  defaultMb: number;
  maxMb: number;
}

export interface AttachmentPurpose {
  id: string;
  label: string;
  description: string;
}

export const ATTACHMENT_PURPOSES: AttachmentPurpose[] = [
  { id: 'poc', label: 'PoC screenshots', description: 'Evidence images attached to a finding step.' },
  { id: 'template', label: 'Report templates', description: 'Word and Excel templates uploaded by an Admin.' },
  { id: 'vulnBulk', label: 'Vulnerability library bulk upload', description: 'Admin upload of many library entries.' },
  { id: 'userBulk', label: 'User bulk upload', description: 'Admin upload of many users.' },
  { id: 'nessus', label: 'Nessus scan import', description: 'Scan results for a Network project. The file is read while it uploads and is not stored.' },
  { id: 'nmap', label: 'Nmap port scan import', description: 'Port scan results for a Network project.' },
  { id: 'scope', label: 'Network scope import', description: 'List of in-scope addresses for a Network project.' },
  { id: 'siteMap', label: 'Site Map import', description: 'Directory and file list for an SCR project.' },
  { id: 'findingsImport', label: 'Project findings import', description: 'Findings added to one project from a spreadsheet.' },
];

const f = (purpose: string, extension: string, label: string, defaultMb: number, maxMb: number, aliases?: string[]): AttachmentFormat => ({
  key: `${purpose}.${extension}`, purpose, extension, label, defaultMb, maxMb, ...(aliases && { aliases }),
});

export const ATTACHMENT_FORMATS: AttachmentFormat[] = [
  f('poc', 'png', 'PNG image', 25, 100),
  f('poc', 'jpg', 'JPEG image (.jpg, .jpeg)', 25, 100, ['jpeg']),
  f('poc', 'gif', 'GIF image', 25, 100),
  f('poc', 'webp', 'WebP image', 25, 100),
  f('template', 'docx', 'Word template (.docx)', 25, 100),
  f('template', 'xlsx', 'Excel template (.xlsx)', 25, 100),
  f('vulnBulk', 'csv', 'CSV file', 10, 100),
  f('vulnBulk', 'xlsx', 'Excel workbook (.xlsx)', 10, 100),
  f('userBulk', 'csv', 'CSV file', 10, 100),
  f('userBulk', 'xlsx', 'Excel workbook (.xlsx)', 10, 100),
  f('nessus', 'nessus', 'Nessus export (.nessus)', 500, 500),
  f('nessus', 'csv', 'Nessus CSV export', 500, 500),
  f('nmap', 'xml', 'Nmap XML (.xml)', 25, 100),
  f('nmap', 'txt', 'Nmap text output (.txt)', 25, 100),
  f('nmap', 'nmap', 'Nmap output (.nmap)', 25, 100),
  f('scope', 'txt', 'Text list (.txt)', 25, 100),
  f('scope', 'csv', 'CSV file', 25, 100),
  f('scope', 'xlsx', 'Excel workbook (.xlsx)', 25, 100),
  f('siteMap', 'csv', 'CSV file', 25, 100),
  f('siteMap', 'xlsx', 'Excel workbook (.xlsx)', 25, 100),
  f('findingsImport', 'csv', 'CSV file', 100, 100),
  f('findingsImport', 'xlsx', 'Excel workbook (.xlsx)', 100, 100),
];

export const ATTACHMENT_FORMAT_BY_KEY = new Map(ATTACHMENT_FORMATS.map((x) => [x.key, x]));

export const DEFAULT_ATTACHMENT_SIZES_MB: Record<string, number> = Object.fromEntries(ATTACHMENT_FORMATS.map((x) => [x.key, x.defaultMb]));

const MB = 1024 * 1024;

/**
 * The limits currently in force. Plain module state, set by SettingsService when settings load and when an Admin
 * saves them, so upload code anywhere can read them without injecting a service. Until it is set the defaults apply.
 * ponytail: per process; another instance picks a change up on its next settings load.
 */
let sizesMb: Record<string, number> = { ...DEFAULT_ATTACHMENT_SIZES_MB };

export const attachmentLimits = {
  set(next: Record<string, unknown> | undefined) {
    const merged = { ...DEFAULT_ATTACHMENT_SIZES_MB };
    for (const [key, v] of Object.entries(next ?? {})) {
      if (ATTACHMENT_FORMAT_BY_KEY.has(key) && typeof v === 'number' && v >= 1) merged[key] = v;
    }
    sizesMb = merged;
  },

  /** Limit in bytes for one file of this purpose, by its name. An unrecognised extension gets the purpose's largest limit. */
  maxBytes(purpose: string, fileName?: string): number {
    const ext = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    const format = ext
      ? ATTACHMENT_FORMATS.find((x) => x.purpose === purpose && (x.extension === ext || x.aliases?.includes(ext)))
      : undefined;
    return (format ? sizesMb[format.key] : attachmentLimits.largestBytes(purpose) / MB) * MB;
  },

  /** The largest limit among a purpose's formats: what a request for it may carry at most. */
  largestBytes(purpose: string): number {
    const mb = ATTACHMENT_FORMATS.filter((x) => x.purpose === purpose).map((x) => sizesMb[x.key]);
    return Math.max(...mb, 1) * MB;
  },
};

/** Message for a file over its limit. */
export const tooLargeMessage = (fileName: string | undefined, bytes: number) => {
  const ext = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return `This file is larger than ${Math.round((bytes / MB) * 100) / 100} MB, the limit set for ${ext ? `.${ext} ` : ''}files.`;
};
