'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useBranding } from '@/contexts/branding-context';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export const THEME_OVERRIDE_KEY = 'pmis-theme-override';

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
  const { settings } = useBranding();
  const adminDefaultThemeId = settings?.appearance?.defaultTheme || DEFAULT_THEME_ID;
  const [userOverrideId, setUserOverrideId] = useState<string | null>(null);

  // Read the browser-local override once on mount — kept out of the
  // server-rendered pass so hydration always starts from the admin default.
  useEffect(() => {
    setUserOverrideId(localStorage.getItem(THEME_OVERRIDE_KEY));
  }, []);

  // Precedence: user override -> admin default -> base default.
  const themeId = userOverrideId || adminDefaultThemeId;

  // CSS alone renders the theme (see [data-theme='...'] blocks in
  // globals.css) — this only ever flips one attribute, so switching is
  // instant and needs no re-render of the app below it.
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

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
