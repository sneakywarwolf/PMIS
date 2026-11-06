/**
 * Rule-based topic labels. They only describe what the publisher's own title/description says (plus the publisher's
 * remit for the research blogs); they make no claim about truth, severity or exploitation.
 */
export const CATEGORIES = ['ransomware', 'malware', 'breach', 'vulnerability', 'appsec', 'cloud', 'threat-intel', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const RULES: [Exclude<Category, 'other'>, RegExp][] = [
  ['ransomware', /ransom|lockbit|extortion gang/i],
  ['malware', /malware|trojan|botnet|backdoor|infostealer|info-stealer|stealer|spyware|rootkit|\bworm\b|\bloader\b|\bRAT\b|cryptominer/i],
  ['breach', /data breach|\bbreach(ed|es)?\b|data leak|leaked|stolen data|data theft|exposed (database|records|data)|compromised accounts/i],
  ['vulnerability', /cve-\d{4}-\d{4,}|vulnerab|zero[\s-]?day|\b0[\s-]?day\b|\bflaw\b|remote code execution|\bRCE\b|privilege escalation|security (update|patch)|\bpatch(es|ed)?\b/i],
  ['appsec', /\bxss\b|cross-site|sql injection|\bcsrf\b|\bssrf\b|web application|web app\b|api security|owasp|burp suite|deserializ|request smuggling|prototype pollution|web cache|\bidor\b/i],
  ['cloud', /\bcloud\b|\baws\b|\bazure\b|\bgcp\b|google cloud|kubernetes|\bs3 bucket|serverless|\bsaas\b|container(s|ized)?\b|cloudflare/i],
  ['threat-intel', /\bAPT\d*\b|threat actor|nation-state|state-sponsored|espionage|\bcampaign\b|threat intelligence|\bTTPs?\b|\bUNC\d+|\bTA\d{3}\b/i],
];

/** Source-level defaults for publishers whose entire output is in one area. */
const SOURCE_DEFAULTS: Record<string, Category> = { 'portswigger-blog': 'appsec', 'portswigger-research': 'appsec', 'cloudflare-blog': 'cloud' };

export function categorize(title: string, description: string, sourceSlug: string): Category[] {
  const text = `${title}\n${description}`;
  const out = new Set<Category>(RULES.filter(([, re]) => re.test(text)).map(([c]) => c));
  const def = SOURCE_DEFAULTS[sourceSlug];
  if (def) out.add(def);
  return out.size ? [...out] : ['other'];
}
