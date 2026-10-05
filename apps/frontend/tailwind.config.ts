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
        // Values use the rgb(var(...) / <alpha-value>) form (not a plain
        // var(--hex) string) so opacity-modifier utilities like
        // `bg-cyber-primary/10` or `hover:border-cyber-border-active/30`
        // actually work — Tailwind can only inject an alpha channel into a
        // color it can decompose into R/G/B, not an opaque CSS variable.
        cyber: {
          bg: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
          surface: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
          'surface-hover': 'rgb(var(--color-surface-hover-rgb) / <alpha-value>)',
          sidebar: 'rgb(var(--color-sidebar-rgb) / <alpha-value>)',
          'sidebar-hover': 'rgb(var(--color-sidebar-hover-rgb) / <alpha-value>)',
          card: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
          border: 'rgb(var(--color-border-rgb) / <alpha-value>)',
          'border-active': 'rgb(var(--color-border-active-rgb) / <alpha-value>)',
          primary: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          'primary-hover': 'rgb(var(--color-primary-hover-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--color-secondary-rgb) / <alpha-value>)',
          accent: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
          'accent-secondary': 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
          danger: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
          warning: 'rgb(var(--color-warning-rgb) / <alpha-value>)',
          info: 'rgb(var(--color-info-rgb) / <alpha-value>)',
          success: 'rgb(var(--color-success-rgb) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb) / <alpha-value>)',
        },
        // Retrofit bridge: the app was built almost entirely with raw
        // Tailwind gray/emerald/red/blue/cyan/amber/purple utility classes
        // instead of the cyber-* tokens above. Rather than rewriting every
        // component, the exact shades those classes use are pointed at the
        // same theme variables (via the rgb(.../<alpha-value>) form above,
        // so bg-emerald-500/10, hover:bg-gray-700/50 etc keep working) —
        // so bg-gray-900, text-emerald-400, etc. retheme for free. New code
        // should prefer the cyber-* tokens directly; this bridge only
        // exists so themes reach the *existing* UI without a full rewrite.
        // Only shades actually used in the app are remapped.
        gray: {
          100: 'rgb(var(--color-text-primary-rgb) / <alpha-value>)',
          200: 'rgb(var(--color-text-primary-rgb) / <alpha-value>)',
          300: 'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',
          400: 'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',
          500: 'rgb(var(--color-text-muted-rgb) / <alpha-value>)',
          600: 'rgb(var(--color-border-active-rgb) / <alpha-value>)',
          700: 'rgb(var(--color-border-rgb) / <alpha-value>)',
          800: 'rgb(var(--color-surface-hover-rgb) / <alpha-value>)',
          900: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
          950: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
        },
        emerald: {
          300: 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
          400: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
          500: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          600: 'rgb(var(--color-primary-hover-rgb) / <alpha-value>)',
        },
        blue: {
          400: 'rgb(var(--color-info-rgb) / <alpha-value>)',
          500: 'rgb(var(--color-secondary-rgb) / <alpha-value>)',
          600: 'rgb(var(--color-secondary-rgb) / <alpha-value>)',
        },
        cyan: {
          300: 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
          400: 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
        },
        red: {
          300: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
          400: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
          500: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
          600: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
        },
        yellow: {
          400: 'rgb(var(--color-warning-rgb) / <alpha-value>)',
        },
        amber: {
          400: 'rgb(var(--color-warning-rgb) / <alpha-value>)',
        },
        purple: {
          600: 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
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
