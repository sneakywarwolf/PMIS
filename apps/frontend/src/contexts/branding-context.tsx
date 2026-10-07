'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api, useAuth } from '@/contexts/auth-context';

interface Branding {
  primaryColor: string;
  roleAccentColors: Record<string, string>;
}

const DEFAULT_BRANDING: Branding = {
  primaryColor: '#10b981',
  roleAccentColors: { ADMIN: '#10b981', AVP: '#8b5cf6', TEAM_LEAD: '#3b82f6', TESTER: '#f59e0b' },
};

interface SettingsContextValue extends Branding {
  // Full /settings payload, fetched once per session here so pages that
  // need other sections (workflow, appearance, ...) don't each re-fetch it.
  settings: any;
  settingsLoaded: boolean;
}

const DEFAULT_CONTEXT: SettingsContextValue = {
  ...DEFAULT_BRANDING,
  settings: null,
  settingsLoaded: false,
};

const BrandingContext = createContext<SettingsContextValue>(DEFAULT_CONTEXT);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get('/settings').then((res) => {
      if (res.data?.branding) setBranding({ ...DEFAULT_BRANDING, ...res.data.branding });
      setSettings(res.data?.settings ?? null);
    }).catch(() => {}).finally(() => setSettingsLoaded(true));
  // Keyed on the user's id, not the object: refreshUser()/checkAuth replaces the object without changing who is logged in.
  }, [user?.id]);

  useEffect(() => {
    document.documentElement.style.setProperty('--cyber-primary', branding.primaryColor);
  }, [branding.primaryColor]);

  return (
    <BrandingContext.Provider value={{ ...branding, settings, settingsLoaded }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
