'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Users, X } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { formatDateTime } from '@/lib/datetime';
import { useLiveUserCount } from '@/lib/live-users';

type ActiveUser = { id: string; fullName: string | null; username: string; role: string; teamLead: string | null; lastActiveAt: string };

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrator', AVP: 'AVP', TEAM_LEAD: 'Team Lead', TESTER: 'Tester' };
// Only these roles may open the list (the server enforces the same rule and the team scope).
const CAN_VIEW_LIST = ['ADMIN', 'TEAM_LEAD', 'AVP'];

const PILL = 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20';

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

/** "Live Users: N" beside the System Online pill. Everyone sees the number; only Admin / TL / AVP can open the list. */
export function LiveUsersBadge() {
  const { user } = useAuth();
  const { count, failed } = useLiveUserCount();
  const [open, setOpen] = useState(false);
  const canOpen = !!user && CAN_VIEW_LIST.includes(user.role);

  const label = (
    <>
      <Users className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
      <span className="text-sm text-emerald-400 font-mono whitespace-nowrap">
        LIVE USERS: {count === null ? (failed ? '—' : '…') : count}
      </span>
    </>
  );
  const title = failed ? 'Live user count unavailable, retrying' : 'Users active in the last few minutes';
  const dim = failed ? ' opacity-60' : '';

  if (!canOpen) {
    return (
      <div className={PILL + dim} title={title} role="status" aria-live="polite">
        {label}
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          title={failed ? title : 'Show active users'}
          className={`${PILL}${dim} transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50`}
        >
          {label}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[160] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl focus:outline-none"
        >
          <ActiveUsersList onClose={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ActiveUsersList({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<ActiveUser[] | null>(null);
  const [thresholdSeconds, setThresholdSeconds] = useState(300);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get('/presence/active-users')
        .then((res) => {
          if (cancelled) return;
          setUsers(res.data.users);
          setThresholdSeconds(res.data.thresholdSeconds);
          setError(false);
          setNow(Date.now());
        })
        .catch(() => !cancelled && setError(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-gray-800 p-5">
        <div>
          <Dialog.Title className="text-lg font-medium text-white">Active users</Dialog.Title>
          <p className="mt-0.5 text-xs text-gray-400">
            Users active in the last {Math.round(thresholdSeconds / 60)} minutes within your access. Refreshes automatically.
          </p>
        </div>
        <Dialog.Close aria-label="Close" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none">
          <X className="w-4 h-4" />
        </Dialog.Close>
      </div>

      <div className="overflow-y-auto p-5">
        {users === null && !error && (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
        )}
        {error && users === null && <p className="py-8 text-center text-sm text-red-400">Could not load active users.</p>}
        {users && users.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No active users right now.</p>}
        {users && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4 font-normal">Name</th>
                  <th className="pb-2 pr-4 font-normal">Username</th>
                  <th className="pb-2 pr-4 font-normal">Role</th>
                  <th className="pb-2 pr-4 font-normal">Team Lead</th>
                  <th className="pb-2 font-normal">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const recent = now - new Date(u.lastActiveAt).getTime() < 90_000;
                  return (
                    <tr key={u.id} className="border-t border-gray-800 text-gray-200">
                      <td className="py-2 pr-4 break-words [overflow-wrap:anywhere]">{u.fullName || u.username}</td>
                      <td className="py-2 pr-4 text-gray-400 break-words [overflow-wrap:anywhere]">{u.username}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{ROLE_LABELS[u.role] || u.role}</td>
                      <td className="py-2 pr-4 text-gray-400">{u.teamLead || '—'}</td>
                      <td className="py-2 whitespace-nowrap" title={formatDateTime(u.lastActiveAt)}>
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${recent ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden />
                        <span className={recent ? 'text-emerald-400' : 'text-amber-400'}>{recent ? 'Active' : 'Idle'}</span>
                        <span className="ml-1.5 text-xs text-gray-500">{ago(u.lastActiveAt, now)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
