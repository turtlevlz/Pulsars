import { defineConfig } from 'vite'

// The backend does not send CORS headers, so in development the browser talks to
// /api on this server and Vite forwards it to the backend with the prefix removed
// (/api/users/2/vitals -> http://localhost:3000/users/2/vitals).
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
