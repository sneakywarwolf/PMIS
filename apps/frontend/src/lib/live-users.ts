'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/contexts/auth-context';

/**
 * Live user count shared between the heartbeat (mounted once in the dashboard shell, so every page counts as
 * activity) and the badge on the dashboard home page.
 */
type State = { count: number | null; failed: boolean };

const PING_MS = 30_000;
// Real user input. Reading with the mouse still, only scrolling, counts too.
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;

let state: State = { count: null, failed: false };
const listeners = new Set<() => void>();
const publish = (next: State) => {
  if (next.count === state.count && next.failed === state.failed) return;
  state = next;
  listeners.forEach((l) => l());
};

export function useLiveUserCount(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/**
 * While signed in: tells the server every ~30s whether the person used the page since the last beat (a tab left
 * open and untouched stops counting after the server's inactivity threshold) and refreshes the shared count.
 * Pauses while the tab is hidden and beats straight away when it comes back.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let activeSinceLastBeat = true; // opening the app is activity
    const markActive = () => {
      activeSinceLastBeat = true;
    };

    const beat = async () => {
      if (document.hidden) return;
      const active = activeSinceLastBeat;
      activeSinceLastBeat = false;
      try {
        const res = await api.post('/presence/ping', { active });
        if (!cancelled) publish({ count: res.data.count, failed: false });
      } catch {
        if (active) activeSinceLastBeat = true; // not delivered; report it on the next beat
        if (!cancelled) publish({ count: state.count, failed: true });
      }
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    beat();
    const timer = setInterval(beat, PING_MS);

    return () => {
      cancelled = true;
      // The count belongs to the signed-in session; drop it so the next account never sees the previous one's.
      publish({ count: null, failed: false });
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
