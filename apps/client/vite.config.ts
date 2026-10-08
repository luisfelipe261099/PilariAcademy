import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        // false: o servidor descobre o polo pelo Host. Com true, piloto.localhost:5173 chegaria
        // como localhost:3001 e todo polo viraria a matriz no dev.
        changeOrigin: false,
      },
    },
  },
})
