import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: "#03040a",
          900: "#07090f",
          800: "#0d1018",
          700: "#131720",
          600: "#1a2030",
          500: "#222840",
        },
        pylon: {
          cyan: "#00e5ff",
          "cyan-dim": "#00b8cc",
          violet: "#b44dff",
          "violet-dim": "#8c3acc",
          amber: "#ffaa00",
          "amber-dim": "#cc8800",
          green: "#00ff9d",
          red: "#ff4560",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "pylon-cyan": "0 0 20px rgba(0,229,255,0.3), 0 0 60px rgba(0,229,255,0.1)",
        "pylon-violet": "0 0 20px rgba(180,77,255,0.3), 0 0 60px rgba(180,77,255,0.1)",
        "pylon-amber": "0 0 20px rgba(255,170,0,0.3), 0 0 60px rgba(255,170,0,0.1)",
      },
      animation: {
        "pylon-pulse": "pylonPulse 2s ease-in-out infinite",
        "data-flow": "dataFlow 1.5s linear infinite",
        "glow-cyan": "glowCyan 3s ease-in-out infinite",
      },
      keyframes: {
        pylonPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        dataFlow: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        glowCyan: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0,229,255,0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(0,229,255,0.6), 0 0 80px rgba(0,229,255,0.2)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
