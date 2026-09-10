'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldOff, Sparkles, Home } from 'lucide-react';

const REQUEST_STAGES = [
  'Submitting access request…',
  'Escalating privileges…',
  'Bribing the admin…',
  'Consulting the RBAC gods…',
  'Almost there…',
];

const EMOJI = ['🔒', '🙅', '🚫', '😂', '👀', '🎉'];

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={null}>
      <UnauthorizedContent />
    </Suspense>
  );
}

function UnauthorizedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from');

  const [stage, setStage] = useState<'idle' | 'input' | 'requesting' | 'revealed'>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [attempt, setAttempt] = useState('');

  const showInput = () => setStage('input');

  // The entered text is never read, evaluated, or sent anywhere — every
  // submission (empty, garbage, or "clever") leads to the exact same
  // animation. This is deliberate: input here is purely decorative.
  const tryYourLuck = (e: React.FormEvent) => {
    e.preventDefault();
    setStage('requesting');
    setStageIndex(0);
    REQUEST_STAGES.forEach((_, i) => {
      setTimeout(() => setStageIndex(i), i * 550);
    });
    setTimeout(() => setStage('revealed'), REQUEST_STAGES.length * 550 + 300);
  };

  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-6 overflow-hidden relative">
      <AnimatePresence mode="wait">
        {stage !== 'revealed' ? (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="text-center max-w-md"
          >
            <motion.div
              animate={stage === 'requesting' ? { rotate: [0, -8, 8, -8, 0] } : {}}
              transition={{ duration: 0.5, repeat: stage === 'requesting' ? Infinity : 0 }}
              className="mx-auto mb-6 w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center"
            >
              <ShieldOff className="w-9 h-9 text-red-400" />
            </motion.div>

            <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
            <p className="text-gray-400 text-sm mb-1">
              You don't have permission to view {from ? <span className="text-gray-300 font-mono">{from}</span> : 'this page'}.
            </p>
            <p className="text-gray-500 text-xs mb-8">Your role doesn't include this feature. Contact an administrator if you believe this is a mistake.</p>

            {stage === 'idle' && (
              <button
                onClick={showInput}
                className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                Bypass Access
              </button>
            )}

            {stage === 'input' && (
              <motion.form
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onSubmit={tryYourLuck}
                className="flex flex-col items-center gap-3"
              >
                <input
                  autoFocus
                  type="text"
                  value={attempt}
                  onChange={(e) => setAttempt(e.target.value)}
                  placeholder="Try your luck"
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white text-center placeholder:text-gray-500 outline-none transition-colors"
                />
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
                >
                  Submit
                </button>
              </motion.form>
            )}

            {(stage === 'requesting') && (
              <div className="h-10 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={stageIndex}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="text-sm text-emerald-400 font-mono"
                  >
                    {REQUEST_STAGES[stageIndex]}
                  </motion.p>
                </AnimatePresence>
              </div>
            )}

            <button
              onClick={() => router.push('/dashboard')}
              className="mt-8 flex items-center gap-1.5 mx-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Home className="w-3.5 h-3.5" /> Back to Dashboard
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center relative"
          >
            {EMOJI.map((e, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  scale: [0, 1.4, 1, 0.8],
                  x: Math.cos((i / EMOJI.length) * Math.PI * 2) * 160,
                  y: Math.sin((i / EMOJI.length) * Math.PI * 2) * 160,
                }}
                transition={{ duration: 1.8, delay: i * 0.05, ease: 'easeOut' }}
                className="absolute left-1/2 top-1/2 text-3xl pointer-events-none"
              >
                {e}
              </motion.span>
            ))}

            <motion.div
              initial={{ scale: 0.3, rotate: -15, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14 }}
            >
              <motion.h1
                animate={{
                  textShadow: [
                    '0 0 0px rgba(16,185,129,0)',
                    '0 0 24px rgba(16,185,129,0.6)',
                    '0 0 0px rgba(16,185,129,0)',
                  ],
                }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="text-4xl md:text-6xl font-black text-emerald-400 tracking-tight mb-4 select-none"
              >
                LULLZ YOU WISH
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="text-gray-400 text-sm flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-4 h-4 text-emerald-400" /> Request denied with maximum style.
              </motion.p>

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 }}
                onClick={() => router.push('/dashboard')}
                className="mt-8 px-6 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-gray-700 text-gray-300 text-sm transition-colors"
              >
                Fine, take me back
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
