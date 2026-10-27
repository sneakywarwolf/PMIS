import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS } from './settings.defaults';

/**
 * Every setting must be read by something other than the Settings screen and its own validation. The check looks
 * for the key's name in the application source (backend and frontend) outside the files that only define, validate
 * or edit settings, so a setting that exists only to be displayed fails here.
 */
const SRC_ROOTS = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../../frontend/src')];
const NOT_CONSUMERS = [
  /settings\.defaults\.ts$/,
  /settings\.service\.ts$/,
  /settings[\\/]page\.tsx$/,
  /\.spec\.ts$/,
  /\.test\.ts$/,
];

function sources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') sources(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !NOT_CONSUMERS.some((r) => r.test(p))) out.push(p);
  }
  return out;
}

describe('settings wiring audit', () => {
  const files = SRC_ROOTS.flatMap((r) => sources(r)).map((p) => ({ p, text: fs.readFileSync(p, 'utf8') }));
  const cases: [string, string][] = [];
  for (const [category, values] of Object.entries(DEFAULT_SETTINGS as Record<string, Record<string, unknown>>)) {
    for (const key of Object.keys(values)) cases.push([category, key]);
  }

  it.each(cases)('%s.%s is consumed by application code', (category, key) => {
    const re = new RegExp(`\\b${key}\\b`);
    const users = files.filter((f) => re.test(f.text)).map((f) => path.relative(path.resolve(__dirname, '../../..'), f.p));
    expect(users).not.toEqual([]);
  });
});
