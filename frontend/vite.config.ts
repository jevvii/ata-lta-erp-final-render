import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
    'import.meta.env.ERP_API_BASE_URL': JSON.stringify(
      process.env.ERP_API_BASE_URL || 'https://ata-lta-erp-api-staging.onrender.com/v1'
    ),
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
});
