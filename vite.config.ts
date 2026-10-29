import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/media": "http://localhost:8000",
      // созвоны: локальный livekit-server --dev (на сервере этот путь проксирует Caddy)
      "/livekit": { target: "ws://localhost:7880", ws: true, rewrite: (path) => path.replace(/^\/livekit/, "") },
    },
  },
})
