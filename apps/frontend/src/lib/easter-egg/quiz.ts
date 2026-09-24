// Quiz Easter Eggs: canned text and pure helpers. Nothing here reads or affects scoring.

// Self-contained (no imports) so the node check script can load it directly.
const lastPicked = new Map<string, string>();
function pick(key: string, pool: string[]): string {
  const prev = lastPicked.get(key);
  const options = pool.length > 1 ? pool.filter((l) => l !== prev) : pool;
  const choice = options[Math.floor(Math.random() * options.length)];
  lastPicked.set(key, choice);
  return choice;
}

export const REVEAL_STEPS = [
  'Answer Window Closed',
  'Scanning Responses',
  'Verifying Answer',
  'Calculating Results',
  'Unlocking Explanation',
  'ACCESS GRANTED',
];
export const REVEAL_STEP_MS = 500; // 6 steps ≈ 3s

export const SUSPICIOUS_LINES = [
  'Why are you looking at me?',
  'This option feels suspicious.',
  'Nothing to see here. Probably.',
  'I have no comment at this time.',
  'Scanning you back, actually.',
  'Act natural. Act natural.',
  'I may or may not be a decoy.',
  'Stop hovering, it tickles.',
];

export const GLITCH_LINES = ['ANOMALY DETECTED', 'QUESTION KNOWS TOO MUCH', 'SIGNAL INTEGRITY: QUESTIONABLE', 'WHO IS WATCHING WHOM?', 'REALITY PATCH PENDING'];
export const GLITCH_CHANCE = 0.06;

export const ROASTS = [
  'Bold choice. Wrong, but bold.',
  'The decoy thanks you for your participation.',
  'Incorrect. The trap worked exactly as designed.',
  'Close enough to see the right answer from there.',
  'That answer had great confidence. Unfortunately, so did you.',
  'Not quite. Consider it a free penetration test of your assumptions.',
  'Wrong answer, right spirit. Tomorrow is another exploit.',
  'The quiz would like to thank you for testing its defences.',
  'Incorrect. Even seasoned testers get phished sometimes.',
  'That was a honeypot. You found it. Congratulations?',
  'Denied. But hey, now you know something new.',
  'Plot twist: that was the wrong door. Try another tomorrow.',
];

export const CORRECT_TIPS = [
  'Nailed it. Fun tip: sometimes the wrong answers are more entertaining.',
  'Correct. Keep that brain switched on.',
  'Sharp work. The wrong options are jealous.',
  'Correct answer unlocked. The traps were not today.',
  'You got it. Even the suspicious option approves.',
  "Correct. Fun fact: confidence works better when it's accurate.",
  'Well played. The wrong answers had no chance.',
  'Access Granted. Your security instincts are showing.',
  'Correct. Somewhere, a wrong answer just felt uncomfortable.',
  'Nice one. Today, the quiz blinked first.',
  'Correct. The vulnerability database salutes you.',
  'Perfect hit. The decoys remain disappointed.',
  'Correct. You successfully avoided the obvious trap.',
  'Clean solve. The terminal has nothing sarcastic to add.',
  'Correct. Suspicion paid off this time.',
  'Well spotted. Someone definitely expected you to miss that.',
  'Correct. Your pattern recognition is becoming inconveniently good.',
  "Nice. The decoy was hoping you'd panic-click it.",
  'Correct. No incident report necessary.',
  'You got it. The terminal is reluctantly impressed.',
  'Correct. One less vulnerability between you and bragging rights.',
  'Sharp. The wrong answer was starting to feel confident.',
  'Correct. Your keyboard may now bask in reflected glory.',
  'Access Granted. Please try not to become insufferable about it.',
  'Correct. The trap has been rendered statistically useless.',
  'Clean hit. The decoys are filing a complaint.',
  'Correct. Somewhere, an examiner just sighed.',
];

export const RARE_TIPS = [
  "Perfect. You're making the decoys look decorative.",
  'Correct again. This is becoming a little embarrassing for the quiz.',
  'ACCESS GRANTED // Repeated competence detected.',
  'Another correct answer. Security is beginning to suspect you.',
  'Correct. At this point, the traps may need better traps.',
  'Nailed it. The admin has stopped underestimating you.',
  "Correct. You've officially become inconvenient to deceive.",
  'Suspiciously competent operator detected.',
  'Perfect hit. The Easter eggs are beginning to regret their existence.',
];
export const RARE_TIP_CHANCE = 0.2;

export type QuizStats = { totalAnswered: number; accuracy: number; currentStreak: number };

// "Strong performance": a live streak of 3+, or 80%+ accuracy over at least 5 answers.
export function isStrong(s: QuizStats | null): boolean {
  return !!s && (s.currentStreak >= 3 || (s.totalAnswered >= 5 && s.accuracy >= 80));
}

export function correctTip(stats: QuizStats | null, rand = Math.random()): string {
  return isStrong(stats) && rand < RARE_TIP_CHANCE ? pick('quiz-rare', RARE_TIPS) : pick('quiz-tip', CORRECT_TIPS);
}

export const roast = () => pick('quiz-roast', ROASTS);
export const suspiciousLine = () => pick('quiz-sus', SUSPICIOUS_LINES);
export const glitchLine = () => pick('quiz-glitch', GLITCH_LINES);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// About 1 in 3 questions get a suspicious option. Picked from the question id only,
// so it never correlates with the correct answer (which the client doesn't know anyway).
export function suspiciousOption(questionId: string, optionCount: number): number | null {
  const h = hash(questionId);
  return optionCount > 0 && h % 3 === 0 ? (h >>> 8) % optionCount : null;
}
