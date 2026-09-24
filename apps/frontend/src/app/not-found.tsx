'use client';

import { MouseEvent, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { BreakableDigit } from '@/components/easter-egg/breakable-digit';
import { ScanButton } from '@/components/easter-egg/scan-button';

const MAX_PATH = 64;
const HOPS = ['edge-proxy', 'pmis-gw-01', 'router.app', 'route-table'];
const HOP_MS = 350;

// The path is only ever rendered as React text, capped by code point.
function shortPath(p: string | null) {
  const chars = Array.from(p || '/');
  return chars.length > MAX_PATH ? chars.slice(0, MAX_PATH).join('') + '…' : chars.join('');
}

export default function NotFound() {
  const path = shortPath(usePathname());
  const reduce = useReducedMotion();
  const [imgOk, setImgOk] = useState(true);
  const [hop, setHop] = useState(0);

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 120, damping: 20 });
  const sy = useSpring(my, { stiffness: 120, damping: 20 });
  const rotateY = useTransform(sx, [0, 1], [-6, 6]);
  const rotateX = useTransform(sy, [0, 1], [5, -5]);
  const left = useTransform(sx, (v) => `${v * 100}%`);
  const top = useTransform(sy, (v) => `${v * 100}%`);
  const xLabel = useTransform(mx, (v) => `X ${String(Math.round(v * 1000)).padStart(4, '0')}`);
  const yLabel = useTransform(my, (v) => `Y ${String(Math.round(v * 1000)).padStart(4, '0')}`);

  useEffect(() => {
    if (hop > HOPS.length) return;
    const t = setTimeout(() => setHop((h) => h + 1), HOP_MS);
    return () => clearTimeout(t);
  }, [hop]);

  const track = (e: MouseEvent) => {
    mx.set(e.clientX / window.innerWidth);
    my.set(e.clientY / window.innerHeight);
  };

  return (
    <div onMouseMove={reduce ? undefined : track} className="min-h-screen bg-cyber-bg flex items-center justify-center p-6 overflow-hidden relative">
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cyber-grid" />
        <div className="absolute inset-0 ee-scanlines" />
        <div className="absolute inset-0 scanline" />
        {!reduce && (
          <>
            <motion.div className="absolute inset-y-0 w-px bg-emerald-500/15" style={{ left }} />
            <motion.div className="absolute inset-x-0 h-px bg-emerald-500/15" style={{ top }} />
          </>
        )}
        <div className="absolute top-4 left-4 font-mono text-[10px] tracking-widest text-emerald-500/50 space-y-0.5">
          <p>STATUS: 404</p>
          <motion.p>{xLabel}</motion.p>
          <motion.p>{yLabel}</motion.p>
        </div>
        <div className="absolute bottom-4 right-4 font-mono text-[10px] tracking-widest text-emerald-500/50">SIGNAL ▮▯▯▯ // ROUTE: LOST</div>
      </div>

      <motion.div style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 900 }} className="relative text-center max-w-xl w-full">
        {imgOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/easter-egg/404.png"
            alt=""
            onError={() => setImgOk(false)}
            // onError can fire before hydration; catch an already-failed load too.
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setImgOk(false);
            }}
            className="mx-auto mb-4 max-h-48 w-auto object-contain" />
        )}

        <div className="flex justify-center gap-2 md:gap-4">
          {['4', '0', '4'].map((c, i) => (
            <BreakableDigit key={i} char={c} />
          ))}
        </div>

        <h1 className="mt-2 text-xl font-bold text-white">Route not found</h1>
        <p className="mt-1 text-sm text-gray-400">This page wandered off the network. The digits are load-bearing — mostly.</p>

        <div className="mt-6 mx-auto max-w-md text-left glass rounded-lg px-4 py-3 font-mono text-xs space-y-1" role="log" aria-label="Route trace">
          <p className="text-gray-300 break-all">
            $ traceroute <span className="text-emerald-300">{path}</span>
          </p>
          {HOPS.slice(0, hop).map((h, i) => (
            <p key={h} className="text-emerald-500/80">
              {i + 1}  {h}  {(i + 1) * 3 + 1} ms
            </p>
          ))}
          {hop > HOPS.length && <p className="text-red-400">{HOPS.length + 1}  * * *  ✗ NO ROUTE TO PAGE</p>}
        </div>

        <div className="mt-8">
          <ScanButton />
        </div>
      </motion.div>
    </div>
  );
}
