/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f4f7fb',
        ink: '#182033',
        muted: '#697386',
        line: '#d9e0eb',
        cobalt: '#3155d9',
        'cobalt-soft': '#e8edff',
        mint: '#15856f',
        'mint-soft': '#e1f3ee',
        ember: '#c95745',
        'ember-soft': '#fbe9e5',
      },
      boxShadow: {
        card: '0 1px 2px rgba(24, 32, 51, 0.04), 0 12px 32px rgba(24, 32, 51, 0.055)',
      },
      fontFamily: {
        sans: ['Avenir Next', 'Avenir', 'Segoe UI', 'sans-serif'],
        display: ['Arial Narrow', 'Avenir Next Condensed', 'Segoe UI', 'sans-serif'],
        mono: ['SFMono-Regular', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
