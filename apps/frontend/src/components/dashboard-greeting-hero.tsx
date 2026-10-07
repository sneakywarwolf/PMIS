'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion, useMotionValueEvent } from 'framer-motion';
import { Sun, Sunset, Moon, Cloud } from 'lucide-react';

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const GREETINGS: Record<TimeOfDay, string> = {
  morning: 'Good Morning',
  afternoon: 'Good Afternoon',
  evening: 'Good Evening',
  night: 'Good Night',
};

const ICONS: Record<TimeOfDay, React.ElementType> = {
  morning: Sun,
  afternoon: Cloud,
  evening: Sunset,
  night: Moon,
};

// Subtle, dashboard-readable gradients per time of day — kept dark enough that
// existing glass-card text/contrast isn't affected once content scrolls into it.
const BACKGROUNDS: Record<TimeOfDay, string> = {
  morning: 'from-amber-500/20 via-orange-500/10 to-cyber-bg',
  afternoon: 'from-sky-500/20 via-cyan-500/10 to-cyber-bg',
  evening: 'from-violet-500/20 via-fuchsia-500/10 to-cyber-bg',
  night: 'from-indigo-900/30 via-slate-800/20 to-cyber-bg',
};

export function DashboardGreetingHero({ name, pageTitle }: { name: string; pageTitle: string }) {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => getTimeOfDay(new Date().getHours()));
  const heroRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const interval = setInterval(() => setTimeOfDay(getTimeOfDay(new Date().getHours())), 60000);
    return () => clearInterval(interval);
  }, []);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });

  const heroHeight = useTransform(scrollYProgress, [0, 1], [1, 0.4]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, -40]);

  // Mount/unmount the compact header instead of just fading its opacity —
  // an invisible `position: sticky` element still reserves its box, which
  // left a permanent blank gap above the hero.
  const [showSticky, setShowSticky] = useState(false);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setShowSticky(v > 0.6));

  const Icon = ICONS[timeOfDay];

  return (
    <>
      <AnimatePresence>
        {showSticky && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="sticky top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 py-3 bg-cyber-bg/90 backdrop-blur-md border-b border-gray-800 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-white">{pageTitle}</span>
            </div>
            <span className="text-xs text-gray-400">{name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        ref={heroRef}
        style={prefersReducedMotion ? undefined : { scaleY: heroHeight, opacity: heroOpacity, y: heroY, transformOrigin: 'top' }}
        className={`-mx-4 -mt-4 px-4 md:-mx-6 md:px-6 pt-10 pb-8 mb-2 bg-gradient-to-br ${BACKGROUNDS[timeOfDay]} rounded-b-2xl`}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="flex items-center gap-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.7, rotate: -15 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
            className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10"
          >
            <Icon className="w-7 h-7 text-white" />
          </motion.div>
          <div>
            <h1 className="text-3xl font-bold text-white">
              {GREETINGS[timeOfDay]}, {name}
            </h1>
            <p className="text-gray-300 text-sm mt-1">{pageTitle}</p>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
