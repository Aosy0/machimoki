import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { resolve, sep } from 'path'

const codegraphPath = resolve(__dirname, '../.codegraph')

export default defineConfig({
  envDir: '../',
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
    watch: {
      // .env は envDir '../'（リポジトリルート）にあるため、監視すると
      // chokidar が親ディレクトリごと fs.watch し、ルート直下の .codegraph
      // ジャンクションの stat に失敗してプロセスが落ちる。.env は変更時に
      // 再起動が必要なため監視対象から外す（.codegraph は念のため併記）。
      ignored: [
        '**/.env*',
        (filePath: string) =>
          filePath === codegraphPath || filePath.startsWith(`${codegraphPath}${sep}`),
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    // Tailscale IPや本番ドメインからのアクセスを許可
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'machimoki.aosy-minipc.theworkpc.com',
      'machimoki.aosy.f5.si',
      '100.86.253.43',
    ],
    fs: {
      allow: ['..'],
    },
  },
})
