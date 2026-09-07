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

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    if (!user) return;
    api.get('/settings').then((res) => {
      if (res.data?.branding) setBranding({ ...DEFAULT_BRANDING, ...res.data.branding });
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    document.documentElement.style.setProperty('--cyber-primary', branding.primaryColor);
  }, [branding.primaryColor]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
