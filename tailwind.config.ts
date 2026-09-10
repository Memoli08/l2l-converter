import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./shared/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Unified with globals.css :root tokens (--ink-*, --accent)
        ink: {
          950: "#070b10",
          900: "#0c1218",
          850: "#111a21",
          800: "#16222a",
          700: "#1c2742",
          600: "#2a3a5e",
        },
        brand: {
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
        },
        accent: {
          DEFAULT: "#69dfcb",
          strong: "#b1fff0",
          300: "#a9f2e5",
          400: "#69dfcb",
          500: "#3db9a6",
        },
        line: "rgba(205,225,226,0.12)",
        muted: "#82939a",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(14px) scale(0.95)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.45s ease-out both",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "toast-in": "toast-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-slow": "pulse-slow 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
