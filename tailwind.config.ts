import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        tactical: {
          obsidian: "#0B0F19",
          gunmetal: "#1A1D24",
          slate: "#334155",
          cyan: "#00E5FF",
          crimson: "#FF3366",
          amber: "#FFB300",
          green: "#00E676",
        },
      },
      boxShadow: {
        "alert-critical": "0 0 18px rgba(255, 51, 102, 0.35)",
        "alert-info": "0 0 16px rgba(0, 229, 255, 0.25)",
      },
      borderRadius: {
        tactical: "0.375rem",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Arial", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
    },
  },
};

export default config;
