'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Unlock, RefreshCw } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import { formatDateTimeSeconds } from '@/lib/datetime';
import { LOCK_REASON_TEXT, formatRemaining, remainingMs } from '@/lib/lock-countdown';

interface LockedUser {
  userId: string;
  username: string;
  fullName: string | null;
  email: string;
  role: string;
  reason: string;
  lockedAt: string;
  expiresAt: string;
  status: 'LOCKED';
}

const REFRESH_MS = 30_000;

/**
 * Admin-only list of accounts that are temporarily locked after too many failed sign-ins. The server owns every fact shown here (who is
 * locked and when it ends); this panel only displays them, counts down against the server's clock, and asks the server to unlock.
 */
export function LockedUsersPanel() {
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const [locks, setLocks] = useState<LockedUser[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sync = useRef({ serverTime: new Date().toISOString(), fetchedAt: Date.now() });
  const refetching = useRef(false);

  const load = useCallback(async () => {
    if (refetching.current) return;
    refetching.current = true;
    try {
      const res = await api.get('/users/locked');
      sync.current = { serverTime: res.data.serverTime, fetchedAt: Date.now() };
      setLocks(res.data.locks);
      setNow(Date.now());
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load the locked accounts');
    } finally {
      refetching.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000); // the live countdown, no refresh needed
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const left = (l: LockedUser) => remainingMs(l.expiresAt, sync.current.serverTime, sync.current.fetchedAt, now);

  // A lock that has just run out disappears without waiting for the next poll.
  const anyExpired = (locks ?? []).some((l) => left(l) <= 0);
  useEffect(() => {
    if (anyExpired) load();
  }, [anyExpired, load]);

  const unlock = async (l: LockedUser) => {
    const name = l.fullName ? `${l.fullName} (${l.username})` : l.username;
    const ok = await confirmDialog({
      title: 'Unlock user?',
      message: `Remove the temporary lock on ${name}. They will be able to sign in again right away, but still need their password and every other sign-in check.`,
      confirmLabel: 'Unlock',
    });
    if (!ok) return;
    setBusyId(l.userId);
    try {
      await api.post(`/users/${l.userId}/unlock`);
      setLocks((cur) => (cur ?? []).filter((x) => x.userId !== l.userId)); // gone from the list at once
      showToast(`${name} was unlocked`);
      load();
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Could not unlock the user', 'error');
      load(); // it may already have expired or been unlocked by another Admin
    } finally {
      setBusyId(null);
    }
  };

  const visible = (locks ?? []).filter((l) => left(l) > 0);

  return (
    <section className="glass-card rounded-xl overflow-hidden" aria-labelledby="locked-users-heading">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-400" />
          <h2 id="locked-users-heading" className="text-sm font-semibold text-white">Temporarily locked accounts</h2>
          {locks !== null && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 tabular-nums">{visible.length}</span>}
        </div>
        <button onClick={() => load()} className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800" title="Refresh" aria-label="Refresh the locked accounts">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && <div role="alert" className="px-4 py-2 text-sm bg-red-500/10 text-red-400">{error}</div>}

      {locks === null && !error ? (
        <div className="px-4 py-6 text-sm text-gray-500">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-400">No accounts are temporarily locked.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Locked at</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Unlocks at</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Time left</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.userId} className="border-b border-gray-800 last:border-0">
                  <td className="px-4 py-2">
                    <div className="text-white">{l.fullName || l.username}</div>
                    {l.fullName && <div className="text-xs text-gray-500">{l.username}</div>}
                  </td>
                  <td className="px-4 py-2 text-gray-300 break-all">{l.email}</td>
                  <td className="px-4 py-2 text-gray-300 whitespace-nowrap">{l.role.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-gray-300">{LOCK_REASON_TEXT[l.reason] ?? 'Not recorded'}</td>
                  <td className="px-4 py-2 text-gray-400 tabular-nums whitespace-nowrap">{formatDateTimeSeconds(l.lockedAt)}</td>
                  <td className="px-4 py-2 text-gray-400 tabular-nums whitespace-nowrap">{formatDateTimeSeconds(l.expiresAt)}</td>
                  <td className="px-4 py-2 text-amber-400 font-mono tabular-nums whitespace-nowrap" aria-live="off">{formatRemaining(left(l))}</td>
                  <td className="px-4 py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Locked</span></td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => unlock(l)}
                      disabled={busyId === l.userId}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 disabled:opacity-50"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      Unlock User
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
