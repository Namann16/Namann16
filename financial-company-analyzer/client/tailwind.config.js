/** @type {import('tailwindcss').Config} */

/*
 * Apple Human Interface Guidelines token layer.
 *
 * The three HIG principles drive every decision below:
 *
 *   Clarity   — one legible type scale, generous negative space, colour reserved for meaning.
 *   Deference — the interface recedes; content owns the screen. Chrome is translucent material,
 *               cards are surfaces rather than boxes, and nothing decorative competes with a figure.
 *   Depth     — hierarchy comes from layered surfaces and hairline separators, not from borders.
 *
 * The scale is the **macOS** type scale, not iOS. iOS Body at 17pt is correct for a phone held at
 * arm's length; this is a dense desktop data tool read in columns, which is what the macOS 13pt
 * scale exists for. Apple's own data-heavy apps — Numbers, Stocks, Console — use it.
 *
 * Token NAMES are unchanged from the previous system on purpose. Seventeen pages reference
 * `ink-500`, `accent-700`, `positive-600`; remapping the values rather than renaming the tokens
 * moves the whole application to the Apple palette without touching a single page file, which is
 * both far less risky and far easier to review.
 */

// Apple system colours, as published for light and dark appearance.
const systemLight = {
  blue: '#007AFF', green: '#34C759', indigo: '#5856D6', orange: '#FF9500',
  pink: '#FF2D55', purple: '#AF52DE', red: '#FF3B30', teal: '#30B0C7', yellow: '#FFCC00',
};
const systemDark = {
  blue: '#0A84FF', green: '#30D158', indigo: '#5E5CE6', orange: '#FF9F0A',
  pink: '#FF375F', purple: '#BF5AF2', red: '#FF453A', teal: '#40C8E0', yellow: '#FFD60A',
};

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        system: { light: systemLight, dark: systemDark },

        /*
         * `ink` is the neutral ramp. Light steps are Apple's systemGray 6→1 followed by the label
         * greys; dark steps run the other way through the dark systemGrays. The two ends are the
         * grouped backgrounds, so `ink-50` is a page and `ink-950` is a page in dark mode.
         */
        ink: {
          50: '#F2F2F7',   // systemGroupedBackground (light) — the page
          100: '#E5E5EA',  // systemGray5
          200: '#D1D1D6',  // systemGray4 — hairline separators
          300: '#C7C7CC',  // systemGray3 — opaque separator
          400: '#AEAEB2',  // systemGray2 — secondary label in DARK mode (7.69:1 on #1C1C1E)
          /*
           * Apple's systemGray (#8E8E93) is the published secondaryLabel colour, but it measures
           * 3.26:1 on white and 2.92:1 on the grouped background — below WCAG AA for body text.
           * Apple carries it because iOS and macOS offer an "Increase Contrast" setting that
           * darkens it system-wide; a web page has no such switch. This is the next step down the
           * same grey ramp, which clears AA on both surfaces (5.23:1 on white, 4.69:1 on #F2F2F7)
           * and is still unmistakably an Apple grey.
           */
          500: '#6C6C70',  // secondary label in LIGHT mode
          600: '#636366',  // dark systemGray2 — tertiary ink on white (5.99:1)
          700: '#48484A',  // dark systemGray3
          800: '#2C2C2E',  // tertiarySystemGroupedBackground (dark)
          900: '#1C1C1E',  // secondarySystemGroupedBackground (dark) — a card in dark mode
          950: '#000000',  // systemGroupedBackground (dark) — the page in dark mode
        },

        // systemBlue, the one interactive colour. Apple uses a single accent for every control.
        accent: {
          50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#7CC0FF',
          400: '#409CFF',  // accessible systemBlue (dark)
          500: '#0A84FF',  // systemBlue (dark appearance)
          600: '#007AFF',  // systemBlue (light appearance) — the canonical accent
          700: '#0062CC', 800: '#0040DD', 900: '#003087',
        },

        // Semantic colours carry financial meaning and nothing else. systemGreen / systemRed /
        // systemOrange, stepped so they can serve both as fills and as legible text.
        positive: {
          50: '#EBFAEF', 100: '#D1F4DC', 200: '#A7E9BC', 300: '#6DDC93',
          400: '#30D158', 500: '#34C759', 600: '#248A3D', 700: '#1C6E31', 800: '#155625', 900: '#0F3F1B',
        },
        negative: {
          50: '#FFEFEE', 100: '#FFDAD7', 200: '#FFB4AE', 300: '#FF8A80',
          400: '#FF453A', 500: '#FF3B30', 600: '#D70015', 700: '#A90011', 800: '#83000D', 900: '#5C0009',
        },
        caution: {
          50: '#FFF6E5', 100: '#FFE9BF', 200: '#FFD38A', 300: '#FFB84D',
          400: '#FF9F0A', 500: '#FF9500', 600: '#C93400', 700: '#9E2900', 800: '#7A2000', 900: '#561600',
        },
      },

      fontFamily: {
        // SF Pro where it exists, which is every Apple device. `-apple-system` resolves to the
        // real system face rather than a webfont approximation, so text is rendered by the same
        // engine and optical sizes Apple ships.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display',
          'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        numeric: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      fontSize: {
        /*
         * The macOS text styles, with Apple's own line heights and optical tracking. Apple tightens
         * tracking as size grows and loosens it below 13pt, which is why the large steps carry a
         * negative letterSpacing and the small ones a positive one.
         */
        'caption-2': ['0.625rem', { lineHeight: '0.8125rem', letterSpacing: '0.006em' }],   // 10/13
        'caption-1': ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.005em' }],   // 11/14
        footnote: ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.004em' }],      // 11/14
        subheadline: ['0.75rem', { lineHeight: '0.9375rem', letterSpacing: '0.003em' }],    // 12/15
        callout: ['0.8125rem', { lineHeight: '1rem', letterSpacing: '0' }],                 // 13/16
        body: ['0.8125rem', { lineHeight: '1.0625rem', letterSpacing: '0' }],               // 13/17
        headline: ['0.8125rem', { lineHeight: '1rem', letterSpacing: '-0.002em' }],         // 13/16 semibold
        'title-3': ['0.9375rem', { lineHeight: '1.25rem', letterSpacing: '-0.006em' }],     // 15/20
        'title-2': ['1.0625rem', { lineHeight: '1.375rem', letterSpacing: '-0.012em' }],    // 17/22
        'title-1': ['1.375rem', { lineHeight: '1.625rem', letterSpacing: '-0.018em' }],     // 22/26
        'large-title': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.022em' }],     // 26/32

        // Aliases the existing pages already use, remapped onto the scale above.
        '2xs': ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.005em' }],
        xs: ['0.75rem', { lineHeight: '0.9375rem' }],
        sm: ['0.8125rem', { lineHeight: '1.0625rem' }],
        base: ['0.8125rem', { lineHeight: '1.0625rem' }],
        kpi: ['1.375rem', { lineHeight: '1.625rem', letterSpacing: '-0.018em' }],
        'kpi-lg': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.022em' }],
        display: ['1.375rem', { lineHeight: '1.625rem', letterSpacing: '-0.018em' }],
      },

      borderRadius: {
        // Apple's continuous-curvature radii. Larger than web convention at every size, because a
        // squircle reads tighter than a circular arc of the same nominal radius.
        DEFAULT: '0.375rem',
        md: '0.4375rem',   // 7 — inline controls
        lg: '0.625rem',    // 10 — buttons, fields
        xl: '0.75rem',     // 12 — cards
        '2xl': '1.125rem', // 18 — sheets, modals
        '3xl': '1.5rem',   // 24 — hero surfaces
      },

      boxShadow: {
        /*
         * Deference: elevation is almost imperceptible. A card sits on the grouped background and
         * is distinguished by BEING a lighter surface, not by a border or a drop shadow. The shadow
         * only keeps a white card from dissolving into a light page.
         */
        card: '0 0.5px 1px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.03)',
        raised: '0 2px 6px rgba(0, 0, 0, 0.05), 0 8px 24px -8px rgba(0, 0, 0, 0.10)',
        // A sheet floats clearly above the content it covers.
        sheet: '0 12px 48px -12px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.10)',
        // The moving thumb of a segmented control.
        segment: '0 1px 3px rgba(0, 0, 0, 0.10), 0 0.5px 1px rgba(0, 0, 0, 0.08)',
        inset: 'inset 0 0.5px 0 0 rgba(255, 255, 255, 0.5)',
      },

      transitionTimingFunction: {
        // Apple's standard curve, and the gentle overshoot used when a control responds to touch.
        apple: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        spring: 'cubic-bezier(0.34, 1.26, 0.64, 1)',
      },
      transitionDuration: { 150: '150ms', 250: '250ms', 350: '350ms' },

      backdropBlur: {
        // Apple's material thicknesses.
        thin: '10px',
        regular: '20px',
        thick: '30px',
      },
    },
  },
  plugins: [],
};
