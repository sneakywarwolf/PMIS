'use client';

import { motion } from 'framer-motion';
import { ScanButton } from '@/components/easter-egg/scan-button';

// Renders with HTTP 200 — Next pages can't set a 418 status.
export default function CoffeePage() {
  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-6 overflow-hidden relative">
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cyber-grid" />
        <div className="absolute inset-0 ee-scanlines" />
      </div>

      <div className="relative text-center max-w-md">
        <div className="relative mx-auto w-40 h-36">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute top-0 w-2 h-8 rounded-full bg-gray-300/30 blur-[2px]"
              style={{ left: `${38 + i * 10}%` }}
              animate={{ y: [10, -18], opacity: [0, 0.8, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
            />
          ))}
          <motion.svg
            viewBox="0 0 120 90"
            className="absolute bottom-0 w-full"
            role="img"
            aria-label="Teapot"
            animate={{ rotate: [0, -4, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <path d="M22 40 Q8 36 6 22 Q20 26 28 38" className="fill-emerald-600" />
            <ellipse cx="60" cy="56" rx="36" ry="28" className="fill-emerald-500" />
            <path d="M94 44 Q112 44 110 60 Q108 74 92 70" className="fill-none stroke-emerald-500" strokeWidth={6} />
            <rect x="44" y="24" width="32" height="8" rx="3" className="fill-emerald-600" />
            <circle cx="60" cy="21" r="5" className="fill-emerald-400" />
            <ellipse cx="48" cy="50" rx="8" ry="5" className="fill-white/20" />
          </motion.svg>
        </div>

        <h1 className="mt-6 text-5xl font-black text-emerald-400 tracking-tight">418</h1>
        <p className="mt-2 text-lg font-semibold text-white">I&apos;m a teapot</p>
        <p className="mt-1 text-sm text-gray-400">Refusing to brew coffee. Short and stout, as specified in RFC 2324.</p>
        <p className="mt-4 font-mono text-xs text-emerald-500/70">$ brew coffee → Dependency missing: coffee</p>

        <div className="mt-8">
          <ScanButton />
        </div>
      </div>
    </div>
  );
}
