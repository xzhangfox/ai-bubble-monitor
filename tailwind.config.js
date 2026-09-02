/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#C9A84C',
          light: '#E8C15A',
          lighter: '#F0D080',
          dark: '#8B6914',
          glow: 'rgba(201,168,76,0.15)',
          border: 'rgba(201,168,76,0.25)',
          muted: 'rgba(201,168,76,0.1)',
        },
        surface: {
          DEFAULT: '#141414',
          card: '#1A1A1A',
          elevated: '#222222',
        },
        bg: '#0A0A0A',
      },
      fontFamily: {
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
