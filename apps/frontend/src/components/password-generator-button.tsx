'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, RefreshCw, Copy, Check } from 'lucide-react';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Rejection sampling avoids modulo bias — required for a genuinely uniform,
// cryptographically secure character choice (crypto.getRandomValues alone
// isn't enough if you then do byte % charset.length on the raw byte).
function randomIndex(max: number): number {
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let byte: number;
  do {
    crypto.getRandomValues(buf);
    byte = buf[0];
  } while (byte >= limit);
  return byte % max;
}

// Self-contained, client-side only: this never calls the backend, so a
// generated password never touches a request log, audit log, or database —
// it exists only in this component's local state until the popover closes.
// This is intentionally a completely separate code path from the backend's
// admin temp-password generator (users.service.ts) — no shared charset,
// randomness source, or format.
function generatePassword(length: number, complexity: number): string {
  const sets = [LOWER];
  if (complexity >= 1) sets.push(UPPER);
  if (complexity >= 2) sets.push(DIGITS);
  if (complexity >= 3) sets.push(SYMBOLS);
  const charset = sets.join('');

  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset[randomIndex(charset.length)];
  }
  return out;
}

const COMPLEXITY_LABELS = ['Lowercase only', '+ Uppercase', '+ Numbers', '+ Symbols'];

export function PasswordGeneratorButton() {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(16);
  const [complexity, setComplexity] = useState(3);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const regenerate = () => {
    setPassword(generatePassword(length, complexity));
    setCopied(false);
  };

  useEffect(() => {
    if (open) regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, length, complexity]);

  // Clear the password from memory as soon as the popover closes.
  useEffect(() => {
    if (!open) {
      setPassword('');
      setCopied(false);
    }
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      // Brief "Copied" confirmation, then fade the popover out — the
      // password has served its purpose and shouldn't linger on screen.
      setTimeout(() => setOpen(false), 700);
    } catch {
      // clipboard access denied — nothing to fall back to safely
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/20 rounded-lg transition-all text-sm"
      >
        <KeyRound className="w-4 h-4" />
        Password Generator
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 p-4 space-y-4"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-400">Length</label>
                  <span className="text-xs text-gray-300 font-mono">{length}</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-400">Complexity</label>
                  <span className="text-xs text-gray-300">{COMPLEXITY_LABELS[complexity]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  value={complexity}
                  onChange={(e) => setComplexity(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 font-mono text-sm text-emerald-400 break-all select-all">
                {password}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={regenerate}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
