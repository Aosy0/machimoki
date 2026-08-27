import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath: resolve(__dirname, '../node_modules/cesium/Build'),
      cesiumBuildPath: resolve(__dirname, '../node_modules/cesium/Build/Cesium/'),
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  resolve: {
    alias: [
      { find: /^manifold-3d$/, replacement: 'manifold-3d/manifold.js' },
      { find: /^@machimoki\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
    ],
  },
  optimizeDeps: {
    include: ['manifold-3d'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    allowedHosts: ['localhost', '127.0.0.1', 'machimoki.aosy-minipc.theworkpc.com'],
    fs: {
      allow: ['..'],
    },
  },
})
