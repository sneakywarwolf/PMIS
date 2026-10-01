// Central theme-token layer: every theme is one flat set of semantic colors,
// with identical keys across themes. Adding a theme = adding one entry here;
// nothing else (components, Tailwind config, CSS) needs to change.
export interface ThemeTokens {
  background: string;
  surface: string;
  surfaceHover: string;
  sidebar: string;
  sidebarHover: string;
  primary: string;
  primaryHover: string;
  secondary: string;
  accent: string;
  accentSecondary: string;
  border: string;
  borderActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface Theme {
  id: string;
  label: string;
  swatch: string; // representative color for the theme picker
  colors: ThemeTokens;
}

// "dark" reproduces the app's existing look exactly — the base/default
// theme until an admin picks something else.
export const THEMES: Theme[] = [
  {
    id: 'dark',
    label: 'Dark (Default)',
    swatch: '#10B981',
    colors: {
      background: '#0A0F1A',
      surface: '#111827',
      surfaceHover: '#1F2937',
      sidebar: '#111827',
      sidebarHover: '#1F2937',
      primary: '#10B981',
      primaryHover: '#059669',
      secondary: '#06B6D4',
      accent: '#34D399',
      accentSecondary: '#22D3EE',
      border: '#1F2937',
      borderActive: '#10B981',
      textPrimary: '#F8FAFC',
      textSecondary: '#9CA3AF',
      textMuted: '#6B7280',
      success: '#22C55E',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#38BDF8',
    },
  },
  {
    id: 'midnight-azure',
    label: 'Midnight Azure',
    swatch: '#3B82F6',
    colors: {
      background: '#0A1628',
      surface: '#122544',
      surfaceHover: '#1A3358',
      sidebar: '#08111F',
      sidebarHover: '#16294A',
      primary: '#3B82F6',
      primaryHover: '#2563EB',
      secondary: '#1D4ED8',
      accent: '#00D4FF',
      accentSecondary: '#38BDF8',
      border: '#2C4A73',
      borderActive: '#00D4FF',
      textPrimary: '#F8FAFC',
      textSecondary: '#CBD5E1',
      textMuted: '#94A3B8',
      success: '#22C55E',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#38BDF8',
    },
  },
  {
    id: 'obsidian-turquoise',
    label: 'Obsidian Turquoise',
    swatch: '#14B8A6',
    colors: {
      background: '#060B0B',
      surface: '#0E1717',
      surfaceHover: '#172424',
      sidebar: '#050909',
      sidebarHover: '#142020',
      primary: '#14B8A6',
      primaryHover: '#0D9488',
      secondary: '#0F766E',
      accent: '#2DD4BF',
      accentSecondary: '#22D3EE',
      border: '#2C4443',
      borderActive: '#14B8A6',
      textPrimary: '#F1F5F5',
      textSecondary: '#CBD5D5',
      textMuted: '#9CA3AF',
      success: '#22C55E',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#22D3EE',
    },
  },
  {
    id: 'copper-noir',
    label: 'Copper Noir',
    swatch: '#F59E0B',
    colors: {
      background: '#0A0908',
      surface: '#16120D',
      surfaceHover: '#241C13',
      sidebar: '#090807',
      sidebarHover: '#201A12',
      primary: '#F59E0B',
      primaryHover: '#D97706',
      secondary: '#B45309',
      accent: '#FB923C',
      accentSecondary: '#FBBF24',
      border: '#4A3823',
      borderActive: '#F59E0B',
      textPrimary: '#F5F5F4',
      textSecondary: '#D6D3D1',
      textMuted: '#A8A29E',
      success: '#22C55E',
      warning: '#FBBF24',
      danger: '#EF4444',
      info: '#38BDF8',
    },
  },
  {
    // Distinct "brushed steel" identity: desaturated cool grays (not the
    // saturated navy of Midnight Azure) with a silvery, lighter blue accent.
    id: 'titanium-flux',
    label: 'Titanium Flux',
    swatch: '#58A6FF',
    colors: {
      background: '#0D1117',
      surface: '#161B22',
      surfaceHover: '#21262D',
      sidebar: '#0A0D12',
      sidebarHover: '#1C2128',
      primary: '#58A6FF',
      primaryHover: '#388BFD',
      secondary: '#6E7681',
      accent: '#A5D6FF',
      accentSecondary: '#79C0FF',
      border: '#30363D',
      borderActive: '#58A6FF',
      textPrimary: '#F0F6FC',
      textSecondary: '#C9D1D9',
      textMuted: '#8B949E',
      success: '#3FB950',
      warning: '#D29922',
      danger: '#F85149',
      info: '#58A6FF',
    },
  },
  {
    // Distinct "neon cyberpunk" identity: true-black base with vivid,
    // saturated neon greens/cyan (not the same emerald-500 as base Dark).
    id: 'quantum-emerald',
    label: 'Quantum Emerald',
    swatch: '#00FF9C',
    colors: {
      background: '#000000',
      surface: '#0D1410',
      surfaceHover: '#16211A',
      sidebar: '#000000',
      sidebarHover: '#101712',
      primary: '#00FF9C',
      primaryHover: '#00D482',
      secondary: '#00B368',
      accent: '#39FF14',
      accentSecondary: '#00FFF0',
      border: '#24382E',
      borderActive: '#00FF9C',
      textPrimary: '#E8FFF5',
      textSecondary: '#A8FFDB',
      textMuted: '#6B9C87',
      success: '#00FF9C',
      warning: '#FFD60A',
      danger: '#FF3B3B',
      info: '#00FFF0',
    },
  },
  {
    id: 'holographic-noir',
    label: 'Holographic Noir',
    swatch: '#A855F7',
    colors: {
      background: '#0A0912',
      surface: '#161325',
      surfaceHover: '#221D38',
      sidebar: '#08070F',
      sidebarHover: '#1D1830',
      primary: '#A855F7',
      primaryHover: '#9333EA',
      secondary: '#7C3AED',
      accent: '#22D3EE',
      accentSecondary: '#C084FC',
      border: '#453A66',
      borderActive: '#A855F7',
      textPrimary: '#F8FAFC',
      textSecondary: '#DDD6FE',
      textMuted: '#A1A1AA',
      success: '#22C55E',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#22D3EE',
    },
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME_ID = 'dark';

export function getTheme(id: string | undefined | null): Theme {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

// CSS custom-property names shared by globals.css, tailwind.config.ts and
// ThemeProvider — one place to change if a token is renamed.
export const THEME_CSS_VARS: Record<keyof ThemeTokens, string> = {
  background: '--color-bg',
  surface: '--color-surface',
  surfaceHover: '--color-surface-hover',
  sidebar: '--color-sidebar',
  sidebarHover: '--color-sidebar-hover',
  primary: '--color-primary',
  primaryHover: '--color-primary-hover',
  secondary: '--color-secondary',
  accent: '--color-accent',
  accentSecondary: '--color-accent-secondary',
  border: '--color-border',
  borderActive: '--color-border-active',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textMuted: '--color-text-muted',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  info: '--color-info',
};
