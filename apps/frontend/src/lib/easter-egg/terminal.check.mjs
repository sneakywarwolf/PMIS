// Run: node src/lib/easter-egg/terminal.check.mjs
import assert from 'node:assert/strict';
import { respond, pastePick, MAX_INPUT, PASTE_LINES } from './terminal.ts';

const ctx = { displayName: 'Jane Doe', role: 'TEAM_LEAD', uptimeSeconds: 90061 };
const cat = (s) => respond(s, ctx).category;

const cases = {
  credential: ['password=hunter2', 'Authorization: Bearer abc', 'my api_key is x', 'token'],
  xss: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', '<script>SELECT * FROM users</script>', '<svg/onload=x>'],
  sql: ["' OR 1=1 --", 'SELECT * FROM users', 'DROP TABLE users;', 'UNION SELECT null', "admin'--"],
  security: ['CVE-2021-44228', 'CWE-79', 'ssrf to metadata', 'rce', 'my payload'],
  shell: ['sudo rm -rf /', 'ls -la', 'cd /etc', 'cat /etc/hosts | grep root', 'echo hi > out.txt', 'powershell -enc AAA', '$(id)'],
  http: ['https://example.com', 'GET /api/users', 'POST /login', '404', 'Content-Type: text/html'],
  javascript: ['const x = 1', '() => 1', 'console.log(1)', 'async function f() {}', 'new Promise(r => r())'],
  html: ['<div>hi</div>', '<span>', '<a href="x">y</a>', '<html><body>', '<form>'],
  json: ['{"a": 1}', '[1, 2, 3]'],
  other: ['open sesame', '日本語のテキスト', '🔥🔥🔥', 'hello'],
};

for (const [expected, inputs] of Object.entries(cases)) {
  for (const input of inputs) assert.equal(cat(input), expected, `${JSON.stringify(input)} → ${cat(input)}, expected ${expected}`);
}

// Exact commands win over pattern categories and use trusted context only.
assert.deepEqual(respond('whoami', ctx).lines.slice(0, 2), ['Jane Doe', 'role: TEAM LEAD']);
assert.match(respond('UPTIME', ctx).lines[0], /1d 1h 1m/);
assert.match(respond('uptime', { ...ctx, uptimeSeconds: null }).lines[0], /classified/);
assert.deepEqual(respond('coffee', ctx).lines, ['Dependency missing: coffee']);
assert.deepEqual(respond('hack', ctx).lines, ['Nice try.']);
for (const c of ['help', 'status', 'scan']) assert.equal(cat(c), 'command');

// Empty/whitespace doesn't count; everything else does.
assert.equal(respond('   ', ctx).counts, false);
assert.equal(respond('x', ctx).counts, true);

// Credentials are never echoed back.
const cred = respond('password=hunter2', ctx);
assert.ok(!cred.echo.includes('hunter2') && /^█+$/.test(cred.echo));

// Input is capped (by code point, so surrogate pairs aren't split).
const big = respond('a'.repeat(10_000), ctx);
assert.equal(big.echo.length, MAX_INPUT);
assert.equal(Array.from(respond('😀'.repeat(300), ctx).echo).length, MAX_INPUT);

// Replies never contain the raw input (except the echo line itself).
const probe = '<b>zz_probe_zz</b>';
assert.ok(!respond(probe, ctx).lines.join('\n').includes('zz_probe_zz'));

// No immediate repeats.
let prev = null;
for (let i = 0; i < 200; i++) {
  const l = respond('open sesame', ctx).lines.join('\n');
  assert.notEqual(l, prev);
  prev = l;
}
prev = null;
for (let i = 0; i < 200; i++) {
  const p = pastePick();
  assert.ok(PASTE_LINES.includes(p.lines.join('\n')));
  assert.notEqual(p.lines.join('\n'), prev);
  prev = p.lines.join('\n');
}

// Fuzz: random junk never throws.
const alphabet = `<>'"\`;|&$(){}[]=-/\\*#%\u0000‮\ud800aZ09 日😀`;
for (let i = 0; i < 10_000; i++) {
  let s = '';
  for (let j = 0, n = Math.random() * 300; j < n; j++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  const r = respond(s, ctx);
  assert.ok(Array.isArray(r.lines) && r.lines.length > 0);
}

console.log('terminal.check: all passed');
