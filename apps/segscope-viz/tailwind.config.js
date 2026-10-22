/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#ffffff',
        panel: '#ffffff',
        panel2: '#f8f9fb',
        edge: '#e5e7eb',
        accent: '#ff6a00',
        accent2: '#1677ff',
        good: '#00875a',
        warn: '#b86e00',
        bad: '#cf382d',
        muted: '#667085',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
