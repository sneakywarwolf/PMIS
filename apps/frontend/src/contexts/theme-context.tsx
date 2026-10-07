'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export const THEME_OVERRIDE_KEY = 'pmis-theme-override';
// Last admin default theme seen on this browser. Lets the inline script in app/layout.tsx paint the
// right theme before first render — including on /login, where no authenticated settings exist yet.
export const ADMIN_DEFAULT_THEME_KEY = 'pmis-theme-admin-default';

interface ThemeContextValue {
  themeId: string;
  adminDefaultThemeId: string;
  userOverrideId: string | null;
  setUserTheme: (id: string | null) => void; // null clears the override
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  adminDefaultThemeId: DEFAULT_THEME_ID,
  userOverrideId: null,
  setUserTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { settings } = useBranding();
  const [userOverrideId, setUserOverrideId] = useState<string | null>(null);
  const [cachedAdminId, setCachedAdminId] = useState<string | null>(null);
  // Nothing may touch <html data-theme> until the browser-local values have been read: the inline
  // script already applied the right theme before first paint, and writing the defaults here first
  // would flash the wrong one.
  const [hydrated, setHydrated] = useState(false);

  // Read browser-local values once on mount — kept out of the server-rendered pass so hydration
  // always starts from the same markup.
  useEffect(() => {
    setUserOverrideId(localStorage.getItem(THEME_OVERRIDE_KEY));
    setCachedAdminId(localStorage.getItem(ADMIN_DEFAULT_THEME_KEY));
    setHydrated(true);
  }, []);

  // Admin default: live settings once authenticated; otherwise the cached value; otherwise the system default.
  const liveAdminId: string | undefined = settings?.appearance?.defaultTheme;
  useEffect(() => {
    if (!liveAdminId) return;
    setCachedAdminId(liveAdminId);
    localStorage.setItem(ADMIN_DEFAULT_THEME_KEY, liveAdminId);
  }, [liveAdminId]);

  // Logged-out visit (login page): ask the server for just the admin default theme, once, in the
  // background. It never blocks or touches authentication; with a warm cache it changes nothing.
  const askedPublic = useRef(false);
  useEffect(() => {
    if (loading || user || askedPublic.current) return;
    askedPublic.current = true;
    axios.get('/api/settings/public-theme', { timeout: 5000 })
      .then((res) => {
        const id = res.data?.defaultTheme;
        if (typeof id !== 'string' || !id) return;
        setCachedAdminId(id);
        localStorage.setItem(ADMIN_DEFAULT_THEME_KEY, id);
      })
      .catch(() => {});
  }, [loading, user]);

  const adminDefaultThemeId = liveAdminId || cachedAdminId || DEFAULT_THEME_ID;

  // Precedence: user override -> admin default -> system default.
  const themeId = userOverrideId || adminDefaultThemeId;

  // CSS alone renders the theme (see [data-theme='...'] blocks in globals.css) — this only ever
  // flips one attribute, so switching is instant and needs no re-render of the app below it.
  // While nothing is known yet (first ever visit: no override, no cache, settings not loaded) the page is
  // already showing the system default, so don't write it again — wait for the real value instead of
  // flashing default -> admin theme.
  const resolved = userOverrideId || liveAdminId || cachedAdminId;
  useEffect(() => {
    if (!hydrated || !resolved) return;
    if (document.documentElement.dataset.theme !== themeId) document.documentElement.dataset.theme = themeId;
  }, [themeId, hydrated, resolved]);

  const setUserTheme = (id: string | null) => {
    if (id) localStorage.setItem(THEME_OVERRIDE_KEY, id);
    else localStorage.removeItem(THEME_OVERRIDE_KEY);
    setUserOverrideId(id);
  };

  const value = useMemo(
    () => ({ themeId, adminDefaultThemeId, userOverrideId, setUserTheme }),
    [themeId, adminDefaultThemeId, userOverrideId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
