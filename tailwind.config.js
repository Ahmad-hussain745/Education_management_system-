/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        ink: "#0F1E3D",
        royal: "#2454C7",
        "royal-dark": "#1B3F9E",
        "soft-blue": "#E4ECFB",
        paper: "#F3F6FC",
        sage: "#16915B",
        "sage-tint": "#EAF7F0",
        brick: "#DC3545",
        "brick-tint": "#FDECEE",
        gold: "#D9822B",
        "gold-tint": "#FBF1E6",
      },
    },
  },
  plugins: [],
};
