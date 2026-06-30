
## Docker Development Environment (2024-06-29)

### node:20-slim + node-gyp
- `python3`, `make`, `g++` をインストールしないと、一部のnpmパッケージ（Cesiumのネイティブ依存など）がビルドに失敗する可能性がある。
- 開発用Dockerfileでは `--no-install-recommends` と `rm -rf /var/lib/apt/lists/*` でイメージサイズを抑える。

### Volume Strategy for node_modules
- docker-compose.yml で `node_modules` を名前付きボリュームに分離することで、ホスト側の `node_modules` とコンテナ内の `node_modules` が衝突しない。
- これにより、ホストがWindows/macOSでもコンテナ内はLinuxバイナリのまま動作する。

## Vite + CesiumJS

### vite-plugin-cesium
- `vite-plugin-cesium` を使うと、CesiumJSのアセットが自動的に `/cesium` パスで配信される。
- `define: { CESIUM_BASE_URL: JSON.stringify('/cesium') }` を明示的に設定することで、開発/本番の両方でアセットパスが正しく解決される。

### CESIUM_BASE_URL
- CesiumJSはランタイムで `CESIUM_BASE_URL` から WebWorkers や Assets をロードする。
- Viteの `define` でコンパイル時定数として設定すると、インポートされたCesiumモジュール内で自動的に置換される。

## manifold-3d WASM

### Vite Configuration
- `manifold-3d` は Emscripten でビルドされた WASM モジュール。
- Viteの `optimizeDeps.exclude: ['manifold-3d']` でプリバンドルを除外しないと、WASMファイルのパス解決に失敗する。
- `resolve.alias: { 'manifold-3d': 'manifold-3d/manifold.js' }` で ES module エントリポイントを明示的に指定。
- `server.fs.allow: ['..']` で `node_modules/manifold-3d/` 内の WASM ファイルへのアクセスを許可。

### Initialization Pattern
```ts
import Module from 'manifold-3d';

Module().then((wasm) => {
  wasm.setup();
  const { Manifold } = wasm;
  // use Manifold...
});
```

## Verification Results

- `docker compose build` が成功（node:20-slim + node-gyp用依存関係を含む）
- `docker compose up -d` で開発サーバーが `http://localhost:5173` で起動
- `curl http://localhost:5173/cesium/Widgets/widgets.css` → HTTP 200
- `curl http://localhost:5173/cesium/Cesium.js` → HTTP 200
- `npx tsc --noEmit` → エラーなし
