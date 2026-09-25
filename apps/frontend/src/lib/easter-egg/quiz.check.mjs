// Run: node src/lib/easter-egg/quiz.check.mjs
import assert from 'node:assert/strict';
import { correctTip, isStrong, suspiciousOption, roast, CORRECT_TIPS, RARE_TIPS, ROASTS } from './quiz.ts';

const weak = { totalAnswered: 2, accuracy: 50, currentStreak: 0 };
const streaky = { totalAnswered: 3, accuracy: 100, currentStreak: 3 };
const accurate = { totalAnswered: 5, accuracy: 80, currentStreak: 0 };

assert.equal(isStrong(null), false);
assert.equal(isStrong(weak), false);
assert.equal(isStrong(streaky), true);
assert.equal(isStrong(accurate), true);
assert.equal(isStrong({ totalAnswered: 4, accuracy: 100, currentStreak: 2 }), false);

// Rare tips only for strong users, only under the chance threshold.
assert.ok(RARE_TIPS.includes(correctTip(streaky, 0.05)));
assert.ok(CORRECT_TIPS.includes(correctTip(streaky, 0.5)));
for (let i = 0; i < 200; i++) assert.ok(CORRECT_TIPS.includes(correctTip(weak, 0)));
for (let i = 0; i < 200; i++) assert.ok(CORRECT_TIPS.includes(correctTip(null, 0)));

// No immediate repeats.
let prev = null;
for (let i = 0; i < 200; i++) {
  const r = roast();
  assert.ok(ROASTS.includes(r));
  assert.notEqual(r, prev);
  prev = r;
}

// Suspicious option: deterministic, in range, roughly a third of questions.
let hits = 0;
for (let i = 0; i < 3000; i++) {
  const id = `q-${i}-${i * 7919}`;
  const o = suspiciousOption(id, 4);
  assert.equal(o, suspiciousOption(id, 4));
  if (o !== null) {
    hits++;
    assert.ok(o >= 0 && o < 4);
  }
}
assert.ok(hits > 800 && hits < 1200, `hits=${hits}`);
assert.equal(suspiciousOption('x', 0), null);

console.log('quiz.check: all passed');
