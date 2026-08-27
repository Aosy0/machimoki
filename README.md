# machimoki

PLATEAU 3D Tiles + Cesium World Terrain から 3Dプリント可能な 3MF / STL を生成するツール。地理的な矩形選択から建物と地形を統合した watertight なモデルを出力し、manifold-3d による検証までを一貫して行う。

## アーキテクチャ

```
machimoki/
├── core/        # ヘッドレスパイプライン（CLI / HTTP API / 検証）
├── frontend/    # インタラクティブな地図・プレビュー UI
└── worker/      # Cloudflare Workers（ヘルスチェック）
```

**設計思想:** 責務を分離し、重い3D演算は `core` に集約、`frontend` は UI/3Dレンダリングに専念、`worker` は静的配信/軽量プロキシに徹する。依存は `frontend → core`（HTTP API）、`worker → frontend/core`（Proxy）に限定し、逆方向の依存を禁止する。詳細なセットアップや起動手順は本READMEの後続セクションを参照。

### core

ブラウザ非依存の 3D パイプライン本体。PLATEAU の 3D Tiles（建物）と Cesium 地形から `RawMesh` を構築し、manifold-3d でブール演算・3MF/STL エクスポート・検証を行う。

- `core/src/` — フラット構成
  - `pipeline.ts` — `buildPrintableModel(bounds, options)` オーケストレーション
  - `meshBuilder.ts` — PLATEAU 3D Tiles 取得・gltf 変換
  - `terrain.ts` — Cesium 地形サンプリング（64x64 グリッド）
  - `catalog.ts` — PLATEAU カタログ API / 自治体コード解決
  - `manifoldOps.ts` — Manifold 生成・union・3MF/STL エクスポート、3MF/STL インポート
  - `buildingCapper.ts` — 建物底面キャップ・連結成分分割・頂点ウェルド
  - `stlParser.ts` / `stlWriter.ts` — STL パース/書き出し
  - `validate.ts` — `validateMesh(buffer, mimeType)` 検証
  - `types.ts` — `Bounds` / `ExportOptions` / `RawMesh` 等
  - `api/server.ts` — Hono HTTP API
  - `cli/index.ts` — Commander CLI
  - `types/draco.d.ts` — Draco 型定義
- `core/tests/` — vitest（`tests/**/*.test.ts`）
- `core/tsconfig.json` — `rootDir: ./src`, `outDir: ./dist`

### frontend

React + Vite + Cesium + Three.js によるインタラクティブ UI。地図上で矩形選択・点選択（pickPoints）・建物リスト操作を行い、`core` の API 経由でエクスポート/プレビューする。

- `frontend/src/` — `App.tsx`, `components/`（`Preview3D` / `BuildingListPanel` / `ParameterPanel` 等）, `hooks/`（`useRectangleSelection` / `usePointPicking`）, `lib/`（`clipping` / `exporter` / `catalogApi` 等）
- `frontend/vite.config.ts` — `vite-plugin-cesium`, `/api` → `http://localhost:3000` プロキシ, `host: 0.0.0.0:5173`
- HMR 有効。変更は即時反映される。

### worker

Cloudflare Workers 上の最小 Hono アプリ。現在は `/health` のみを提供。

- `worker/src/index.ts` — `Hono` / `GET /health → { status: "ok" }`
- `worker/wrangler.toml` — Wrangler 設定

## 必要環境

- Node.js 20+
- npm 10+

ルートで `npm install` すると workspaces（`frontend` / `worker` / `core`）の依存が一括でインストールされる。lockfile はルートの `package-lock.json` に一本化されている。

## 起動手順

```bash
# 依存インストール（初回のみ）
npm install

# フロントエンド（Vite HMR, http://localhost:5173）
npm run dev:frontend
# または
npm run dev -w frontend

# API サーバー（Hono, http://localhost:3000）
npm run dev:api
# または
npm run dev -w core
# 直接起動
npx tsx core/src/api/server.ts

# Worker（Wrangler dev）
npm run dev:worker
# または
npm run dev -w worker
```

`frontend` は `/api` を `http://localhost:3000` にプロキシするため、通常は `dev:frontend` と `dev:api` を併用する。herdr で別タブ起動する場合は `AGENTS.md` の手順に従う。

### ビルド

```bash
npm run build
# = npm run build -w core && npm run build -w frontend

# 個別
npm run build -w core      # tsc → core/dist
npm run build -w frontend  # tsc && vite build
```

### テスト

```bash
npm test          # npm run test -w core → vitest run
npm run test -w core -- --watch   # watch モード
```

## CLI / API

### CLI

```bash
# エクスポート（stdout はログ、成果物は --output へ）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 --flatten-bottom --format 3mf \
  --output model.3mf

# 検証（JSON は stdout、ログは stderr）
npx tsx core/src/cli/index.ts validate --file model.3mf --json
```

`export` は自動で検証を行い、`pass` 以外なら出力ファイルを削除して非ゼロ終了する（`warning: 1`, `fail: 2`）。

### HTTP API

| Method | Path | 説明 |
|--------|------|------|
| `POST` | `/api/export` | JSON body → 3MF/STL バイナリを返す |
| `POST` | `/api/validate` | multipart `file` → 検証結果 JSON を返す |

`POST /api/export` の 422 は検証失敗（`{ error, warnings, validation }`）、500 はサーバーエラー。

### 検証の合否

- **pass**: `open_edges=0`, `non_manifold_edges=0`, `self_intersections=0`, `numShells=1`
- **warning**: 同上だが `numShells>1`（複数シェル）
- **fail**: `open_edges>0` または `non_manifold_edges>0` または `self_intersections>0`（穴・非多様体・自己交差あり）

詳細は `skills/machimoki-pipeline.md` を参照。

## ディレクトリ構成

```
core/src/{pipeline,catalog,meshBuilder,terrain,manifoldOps,buildingCapper,stlParser,stlWriter,types,validate}.ts
core/src/api/server.ts
core/src/cli/index.ts
core/tests/{catalog,fixtures,manifoldOps,meshBuilder,pipeline,stlParser,stlWriter,terrain,validate}.test.ts
core/tests/{api,cli}/
frontend/src/{App,main}.tsx, components/, hooks/, lib/
worker/src/index.ts
skills/machimoki-pipeline.md
```

## 補足

- HMR 前提のため、通常は Vite の再起動は不要。必要と判断したときのみ再起動する。

### 既知の問題: ブラウザが localhost の開発サーバーにアクセスできない

**症状**: curl は通るが、Chrome/Firefox/Edge で localhost の HTTP サーバーにアクセスするとサブリソースが `(保留中)` のまま読み込まれない。

**原因**: TCP 輻輳制御プロバイダが **BBR2** に設定されていると、ループバック（RTT ≒ 0）で BBR2 の ProbeRTT 処理がハングし、ブラウザの並列サブリソース取得が停止する。curl は単一接続のため回避できていた。

**修正**（管理者 PowerShell）:
```powershell
netsh int tcp set supplemental template=Internet congestionprovider=CUBIC
netsh int tcp set supplemental template=Datacenter congestionprovider=CUBIC
netsh int tcp set supplemental template=Compat congestionprovider=CUBIC
netsh int tcp set supplemental template=DatacenterCustom congestionprovider=CUBIC
netsh int tcp set supplemental template=InternetCustom congestionprovider=CUBIC
```
再起動不要。即座に反映される。

**診断**:
```powershell
Get-NetTCPSetting | Select-Object SettingName, CongestionProvider
```
BBR2 が表示されたら上記修正を実行する。

**備考**: Vite の `host` 設定を `0.0.0.0` から `127.0.0.1` に変えても症状は変わらないので注意。根本原因は BBR2 である。
