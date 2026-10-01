'use client';

import { useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { THEMES } from '@/lib/themes';
import { useTheme } from '@/contexts/theme-context';

export function ThemeSelector() {
  const { themeId, adminDefaultThemeId, userOverrideId, setUserTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme"
        title="Change theme"
        className="relative p-2 rounded-lg hover:bg-cyber-surface-hover text-gray-400 hover:text-white transition-colors"
      >
        <Palette className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-cyber-surface border border-cyber-border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-cyber-border">
            <p className="text-sm font-medium text-white">Theme</p>
            <p className="text-xs text-gray-500">Personal — only changes your view</p>
          </div>
          <div className="py-1 max-h-80 overflow-y-auto">
            {THEMES.map((t) => {
              const selected = themeId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setUserTheme(t.id === adminDefaultThemeId ? null : t.id); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-cyber-surface-hover hover:text-white transition-colors"
                >
                  <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: t.swatch }} />
                  <span className="flex-1 text-left">
                    {t.label}
                    {t.id === adminDefaultThemeId && <span className="ml-1.5 text-xs text-gray-500">(default)</span>}
                  </span>
                  {selected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
          {userOverrideId && (
            <button
              onClick={() => { setUserTheme(null); setOpen(false); }}
              className="w-full px-4 py-2.5 text-xs text-gray-500 hover:text-white border-t border-cyber-border transition-colors"
            >
              Reset to admin default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
