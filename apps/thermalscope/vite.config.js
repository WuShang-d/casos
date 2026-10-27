import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'build' },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:25176' } },
})
