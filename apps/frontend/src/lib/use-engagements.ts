'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useAuth } from '@/contexts/auth-context';
import type { Counts } from '@/lib/risk';

export type Person = { id: string; username: string; fullName: string | null };
export type Row = {
  id: string;
  name: string;
  clientName: string;
  scope: string | null;
  totalScopeCount: number | null;
  testingType: string | null;
  subType: string;
  complianceType: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  tester: Person & { assignedTlId: string | null };
  tl: Person;
  vulnCounts: Counts;
};

export const person = (u: { username: string; fullName: string | null }) => u.fullName || u.username;
export const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const REFRESH_MS = 60_000;
const HIGHLIGHT_MS = 3_000;

/**
 * Loads /dashboard/engagements for a view, then quietly re-fetches every minute
 * (only while the tab is visible). `changed` holds ids of rows that differ from
 * the previous fetch so the UI can flash them briefly.
 */
export function useEngagements(view: 'team' | 'self') {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const previous = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(
    (silent = false) => {
      if (!silent) {
        setError(false);
        setRows(null);
        previous.current = new Map();
      }
      return api
        .get('/dashboard/engagements', { params: { view } })
        .then((res) => {
          const data: Row[] = res.data;
          const next = new Map(data.map((r) => [r.id, JSON.stringify(r)]));
          if (silent) {
            const diff = data.filter((r) => previous.current.get(r.id) !== next.get(r.id)).map((r) => r.id);
            if (diff.length) {
              setChanged(new Set(diff));
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setChanged(new Set()), HIGHLIGHT_MS);
            }
          }
          previous.current = next;
          setRows(data);
          setUpdatedAt(new Date());
          setError(false);
        })
        // A failed background refresh keeps the data on screen; only an explicit load shows the error.
        .catch(() => {
          if (!silent) setError(true);
        });
    },
    [view],
  );

  useEffect(() => {
    if (!user) return;
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, REFRESH_MS);
    return () => {
      clearInterval(id);
      clearTimeout(timer.current);
    };
  }, [user, load]);

  return { rows, error, updatedAt, changed, reload: () => load() };
}
