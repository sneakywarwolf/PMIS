// Easter-egg terminal engine. Input is only ever regex-tested, never executed,
// stored, sent, or rendered as markup. Replies are canned; only whoami/uptime
// interpolate values, and those come from trusted context, never from input.

export const MAX_INPUT = 256;

export type TerminalCtx = { displayName: string; role: string; uptimeSeconds: number | null };
export type TerminalReply = { category: string; echo: string; lines: string[]; counts: boolean };

type Category = {
  id: string;
  tests: RegExp[];
  lines: string[];
  specific?: [RegExp, string][];
  rare?: string[];
};

const B = '████';

const CATEGORIES: Category[] = [
  {
    id: 'credential',
    tests: [/\b(passw(or)?d|passwd|credentials?|tokens?|secrets?|api[_-]?key|apikey|authorization|bearer|private[_-]?key)\b/i],
    lines: [
      'Credential-shaped text detected. Blur deployed.',
      "Nice secret. Let's pretend we didn't see that.",
      'Credential exposure detected. Redaction protocol engaged.',
      "That looks sensitive. Congratulations, you've triggered the terminal's trust issues.",
    ],
    specific: [
      [/passw(or)?d|passwd/i, 'Password detected. The terminal politely looked away.'],
      [/token/i, 'Token detected. █████████████████'],
      [/secret/i, 'Secret detected. The secret is now slightly less secret.'],
    ],
    rare: [`${B} CREDENTIAL EXPOSURE EVENT ${B}\nRedaction complete.\nNothing was stored. Nothing was seen.`],
  },
  {
    id: 'xss',
    tests: [/<\s*\/?\s*script/i, /javascript\s*:/i, /\bon[a-z]+\s*=/i, /\balert\s*\(/i, /document\s*\.\s*(cookie|write)/i, /<\s*(svg|iframe)\b/i],
    lines: [
      'SCRIPT DETECTED. The script has been politely escorted out.',
      'XSS-shaped input detected. It remains a harmless string of characters.',
      'Event handler detected. Nothing here is listening.',
      'javascript: URI detected. The browser declined the invitation.',
    ],
    rare: [`${B} XSS SIGNATURE DETECTED ${B}\nPattern isolated.\nPayload contained.\nBrowser remains emotionally unavailable.`],
  },
  {
    id: 'sql',
    tests: [
      /\b(select|insert\s+into|delete\s+from|drop\s+(table|database)|union(\s+all)?\s+select|where|from|join)\b/i,
      /\bupdate\s+\w+\s+set\b/i,
      /\bor\s+'?1'?\s*=\s*'?1/i,
      /(--|#)\s*$|\/\*/,
    ],
    lines: [
      'SQL detected. The database would like you to stop touching things.',
      'SQLi-shaped input detected. The database locked the door.',
      'Nice query. The tables have chosen silence.',
    ],
    specific: [
      [/\bselect\b/i, 'SELECT detected. Unfortunately, the answer is no.'],
      [/\bdrop\b/i, 'DROP detected. Nothing dropped. Except your confidence.'],
      [/\bunion\b/i, 'UNION detected. The tables are forming a committee.'],
      [/\bwhere\b/i, 'WHERE clause detected. Excellent question. Wrong terminal.'],
    ],
    rare: [`${B} DATABASE SECURITY EVENT ${B}\nQuery pattern isolated.\nTables secured.\nYour JOIN request has been denied on philosophical grounds.`],
  },
  {
    id: 'security',
    tests: [/\b(cve-\d*|cwe-\d*|cvss|rce|ssrf|csrf|xxe|idor|lfi|rfi|ssti|jwt|oauth|sandbox|exploits?|payloads?)\b/i],
    lines: [
      'Security terminology detected. Someone came prepared.',
      'Exploit vocabulary detected. Curiosity level: respectable.',
    ],
    specific: [
      [/\bcve-/i, 'CVE-shaped input detected. The scanner has opinions.'],
      [/\brce\b/i, 'RCE mentioned. Remote execution remains strictly hypothetical.'],
      [/\bssrf\b/i, 'SSRF detected. The server would prefer you stop asking where it lives.'],
      [/\bcsrf\b/i, 'CSRF detected. Cross-site nonsense acknowledged.'],
      [/\bidor\b/i, 'IDOR detected. Authorization has entered the chat.'],
      [/\bpayloads?\b/i, 'Payload detected. Delivery mechanism: suspicious.'],
      [/\bcwe-/i, 'CWE detected. The weakness has been catalogued and is now judging you.'],
    ],
    rare: [`${B} SECURITY EVENT DETECTED ${B}\nPattern recognized.\nThreat assessment: unnecessarily dramatic.\nNo actual exploitation performed.`],
  },
  {
    id: 'shell',
    tests: [
      /(^|[\s;&|])(cmd|powershell|pwsh|bash|zsh|sh|sudo|su|curl|wget|ls|dir|cd|pwd|grep|chmod|chown|rm|mv|cp|cat|echo|nc|ssh|ping)(\s|$)/i,
      /\s\|\s*\w|&&|\$\(|`[^`]*`/,
      /(^|\s)>{1,2}\s*[\w./~]/,
    ],
    lines: [
      'Shell detected. Pretending to be a real terminal now.',
      "Executing simulated command... because that's all you're getting.",
      'Command accepted by the Department of Make-Believe.',
    ],
    specific: [
      [/\bsudo\b/i, 'sudo detected. Unfortunately, confidence is not privilege.'],
      [/(^|\s)ls(\s|$)/i, "ls detected. Listing things that aren't actually here."],
      [/(^|\s)cd(\s|$)/i, 'cd detected. Destination: nowhere.'],
      [/(^|\s)rm(\s|$)/i, 'rm detected. Relax. Nothing was deleted.'],
      [/\bchmod\b/i, 'chmod detected. Permissions remain emotionally unchanged.'],
      [/\bgrep\b/i, 'grep detected. Searching for absolutely nothing useful.'],
      [/\bcurl\b/i, 'curl detected. Network privileges: imaginary.'],
    ],
  },
  {
    id: 'http',
    tests: [
      /https?:\/\//i,
      /\b(GET|POST|PUT|PATCH|HEAD|DELETE|OPTIONS)\b/,
      /\b(200|201|301|302|400|401|403|404|418|500|502|503)\b/,
      /\b(content-type|user-agent|host|cookie|accept)\s*:/i,
      /\bwww\.\S+|\b[\w-]+\.(com|org|net|io|in|dev)\b/i,
    ],
    lines: [
      'HTTP request detected. The server has been notified of your audacity.',
      'Request simulated. The network remains blissfully untouched.',
    ],
    specific: [
      [/\bGET\b/, 'GET detected. Unfortunately, nothing is being given.'],
      [/\bPOST\b/, 'POST detected. Payload received. Ego retained.'],
      [/\b404\b/, "404 detected. Even the command couldn't find itself."],
      [/\b200\b/, '200 OK. Emotionally? Debatable.'],
      [/\b503\b/, '503 Service Unavailable. Same, honestly.'],
      [/https:\/\//i, 'HTTPS detected. At least somebody is pretending to be responsible.'],
    ],
  },
  {
    id: 'javascript',
    tests: [/\b(function|const|let|var|async|await|promise|console\s*\.\s*log|require\s*\()/i, /=>/],
    lines: [
      'JavaScript detected. Somewhere, a semicolon is missing.',
      'JS detected. The terminal has prepared for unexpected behavior.',
      'JavaScript accepted. Runtime not included.',
    ],
    specific: [
      [/=>/, "Arrow function detected. The terminal has no idea where you're going either."],
      [/console\s*\.\s*log/i, 'console.log detected. Thank you for narrating your debugging session.'],
      [/\basync\b/i, 'Async detected. Excellent. Now nobody knows when anything will finish.'],
      [/\bpromise\b/i, 'Promise detected. Bold of you to trust one.'],
    ],
  },
  {
    id: 'html',
    tests: [/<\s*\/?\s*[a-z][a-z0-9-]*(\s[^>]*)?\/?\s*>/i],
    lines: [
      "HTML detected. The terminal suddenly remembered it's not a browser.",
      'Markup identified. The sanitization department has been notified.',
      "Nice tags. Unfortunately, they're not getting rendered here.",
      'Your <div> has been respectfully div-erted.',
      'Markup accepted. Rendering privileges: absolutely not.',
    ],
  },
  {
    id: 'json',
    tests: [/^\s*[[{][\s\S]*[\]}]\s*$/, /"[^"]*"\s*:/],
    lines: [
      'JSON detected. Valid-looking. Suspiciously valid-looking.',
      'Key/value pairs detected. The terminal values neither.',
      'JSON-like input detected. Parsing declined on principle.',
    ],
    rare: [`${B} JSON INTEGRITY CHECK ${B}\nCommas: questionable.\nConfidence: misplaced.`],
  },
];

const OTHER = [
  'Command not recognized. The terminal remains unimpressed.',
  "Unknown input. Filed under 'nice try'.",
  'Access still denied. Consistency is our brand.',
  'Processing... Result: no.',
  'Interesting. Wrong, but interesting.',
  "Try 'help'. Or don't. Both lead here.",
];

export const PASTE_LINES = [
  'Paste detected. Nice try, keyboard warrior.',
  'Whoa there. We type our problems around here.',
  'Paste request: DECLINED.\nReason: suspiciously convenient.',
  'Nice shortcut. Unfortunately, shortcuts are on vacation.',
  'You brought a payload. Sneakywarwolf brought a sense of humor.',
  'Paste blocked. oyiiiii',
  'Your fingers still work, right?',
  'The clipboard tried to enter. Sneakywarwolf said no.',
  'Automated input detected.\nSuspicion: elevated.',
  'Manual entry required. Your keyboard misses you.',
  'That was almost clever. Almost.',
  'Paste denied. Please discover the ancient art of typing.',
  'The clipboard is not on the guest list.',
  'Pretty close, yet soo far.',
  "You really thought Sneakywarwolf'd allow that?",
  'Paste detected.\nCreativity level: questionable.',
  'Command delivery rejected: suspiciously efficient.',
  'Clipboard intrusion prevented.\nEgo damage: minimal.',
  'Nice attempt. The terminal wants to hear you type it.',
  'Your clipboard has been politely escorted outside.',
  "Input injection? Relax. We're just having fun.",
  'Your clipboard has been placed under observation.',
  'Naughty!! Naughty!!',
  "Even the clipboard couldn't bypass this door.",
  'Clipboard privileges revoked. Temporarily.',
  'Efficiency detected. Naturally, we had to stop it.',
  'The terminal has standards. Apparently, typing is one of them.',
  'Clipboard detected. Deploying unnecessary levels of suspicion.',
  'The shortcut was short. The disappointment was not.',
  'Your clipboard knocked. Nobody answered.',
  'Automatic input? How delightfully suspicious.',
  'Paste blocked. The terminal would like to see some effort.',
  'Clipboard detected. Initiating HR.',
  'The clipboard is innocent until proven useful.',
  'Paste intercepted. The Admin just giggled.',
  'Paste denied. The egg demands effort.',
  'Shortcut denied. Your fingers have been reassigned to typing.',
  'Clipboard rejected. Please return to your regularly scheduled keyboard abuse.',
  `${B} PASTE PROTOCOL DETECTED ${B}\nInitiating anti-laziness sequence...\nSequence complete.\nType it yourself.`,
  `${B} PASTE PROTOCOL DETECTED ${B}\nClipboard access terminated.\nReason: unacceptable levels of convenience.`,
  `${B} PASTE PROTOCOL DETECTED ${B}\nOperator deemed insufficiently committed to typing.`,
  'CTRL+V INCIDENT #001\nRecommendation: touch keyboard manually.\nFurther incidents may result in increased disappointment.',
  'CTRL+V INCIDENT #002\nThe previous warning was apparently decorative.',
  'CTRL+V INCIDENT\nAttempted shortcut detected.\nPMIS Security has revoked your right to be impressed with yourself.',
  'Clipboard integrity check:\nResult → suspiciously convenient.\nDisposition → rejected.',
  'Clipboard integrity check:\nResult → technically functional.\nResult → spiritually unacceptable.',
  'SECURITY ALERT\nUser attempted to outsource typing.\nRequest denied.',
  'INPUT SECURITY EVENT\nAutomated text insertion detected.\nThreat level → lazy.',
  'INPUT SECURITY EVENT\nClipboard payload intercepted.\nThe keyboard has been informed.',
  'OPERATION: TYPE IT YOURSELF\nStatus → ACTIVE\nEscape route → none',
  'MANUAL ENTRY ENFORCEMENT\nYour clipboard has been denied.\nYour keyboard has been promoted.',
  'CLIPBOARD BREACH PREVENTED\nNo commands were harmed.\nOne shortcut was.',
  'KEYBOARD AUTHENTICATION REQUIRED\nClipboard credentials rejected.\nReason → you know exactly what you did.',
  'PASTE ATTEMPT LOGGED\nEvidence collected.\nDignity: pending.',
  'AUTOMATION DETECTED\nHuman verification required.\nPlease demonstrate basic keyboard operation.',
  'CLIPBOARD ACCESS DENIED\nThe terminal believes you can do better.\nIt is correct.',
  'PASTE REQUEST DENIED\nConvenience is not an authorization mechanism.',
  'SHORTCUT INTERCEPTED\nNice try. Wrong input method.',
  `${B} MANUAL INPUT ENFORCEMENT ${B}\nPaste detected.\nPaste rejected.`,
  'PMIS SECURITY NOTICE\nPaste blocked.',
  'CTRL+V\nClipboard status: QUARANTINED',
  `SECURITY EVENT #${B}\nUser attempted Ctrl+V.\nThe terminal remembers.`,
  'MANUAL ENTRY REQUIRED\nThis is not a bug.\nThis is a character-building exercise.',
  'CLIPBOARD REJECTED\nThe keyboard would like a word with you.',
  `${B} INPUT CHANNEL LOCKED ${B}\nReason: suspiciously efficient behavior.\nUnlock condition: type.\nYes, this message is intentionally longer than the typing you were trying to avoid.`,
];

export const PASTE_EFFECTS = ['shake', 'flee', 'sweep', 'ctrlv', 'lock', 'matrix', 'blink', 'dissolve', 'ripple'] as const;
export type PasteEffect = (typeof PASTE_EFFECTS)[number];

export const BOOT_LINES = ['Searching route...', 'Route not found...', 'Abort mission?'];

const HELP = [
  'Hidden commands (you did not get these from us):',
  '  whoami   uptime   status   scan   coffee   hack   help',
];

const RARE_CHANCE = 0.05;
const lastPicked = new Map<string, string>();

function pick(key: string, pool: string[]): string {
  const prev = lastPicked.get(key);
  const options = pool.length > 1 ? pool.filter((l) => l !== prev) : pool;
  const choice = options[Math.floor(Math.random() * options.length)];
  lastPicked.set(key, choice);
  return choice;
}

function formatUptime(s: number | null): string {
  if (s == null) return 'PMIS uptime: classified (the server is shy).';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `PMIS uptime: ${d}d ${h}h ${m}m. Still not letting you in.`;
}

function command(name: string, ctx: TerminalCtx): string[] | null {
  switch (name) {
    case 'whoami':
      return [ctx.displayName, `role: ${ctx.role.replace(/_/g, ' ')}`, 'clearance: insufficient'];
    case 'uptime':
      return [formatUptime(ctx.uptimeSeconds)];
    case 'coffee':
      return ['Dependency missing: coffee'];
    case 'hack':
      return ['Nice try.'];
    case 'help':
      return HELP;
    case 'status':
      return [
        'PMIS STATUS',
        '  Core services ......... ONLINE',
        '  Access control ........ ENFORCED',
        '  Your clearance ........ INSUFFICIENT',
        '  Bypass probability .... 0.00%',
      ];
    case 'scan':
      return [
        'Scanning perimeter...',
        '  Open doors ............ 0',
        '  Vulnerabilities found . 1 (optimism)',
        'Scan complete. Nothing exploitable.',
      ];
    default:
      return null;
  }
}

const cap = (raw: string) => Array.from(raw).slice(0, MAX_INPUT).join('').trim();
const redact = (input: string) => '█'.repeat(Math.min(Array.from(input).length, 24));

// What may be shown (and mirrored to a live admin) for this input: credentials are never echoed.
export function echoFor(raw: string): string {
  const input = cap(raw);
  return CATEGORIES[0].tests.some((re) => re.test(input)) ? redact(input) : input;
}

export function respond(raw: string, ctx: TerminalCtx): TerminalReply {
  const input = cap(raw);
  if (!input) return { category: 'empty', echo: '', lines: ['Silence detected. Bold strategy.'], counts: false };

  const cmd = command(input.toLowerCase(), ctx);
  if (cmd) return { category: 'command', echo: input, lines: cmd, counts: true };

  const cat = CATEGORIES.find((c) => c.tests.some((re) => re.test(input)));
  if (!cat) return { category: 'other', echo: input, lines: pick('other', OTHER).split('\n'), counts: true };

  const echo = cat.id === 'credential' ? redact(input) : input;
  const line =
    cat.rare && Math.random() < RARE_CHANCE
      ? pick(`${cat.id}:rare`, cat.rare)
      : pick(cat.id, [...cat.lines, ...(cat.specific ?? []).filter(([re]) => re.test(input)).map(([, l]) => l)]);
  return { category: cat.id, echo, lines: line.split('\n'), counts: true };
}

export function pastePick(): { lines: string[]; effect: PasteEffect } {
  const effect = PASTE_EFFECTS[Math.floor(Math.random() * PASTE_EFFECTS.length)];
  return { lines: pick('paste', PASTE_LINES).split('\n'), effect };
}
