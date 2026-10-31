import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: v("void-950"),
          900: v("void-900"),
          800: v("void-800"),
          700: v("void-700"),
          600: v("void-600"),
          500: v("void-500"),
          400: v("void-400"),
        },
        slate: {
          50: v("ink-50"),
          100: v("ink-100"),
          200: v("ink-200"),
          300: v("ink-300"),
          400: v("ink-400"),
          500: v("ink-500"),
          600: v("ink-600"),
          700: v("ink-700"),
          800: v("ink-800"),
          900: v("ink-900"),
        },
        pylon: {
          cyan: v("accent"),
          "cyan-dim": v("accent-dim"),
          violet: v("remote"),
          "violet-dim": v("remote"),
          amber: v("warn"),
          "amber-dim": v("warn"),
          green: v("ok"),
          red: v("danger"),
        },
        accent: v("accent"),
        "on-accent": v("on-accent"),
      },
      opacity: {
        3: "0.03",
        4: "0.04",
        6: "0.06",
        8: "0.08",
        12: "0.12",
        35: "0.35",
        45: "0.45",
        65: "0.65",
        85: "0.85",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"SF Mono"', "Menlo", "Consolas", "monospace"],
        sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px" }],
      },
      boxShadow: {
        popover: "0 12px 32px -8px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--void-500) / 0.6)",
        modal: "0 24px 64px -12px rgb(0 0 0 / 0.65), 0 0 0 1px rgb(var(--void-500) / 0.7)",
        "pylon-cyan": "0 0 0 1px rgb(var(--accent) / 0.35)",
        "pylon-violet": "0 0 0 1px rgb(var(--remote) / 0.35)",
        "pylon-amber": "0 0 0 1px rgb(var(--warn) / 0.35)",
      },
      keyframes: {
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        indeterminate: "indeterminate 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
