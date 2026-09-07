'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/contexts/auth-context';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const WARNING_SECONDS = 60;

interface IdleTimerState {
  warning: boolean;
  secondsRemaining: number;
  stayActive: () => void;
}

/**
 * Reads security.sessionTimeoutMinutes / inactivityAction from app settings
 * and enforces it client-side: 'logout' ends the session as soon as the
 * timeout elapses, 'warn' shows a countdown the user can dismiss first.
 */
export function useIdleTimer(enabled: boolean): IdleTimerState {
  const [warning, setWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(WARNING_SECONDS);
  const lastActivityRef = useRef(Date.now());
  const settingsRef = useRef<{ timeoutMinutes: number; action: 'logout' | 'warn' } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.get('/settings').then((res) => {
      if (cancelled) return;
      const security = res.data?.settings?.security;
      settingsRef.current = {
        timeoutMinutes: security?.sessionTimeoutMinutes ?? 15,
        action: security?.inactivityAction === 'warn' ? 'warn' : 'logout',
      };
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarning(false);
    setSecondsRemaining(WARNING_SECONDS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => {
      if (!warning) lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
  }, [enabled, warning]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const cfg = settingsRef.current;
      if (!cfg) return;
      const idleMs = Date.now() - lastActivityRef.current;
      const timeoutMs = cfg.timeoutMinutes * 60 * 1000;

      if (cfg.action === 'logout') {
        if (idleMs >= timeoutMs) {
          window.location.href = '/login?idleTimeout=1';
        }
        return;
      }

      // 'warn': show a countdown once within WARNING_SECONDS of the timeout
      const msUntilTimeout = timeoutMs - idleMs;
      if (msUntilTimeout <= WARNING_SECONDS * 1000) {
        if (msUntilTimeout <= 0) {
          window.location.href = '/login?idleTimeout=1';
          return;
        }
        setWarning(true);
        setSecondsRemaining(Math.ceil(msUntilTimeout / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled]);

  return { warning, secondsRemaining, stayActive };
}
