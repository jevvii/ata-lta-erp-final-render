import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const fileEnv = loadEnv(mode, process.cwd(), 'ERP_');
  const configuredApi = process.env.ERP_API_BASE_URL || fileEnv.ERP_API_BASE_URL;
  if (command === 'build' && !configuredApi) {
    throw new Error(
      'ERP_API_BASE_URL is required for a production build. Use npm run build:spa:staging or build:spa:main from the repository root.'
    );
  }
  const apiBaseUrl = (configuredApi || 'http://127.0.0.1:3000/v1').replace(/\/+$/, '');
  const parsedApi = new URL(apiBaseUrl);
  if (
    !['http:', 'https:'].includes(parsedApi.protocol) ||
    parsedApi.pathname !== '/v1' ||
    parsedApi.search ||
    parsedApi.hash ||
    parsedApi.username ||
    parsedApi.password
  ) {
    throw new Error('ERP_API_BASE_URL must be an HTTP(S) origin followed by /v1.');
  }
  return {
    plugins: [
      react(),
      {
        name: 'deployment-metadata',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'deployment.json',
            source: JSON.stringify({
              frontend: 'enterprise-v2',
              apiBaseUrl,
              commit: process.env.RENDER_GIT_COMMIT || null,
            }),
          });
        },
      },
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 8081,
      strictPort: true,
      host: true,
      fs: {
        allow: ['..', '/home/deutz/Migration_Final-render'],
      },
    },
    preview: {
      port: 8081,
      strictPort: true,
    },
    define: {
      'import.meta.env.ERP_API_BASE_URL': JSON.stringify(apiBaseUrl),
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query', 'zustand'],
          },
        },
      },
    },
  };
});
