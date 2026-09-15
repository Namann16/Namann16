import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // Load from the monorepo root so one .env drives both server and client.
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  // API_PROXY_TARGET is read at build time only and never reaches the bundle: the client calls
  // /api on its own origin and Vite forwards it, so no API host is compiled into the frontend.
  const apiTarget = env.API_PROXY_TARGET || `http://localhost:${env.PORT || 4000}`;

  return {
    plugins: [react()],
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // Proxying in development keeps the API origin out of the bundle entirely.
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});
