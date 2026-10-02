import { defineConfig } from 'vitest/config'

// frontendのテストはDOMを使わないためnode環境で実行する。
// cesium等のViteプラグインは不要なのでvite.config.tsは継承しない。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
