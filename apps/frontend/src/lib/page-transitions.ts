import type { Transition, Variants } from 'framer-motion';

/**
 * Four transition families, chosen by navigation type — never randomly:
 *
 * 1. Crossfade    — moving between unrelated top-level modules (Dashboard/Projects/Reports/...)
 * 2. Slide        — hierarchical moves within the same module (list -> detail = forward,
 *                    detail -> list = backward), directionally aware
 * 3. Vertical lift — Dashboard -> deeper analytics (Reports)
 * 4. Scale + fade — modal-like focused views (routes ending in /new or /edit)
 *
 * Every family shares the exact same duration/easing (TRANSITION_TIMING) and the
 * same "Progressive Blur Reveal" treatment (entering content starts slightly
 * blurred and sharpens in), so only the motion path differs — never the feel.
 *
 * True DOM shared-element/morph transitions (Project card -> Project detail)
 * would need both trees mounted simultaneously across a Next.js route change,
 * which app router doesn't support without extra tooling — Slide is used as
 * the closest practical approximation for that case.
 */
export type TransitionKind = 'crossfade' | 'slideForward' | 'slideBack' | 'verticalLift' | 'scaleFade';

export const TRANSITION_TIMING: Transition = { duration: 0.55, ease: 'easeInOut' };

function moduleOf(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean); // ['dashboard', 'projects', ':id']
  return segments[1] || 'dashboard';
}

function depthOf(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

export function classifyTransition(prevPath: string, nextPath: string): TransitionKind {
  if (/\/(new|edit)$/.test(nextPath) || /\/(new|edit)$/.test(prevPath)) {
    return 'scaleFade';
  }
  if (prevPath === '/dashboard' && nextPath.startsWith('/dashboard/reports')) {
    return 'verticalLift';
  }
  const prevModule = moduleOf(prevPath);
  const nextModule = moduleOf(nextPath);
  if (prevModule !== nextModule) {
    return 'crossfade';
  }
  const prevDepth = depthOf(prevPath);
  const nextDepth = depthOf(nextPath);
  if (nextDepth > prevDepth) return 'slideForward';
  if (nextDepth < prevDepth) return 'slideBack';
  return 'crossfade';
}

const BLUR_IN = 'blur(6px)';
const BLUR_OUT = 'blur(4px)';

export const TRANSITION_VARIANTS: Record<TransitionKind, Variants> = {
  // Family 1: Crossfade
  crossfade: {
    initial: { opacity: 0, filter: BLUR_IN },
    animate: { opacity: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, filter: BLUR_OUT },
  },
  // Family 2: Slide (forward = deeper into a module)
  slideForward: {
    initial: { opacity: 0, x: 24, filter: BLUR_IN },
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, x: -24, filter: BLUR_OUT },
  },
  // Family 2: Slide (backward = up out of a module)
  slideBack: {
    initial: { opacity: 0, x: -24, filter: BLUR_IN },
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, x: 24, filter: BLUR_OUT },
  },
  // Family 3: Vertical lift
  verticalLift: {
    initial: { opacity: 0, y: 24, filter: BLUR_IN },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -12, filter: BLUR_OUT },
  },
  // Family 4: Scale + fade
  scaleFade: {
    initial: { opacity: 0, scale: 0.97, filter: BLUR_IN },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.98, filter: BLUR_OUT },
  },
};
