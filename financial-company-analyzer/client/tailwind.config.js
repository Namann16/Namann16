/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // A restrained analytical palette: one deep navy for structure, one accent for
        // interaction, and semantic colours reserved for financial meaning only.
        ink: {
          50: '#f7f8fa', 100: '#eef1f5', 200: '#dde2ea', 300: '#c2cad7',
          400: '#94a0b3', 500: '#6b788d', 600: '#4e5a6e', 700: '#3b465a',
          800: '#263041', 900: '#131b2b', 950: '#0a1120',
        },
        accent: {
          50: '#eef4fb', 100: '#d7e6f6', 200: '#b0cdec', 300: '#7fabdd',
          400: '#4d84c8', 500: '#2b64ad', 600: '#1e4d8f', 700: '#183d73',
          800: '#14304f', 900: '#0f2740',
        },
        // Semantic colours carry financial meaning and nothing else: green is never decorative.
        positive: {
          50: '#ecfdf3', 100: '#d1fadf', 200: '#a6f4c5', 300: '#6ce9a6', 400: '#32d583',
          500: '#12b76a', 600: '#039855', 700: '#027a48', 800: '#05603a', 900: '#054f31',
        },
        negative: {
          50: '#fef3f2', 100: '#fee4e2', 200: '#fecdca', 300: '#fda29b', 400: '#f97066',
          500: '#f04438', 600: '#d92d20', 700: '#b42318', 800: '#912018', 900: '#7a271a',
        },
        caution: {
          50: '#fffaeb', 100: '#fef0c7', 200: '#fedf89', 300: '#fec84b', 400: '#fdb022',
          500: '#f79009', 600: '#dc6803', 700: '#b54708', 800: '#93370d', 900: '#7a2e0e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        // Tabular figures keep financial columns aligned regardless of digit widths.
        numeric: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // A tight scale: financial screens are read in columns, so line-heights stay compact
        // and the steps between sizes are small enough to keep hierarchy without shouting.
        '2xs': ['0.6875rem', { lineHeight: '0.95rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.05rem' }],
        sm: ['0.8125rem', { lineHeight: '1.2rem' }],
        base: ['0.875rem', { lineHeight: '1.35rem' }],
        kpi: ['1.375rem', { lineHeight: '1.6rem', letterSpacing: '-0.02em' }],
        'kpi-lg': ['1.75rem', { lineHeight: '2rem', letterSpacing: '-0.025em' }],
        display: ['1.5rem', { lineHeight: '1.85rem', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        // Elevation is carried mostly by the hairline border; the shadow only lifts the card
        // off the page plane a little, so dense screens stay calm.
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.04)',
        raised: '0 8px 24px -8px rgba(16, 24, 40, 0.18), 0 2px 6px -2px rgba(16, 24, 40, 0.08)',
        inset: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.6)',
      },
      transitionDuration: { 150: '150ms' },
    },
  },
  plugins: [],
};
