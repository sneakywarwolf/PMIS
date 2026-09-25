'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectEasterEgg, LiveState, OFFLINE } from '@/lib/easter-egg/socket';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldOff, Sparkles, Home } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { MatrixRain } from '@/components/easter-egg/matrix-rain';
import { BypassTerminal } from '@/components/easter-egg/bypass-terminal';

const EMOJI = ['🔒', '🙅', '🚫', '😂', '👀', '🎉'];
const TAKEOVER_MS = 1500;

type EasterEggSettings = { enabled: boolean; maxAttempts: number; matrixEffects: boolean; pasteCountsAsAttempt: boolean };
type Stage = 'idle' | 'takeover' | 'terminal' | 'revealed';
const LIVE_STAGE: Record<Stage, string> = { idle: 'restricted', takeover: 'terminal', terminal: 'terminal', revealed: 'revealed' };

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
  const { user } = useAuth();

  const [egg, setEgg] = useState<EasterEggSettings | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [matrixOn, setMatrixOn] = useState(true);
  const [boostAt, setBoostAt] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [live, setLive] = useState<LiveState>(OFFLINE);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Live monitoring is optional: if the socket never connects, the terminal still works locally.
  const eggOn = !!egg?.enabled && !!user;
  const maxAttempts = egg?.maxAttempts;
  useEffect(() => {
    if (!eggOn) return;
    const s = connectEasterEgg();
    s.on('connect', () => s.emit('ee:join', { stage: LIVE_STAGE[stageRef.current], max: maxAttempts }));
    s.on('disconnect', () => setLive(OFFLINE));
    s.on('ee:admin', (d: LiveState) => setLive({ connected: !!d?.connected, mode: d?.mode === 'MANUAL' ? 'MANUAL' : 'AUTO' }));
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setLive(OFFLINE);
    };
  }, [eggOn, maxAttempts]);

  useEffect(() => {
    socket?.emit('ee:status', { stage: LIVE_STAGE[stage] });
  }, [socket, stage]);

  // Any failure here just leaves the plain Access Restricted page.
  useEffect(() => {
    if (!user) return;
    api.get('/settings').then((r) => setEgg(r.data.settings?.easterEgg ?? null)).catch(() => setEgg(null));
  }, [user]);

  useEffect(() => {
    if (stage !== 'takeover') return;
    const t = setTimeout(() => setStage('terminal'), TAKEOVER_MS);
    return () => clearTimeout(t);
  }, [stage]);

  const disableMatrix = useCallback(() => setMatrixOn(false), []);
  const boost = useCallback(() => setBoostAt(performance.now()), []);
  const exhausted = useCallback(() => setStage('revealed'), []);

  const inEgg = stage === 'takeover' || stage === 'terminal';
  const showMatrix = inEgg && !!egg?.matrixEffects && matrixOn;

  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-6 overflow-hidden relative">
      <AnimatePresence>
        {inEgg && (
          <motion.div key="bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="fixed inset-0 pointer-events-none">
            {showMatrix ? <MatrixRain boostAt={boostAt} onDisable={disableMatrix} /> : <div className="absolute inset-0 cyber-grid" />}
            <div className="absolute inset-0 ee-scanlines" />
            <div className="absolute inset-0 scanline" />
            <div className="absolute top-4 left-4 font-mono text-[10px] tracking-widest text-emerald-500/50 space-y-0.5">
              <p>TRACE: ACTIVE</p>
              <p>NODE: PMIS-GW-01</p>
            </div>
            <div className="absolute bottom-4 right-4 font-mono text-[10px] tracking-widest text-emerald-500/50">SIGNAL ▮▮▮▯ // ROUTE: UNRESOLVED</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {live.connected && (
          <motion.div
            key="live-pill"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-cyan-400/40 text-xs text-cyan-200"
          >
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Admin connected · Live session{live.mode === 'MANUAL' ? ' · Operator responding' : ''}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {stage === 'idle' && (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, skewX: [0, 12, -8, 0], filter: ['blur(0px)', 'blur(2px)', 'blur(6px)'] }}
            transition={{ duration: 0.4 }}
            className="text-center max-w-md relative"
          >
            <div className="mx-auto mb-6 w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <ShieldOff className="w-9 h-9 text-red-400" />
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
            <p className="text-gray-400 text-sm mb-1">
              You don't have permission to view {from ? <span className="text-gray-300 font-mono">{from}</span> : 'this page'}.
            </p>
            <p className="text-gray-500 text-xs mb-8">Your role doesn't include this feature. Contact an administrator if you believe this is a mistake.</p>

            {egg?.enabled && (
              <button
                onClick={() => setStage('takeover')}
                className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                Bypass Access
              </button>
            )}

            <button
              onClick={() => router.push('/dashboard')}
              className="mt-8 flex items-center gap-1.5 mx-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Home className="w-3.5 h-3.5" /> Back to Dashboard
            </button>
          </motion.div>
        )}

        {stage === 'terminal' && egg && user && (
          <motion.div key="terminal" exit={{ opacity: 0, scale: 0.95 }} className="relative w-full flex justify-center">
            <BypassTerminal
              displayName={user.fullName || user.username}
              role={user.role}
              maxAttempts={egg.maxAttempts}
              pasteCountsAsAttempt={egg.pasteCountsAsAttempt}
              blockPaste={user.role !== 'ADMIN'}
              matrixActive={showMatrix}
              onBoost={boost}
              onExhausted={exhausted}
              socket={socket}
              live={live}
            />
          </motion.div>
        )}

        {stage === 'revealed' && (
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
                onClick={() => setStage('idle')}
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
