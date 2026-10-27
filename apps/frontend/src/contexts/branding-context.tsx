'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { api, useAuth } from '@/contexts/auth-context';
import { configureFormats } from '@/lib/datetime';

const DEFAULT_APP_NAME = 'PMIS - Project Management for Information Security';

interface Identity {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
}

interface Branding {
  primaryColor: string;
  roleAccentColors: Record<string, string>;
}

const DEFAULT_BRANDING: Branding = {
  primaryColor: '#10b981',
  roleAccentColors: { ADMIN: '#10b981', AVP: '#8b5cf6', TEAM_LEAD: '#3b82f6', TESTER: '#f59e0b' },
};

interface SettingsContextValue extends Branding, Identity {
  // Text before " - " in the application name (sidebar / login heading).
  shortName: string;
  // Full /settings payload, fetched once per session here so pages that
  // need other sections (workflow, appearance, ...) don't each re-fetch it.
  settings: any;
  settingsLoaded: boolean;
  // Re-reads /settings (the settings page calls it after a save so the change applies without a reload).
  refreshSettings: () => Promise<void>;
}

const DEFAULT_CONTEXT: SettingsContextValue = {
  ...DEFAULT_BRANDING,
  appName: DEFAULT_APP_NAME,
  logoUrl: '',
  faviconUrl: '',
  shortName: 'PMIS',
  settings: null,
  settingsLoaded: false,
  refreshSettings: async () => {},
};

const BrandingContext = createContext<SettingsContextValue>(DEFAULT_CONTEXT);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [publicIdentity, setPublicIdentity] = useState<Identity | null>(null);
  const pathname = usePathname();

  // Pre-login identity (login page): name/logo/favicon only, from the unauthenticated endpoint.
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    axios.get('/api/settings/public-theme', { timeout: 5000 }).then((res) => {
      if (cancelled || !res.data) return;
      setPublicIdentity({
        appName: res.data.appName || DEFAULT_APP_NAME,
        logoUrl: res.data.logoUrl || '',
        faviconUrl: res.data.faviconUrl || '',
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    // Signed out (logout, expired session, before sign-in) or a different account: nothing fetched for the previous
    // user may stay readable, and nothing is requested until a user exists.
    setBranding(DEFAULT_BRANDING);
    setSettings(null);
    setSettingsLoaded(false);
    configureFormats();
    if (!user) return;
    let cancelled = false;
    api.get('/settings').then((res) => {
      if (cancelled) return;
      if (res.data?.branding) setBranding({ ...DEFAULT_BRANDING, ...res.data.branding });
      setSettings(res.data?.settings ?? null);
    }).catch(() => {}).finally(() => { if (!cancelled) setSettingsLoaded(true); });
    return () => { cancelled = true; };
  // Keyed on the user's id, not the object: refreshUser()/checkAuth replaces the object without changing who is logged in.
  }, [user?.id]);

  useEffect(() => {
    document.documentElement.style.setProperty('--cyber-primary', branding.primaryColor);
  }, [branding.primaryColor]);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      if (res.data?.branding) setBranding({ ...DEFAULT_BRANDING, ...res.data.branding });
      setSettings(res.data?.settings ?? null);
    } catch { /* keep what is shown */ }
  }, []);

  const general = settings?.general;
  const identity: Identity = general
    ? { appName: general.appName || DEFAULT_APP_NAME, logoUrl: general.logoUrl || '', faviconUrl: general.faviconUrl || '' }
    : publicIdentity ?? { appName: DEFAULT_APP_NAME, logoUrl: '', faviconUrl: '' };
  const shortName = identity.appName.split(' - ')[0].trim() || identity.appName;

  // Date/time/number formats and table density apply app-wide; the format change re-keys the tree below so every
  // already-rendered value is formatted again.
  const formatting = settings?.formatting;
  const [formatKey, setFormatKey] = useState(0);
  const appliedFormats = useRef('');
  useEffect(() => {
    configureFormats(formatting);
    const sig = formatting ? `${formatting.dateFormat}|${formatting.timeFormat}|${formatting.numberFormat}` : '';
    // Only re-render the tree when the formats really changed (not on every settings fetch).
    const effective = sig === 'DD/MM/YYYY|24h|en-IN' ? '' : sig;
    if (effective !== appliedFormats.current) {
      appliedFormats.current = effective;
      setFormatKey((k) => k + 1);
    }
  }, [formatting?.dateFormat, formatting?.timeFormat, formatting?.numberFormat]);

  const density = settings?.appearance?.tableDensity || 'comfortable';
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // Document title (Next re-applies its static metadata title on navigation, so set it after each route change).
  useEffect(() => {
    const apply = () => { if (document.title !== identity.appName) document.title = identity.appName; };
    apply();
    // Next re-writes its static metadata title on hydration/navigation; keep the configured name on top.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [identity.appName, pathname]);

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[data-pmis-favicon]');
    if (!identity.faviconUrl) { link?.remove(); return; }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-pmis-favicon', '1');
      document.head.appendChild(link);
    }
    link.href = identity.faviconUrl;
  }, [identity.faviconUrl]);

  return (
    <BrandingContext.Provider value={{ ...branding, ...identity, shortName, settings, settingsLoaded, refreshSettings }}>
      <div key={formatKey} style={{ display: 'contents' }}>
      {children}
      </div>
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
