'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';

/**
 * userId -> Quiz/Arcade team name. Team names are a Quiz/Arcade-only label, so only
 * Quiz/Arcade boards use this; the rest of PMIS never shows them.
 */
export function useTeamNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { api.get('/quiz/teams/names').then((r) => setNames(r.data)).catch(() => {}); }, []);
  return names;
}

/** Small "which team" chip shown next to a player's name on Quiz/Arcade boards. */
export const TEAM_CHIP = 'ml-2 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 align-middle';
