'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Shield, User, UserCog } from 'lucide-react';

export type MyTeam = {
  teamLead: { id: string; name: string; designation: string | null };
  manager: { id: string; name: string; designation: string | null } | null;
  members: { id: string; name: string; designation: string | null; isMe: boolean }[];
  iAmLead: boolean;
};

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** "Which team am I in, and who else is on it" — names and designations only. */
export function MyTeamCard({ team }: { team: MyTeam }) {
  const reduce = useReducedMotion();
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="w-4 h-4 text-amber-300" />
          <span className="text-gray-400">Team Lead</span>
          <span className="font-medium text-white">{team.teamLead.name}</span>
          {team.iAmLead && <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">you</span>}
        </div>
        {team.manager && (
          <div className="flex items-center gap-2 text-sm">
            <UserCog className="w-4 h-4 text-gray-500" />
            <span className="text-gray-400">Manager</span>
            <span className="font-medium text-white">{team.manager.name}</span>
          </div>
        )}
        <span className="text-xs text-gray-500 tabular-nums sm:ml-auto">{team.members.length} {team.members.length === 1 ? 'member' : 'members'}</span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {team.members.map((m, i) => (
          <motion.li
            key={m.id}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : Math.min(i, 12) * 0.03 }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${m.isMe ? 'border-white/25 bg-white/[0.06]' : 'border-white/5 bg-white/[0.02]'}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-200" aria-hidden>
              {initials(m.name) || <User className="w-4 h-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-100">
                {m.name}
                {m.isMe && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-white/60">you</span>}
              </p>
              {m.designation && <p className="truncate text-xs text-gray-500">{m.designation}</p>}
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
