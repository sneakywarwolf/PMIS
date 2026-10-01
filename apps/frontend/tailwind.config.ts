import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic theme tokens — the only colors new code should reach
        // for (see src/lib/themes.ts for the token set / values per theme).
        cyber: {
          bg: 'var(--color-bg)',
          surface: 'var(--color-surface)',
          'surface-hover': 'var(--color-surface-hover)',
          sidebar: 'var(--color-sidebar)',
          'sidebar-hover': 'var(--color-sidebar-hover)',
          card: 'var(--color-surface)',
          border: 'var(--color-border)',
          'border-active': 'var(--color-border-active)',
          primary: 'var(--color-primary)',
          'primary-hover': 'var(--color-primary-hover)',
          secondary: 'var(--color-secondary)',
          accent: 'var(--color-accent)',
          'accent-secondary': 'var(--color-accent-secondary)',
          danger: 'var(--color-danger)',
          warning: 'var(--color-warning)',
          info: 'var(--color-info)',
          success: 'var(--color-success)',
          muted: 'var(--color-text-muted)',
        },
        // Retrofit bridge: the app was built almost entirely with raw
        // Tailwind gray/emerald/red/blue/cyan/amber/purple utility classes
        // instead of the cyber-* tokens above. Rather than rewriting every
        // component, the exact shades those classes use are pointed at the
        // same theme variables — so bg-gray-900, text-emerald-400, etc.
        // retheme for free. New code should prefer the cyber-* tokens
        // directly; this bridge only exists so themes reach the *existing*
        // UI without a full rewrite. Only shades actually used in the app
        // are remapped — table below is 1:1 with the CSS vars.
        gray: {
          100: 'var(--color-text-primary)',
          200: 'var(--color-text-primary)',
          300: 'var(--color-text-secondary)',
          400: 'var(--color-text-secondary)',
          500: 'var(--color-text-muted)',
          600: 'var(--color-border-active)',
          700: 'var(--color-border)',
          800: 'var(--color-surface-hover)',
          900: 'var(--color-surface)',
          950: 'var(--color-bg)',
        },
        emerald: {
          300: 'var(--color-accent-secondary)',
          400: 'var(--color-accent)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary-hover)',
        },
        blue: {
          400: 'var(--color-info)',
          500: 'var(--color-secondary)',
          600: 'var(--color-secondary)',
        },
        cyan: {
          300: 'var(--color-accent-secondary)',
          400: 'var(--color-accent-secondary)',
        },
        red: {
          300: 'var(--color-danger)',
          400: 'var(--color-danger)',
          500: 'var(--color-danger)',
          600: 'var(--color-danger)',
        },
        yellow: {
          400: 'var(--color-warning)',
        },
        amber: {
          400: 'var(--color-warning)',
        },
        purple: {
          600: 'var(--color-accent-secondary)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(16, 185, 129, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
