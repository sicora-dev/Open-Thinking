/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", ".theme-dark"],
  theme: {
    extend: {
      colors: {
        cyan: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
        /* Semantic aliases mapped from CSS vars */
        bg: {
          DEFAULT: "var(--bg)",
          soft: "var(--bg-soft)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          dim: "var(--fg-dim)",
        },
        ok: "var(--ok)",
        warn: "var(--warn)",
        err: "var(--err)",
        info: "var(--info)",
        /* Keep old ink tokens for backward compat during migration */
        accent: {
          DEFAULT: "rgb(var(--accent, 6 182 212) / <alpha-value>)",
          dim: "rgb(var(--accent-dim, 8 145 178) / <alpha-value>)",
          soft: "rgb(var(--accent-soft, 14 116 144) / <alpha-value>)",
          contrast: "rgb(var(--accent-contrast, 255 255 255) / <alpha-value>)",
        },
        ink: {
          950: "rgb(var(--ink-950, 15 17 20) / <alpha-value>)",
          925: "rgb(var(--ink-925, 20 22 26) / <alpha-value>)",
          900: "rgb(var(--ink-900, 26 28 33) / <alpha-value>)",
          875: "rgb(var(--ink-875, 32 35 41) / <alpha-value>)",
          800: "rgb(var(--ink-800, 40 44 52) / <alpha-value>)",
          750: "rgb(var(--ink-750, 50 55 65) / <alpha-value>)",
          700: "rgb(var(--ink-700, 62 68 80) / <alpha-value>)",
          600: "rgb(var(--ink-600, 78 86 101) / <alpha-value>)",
          500: "rgb(var(--ink-500, 110 120 140) / <alpha-value>)",
          400: "rgb(var(--ink-400, 150 160 180) / <alpha-value>)",
          300: "rgb(var(--ink-300, 190 200 220) / <alpha-value>)",
          200: "rgb(var(--ink-200, 220 225 235) / <alpha-value>)",
          100: "rgb(var(--ink-100, 240 242 245) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};
