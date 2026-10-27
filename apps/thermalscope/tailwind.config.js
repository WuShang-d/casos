/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#ff6a00',
        panel: '#ffffff',
        edge: '#e7e9ee',
        muted: '#86909c',
      },
    },
  },
  plugins: [],
}
