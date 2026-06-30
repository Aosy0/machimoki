import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), cesium()],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  resolve: {
    alias: {
      'manifold-3d': 'manifold-3d/manifold.js',
    },
  },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['machimoki.aosy-minipc.theworkpc.com'],
    fs: {
      allow: ['..'],
    },
  },
})
