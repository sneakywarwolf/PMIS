'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { ClipboardX, Lock } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { BOOT_LINES, MAX_INPUT, PasteEffect, pastePick, respond } from '@/lib/easter-egg/terminal';

type LineKind = 'in' | 'out' | 'sys' | 'paste';
type Line = { id: number; kind: LineKind; text: string };

const MAX_LINES = 200;
const LINE_CLS: Record<LineKind, string> = {
  in: 'text-gray-300',
  out: 'text-emerald-300',
  sys: 'text-emerald-500/70',
  paste: 'text-amber-300',
};
const SCRAMBLE = 'アイウエオカキクケコ01<>/{}$#';

type Props = {
  displayName: string;
  role: string;
  maxAttempts: number;
  pasteCountsAsAttempt: boolean;
  blockPaste: boolean;
  matrixActive: boolean;
  onBoost: () => void;
  onExhausted: () => void;
};

export function BypassTerminal({ displayName, role, maxAttempts, pasteCountsAsAttempt, blockPaste, matrixActive, onBoost, onExhausted }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState('');
  const [booting, setBooting] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const [done, setDone] = useState(false);
  const [effect, setEffect] = useState<{ name: PasteEffect; key: number } | null>(null);

  const nextId = useRef(0);
  const attemptsRef = useRef(0);
  const uptime = useRef<{ s: number; at: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout>>();
  const shake = useAnimationControls();

  const push = (kind: LineKind, texts: string[]) =>
    setLines((prev) => [...prev, ...texts.map((text) => ({ id: nextId.current++, kind, text }))].slice(-MAX_LINES));

  useEffect(() => {
    const timers = BOOT_LINES.map((l, i) => setTimeout(() => push('sys', [l]), i * 700));
    timers.push(setTimeout(() => {
      setBooting(false);
      inputRef.current?.focus();
    }, BOOT_LINES.length * 700));
    api.get('/easter-egg/uptime').then((r) => (uptime.current = { s: r.data.uptimeSeconds, at: Date.now() })).catch(() => {});
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(finishTimer.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (!effect) return;
    if (effect.name === 'shake') shake.start({ x: [0, -10, 10, -7, 7, -3, 0], transition: { duration: 0.45 } });
    const t = setTimeout(() => setEffect(null), 1100);
    return () => clearTimeout(t);
  }, [effect, shake]);

  const registerAttempt = () => {
    attemptsRef.current += 1;
    setAttempts(attemptsRef.current);
    if (attemptsRef.current >= maxAttempts) {
      setDone(true);
      push('sys', ['Attempt limit reached.', 'Initiating final protocol...']);
      finishTimer.current = setTimeout(onExhausted, 1400);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (booting || done) return;
    const uptimeSeconds = uptime.current ? Math.round(uptime.current.s + (Date.now() - uptime.current.at) / 1000) : null;
    const reply = respond(value, { displayName, role, uptimeSeconds });
    setValue('');
    if (reply.echo) push('in', [`$ ${reply.echo}`]);
    push('out', reply.lines);
    if (reply.counts) registerAttempt();
  };

  // Clipboard contents are never read — the event is cancelled outright.
  const rejectPaste = (e: { preventDefault: () => void }) => {
    if (!blockPaste) return;
    e.preventDefault();
    if (booting || done) return;
    const p = pastePick();
    const name = p.effect === 'matrix' && !matrixActive ? 'sweep' : p.effect;
    push('paste', p.lines);
    setEffect({ name, key: Date.now() });
    if (name === 'matrix') onBoost();
    if (pasteCountsAsAttempt) registerAttempt();
  };

  const fx = effect?.name;

  return (
    <motion.div animate={shake} className="w-full max-w-2xl">
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="relative glass rounded-xl border border-emerald-500/30 shadow-[0_0_48px_rgba(16,185,129,0.15)] overflow-hidden"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-500/20 bg-black/30">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 text-xs font-mono text-emerald-500/70">pmis://bypass — tty0</span>
        </div>
        <span className="text-[10px] font-mono tracking-widest text-emerald-500/60">
          ATTEMPTS {attempts}/{maxAttempts}
        </span>
      </div>

      <div ref={scrollRef} className="h-80 overflow-y-auto px-4 py-3 font-mono text-sm space-y-0.5">
        {lines.map((l) => (
          <p key={l.id} className={`whitespace-pre-wrap break-words ${LINE_CLS[l.kind]}`}>
            {l.text}
          </p>
        ))}
      </div>

      <form onSubmit={submit} className="relative flex items-center gap-2 px-4 py-3 border-t border-emerald-500/20 bg-black/30">
        <motion.span
          animate={fx === 'blink' ? { opacity: [1, 0, 1, 0, 1, 0, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9 }}
          className="font-mono text-emerald-400"
        >
          $
        </motion.span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={rejectPaste}
          onDrop={rejectPaste}
          disabled={booting || done}
          maxLength={MAX_INPUT}
          placeholder={booting ? '' : 'Try your luck'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Bypass terminal input"
          className="flex-1 !bg-transparent !border-0 font-mono text-sm text-emerald-200 placeholder:text-emerald-700 outline-none focus:ring-0"
        />
        <AnimatePresence>
          {fx === 'dissolve' && (
            <motion.span
              key={effect!.key}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0, filter: 'blur(4px)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9 }}
              className="absolute inset-0 flex items-center px-10 font-mono text-sm text-emerald-400 pointer-events-none overflow-hidden whitespace-nowrap"
            >
              {Array.from({ length: 48 }, () => SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]).join('')}
            </motion.span>
          )}
          {fx === 'ripple' && (
            <motion.span
              key={effect!.key}
              initial={{ scale: 0, opacity: 0.5 }}
              animate={{ scale: 6, opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute left-1/2 top-1/2 -ml-8 -mt-8 w-16 h-16 rounded-full border border-emerald-300/60 bg-emerald-300/10 pointer-events-none"
            />
          )}
          {fx === 'flee' && (
            <motion.span
              key={effect!.key}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              animate={{ x: 700, y: -120, rotate: 540, opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeIn' }}
              className="absolute left-10 top-2 text-amber-300 pointer-events-none"
            >
              <ClipboardX className="w-6 h-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </form>

      <AnimatePresence>
        {fx === 'sweep' && (
          <motion.div
            key={effect!.key}
            initial={{ top: '-15%' }}
            animate={{ top: '110%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'linear' }}
            className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-red-500/30 to-transparent pointer-events-none"
          />
        )}
        {fx === 'lock' && (
          <motion.div
            key={effect!.key}
            initial={{ scale: 1.8, opacity: 0 }}
            animate={{ scale: [1.8, 0.9, 1], opacity: [0, 1, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <Lock className="w-12 h-12 text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.7)]" />
          </motion.div>
        )}
        {fx === 'ctrlv' && (
          <motion.div key={effect!.key} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none font-mono text-sm">
            {['CTRL', 'V'].map((k, i) => (
              <motion.span
                key={k}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                animate={{ x: i ? 70 : -70, y: 60, rotate: i ? 30 : -30, opacity: 0 }}
                transition={{ duration: 0.9, delay: 0.25, ease: 'easeIn' }}
                className="px-3 py-1.5 rounded-md border border-amber-400/60 bg-black/60 text-amber-300"
              >
                {k}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </motion.div>
  );
}
