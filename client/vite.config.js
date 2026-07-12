import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Read the repository-root .env, the same file the server reads, so the
  // Cloudinary cloud name cannot drift between the two. Only `VITE_`-prefixed
  // keys are ever exposed to the bundle — the API secret next to them in that
  // file stays server-side. (On Vercel the value comes from the dashboard
  // instead, where there is no file to point at.)
  envDir: '..',

  server: {
    port: 5173,
    // Proxying in dev means the browser talks to a single origin, so the
    // httpOnly auth cookies are first-party and Just Work — no CORS dance and
    // no SameSite surprises.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code; splitting it keeps
        // the long-lived chunk cacheable across deploys.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
});
