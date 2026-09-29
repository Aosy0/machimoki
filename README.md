# machimoki

PLATEAU 3D都市モデル（建物）と地形データ（地理院タイル / PLATEAU Terrain）から、3Dプリント可能な水密（watertight）メッシュ（3MF / STL）を生成するツールです。

Webブラウザ上で直感的に範囲選択・プレビューができるほか、ヘッドレスなCLIおよびHTTP APIを通じたモデル生成・メッシュ検証にも対応しています。

---

## アーキテクチャ (Architecture)

本プロジェクトは責務分離を徹底した3層モノレポ構成（npm workspaces）を採用しています。

```
machimoki/
├── frontend/    # インタラクティブな地図・プレビュー UI（React, Cesium, Three.js）
├── core/        # ヘッドレスパイプライン・検証・CLI・API（Hono, manifold-3d）
└── worker/      # Cloudflare Workers（プロキシ・ヘルスチェック用）
```

### 3層構造の設計原則
- **frontend**: UIおよび3Dプレビューレンダリングに専念（重い幾何演算は禁止）。
- **core**: ブラウザ非依存のメッシュ生成・ブール結合・検証パイプライン（ブラウザ専用APIへの依存は禁止）。
- **worker**: 静的配信および軽量プロキシ（重い演算は禁止）。
- **依存関係**: `frontend → core`（HTTP API）、`worker → frontend/core`（Proxy）。逆方向の依存は禁止。

---

## 必要要件

- **Node.js**: 20 以上
- **npm**: 10 以上

---

## クイックスタート

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 開発サーバーの起動

```bash
npm run dev
```

上記コマンドでフロントエンドとAPIサーバーが同時に起動します。

- **Web UI**: [http://localhost:5173](http://localhost:5173)（Vite HMR）
- **API Server**: [http://localhost:3000](http://localhost:3000)（Hono）

個別起動を行う場合:
```bash
npm run dev:frontend  # フロントエンドのみ起動
npm run dev:api       # APIサーバーのみ起動
```

### 3. ビルドとテスト

```bash
# ビルド (core & frontend)
npm run build

# テスト実行 (core)
npm test
```

---

## 使い方

### Web UI
1. ブラウザで [http://localhost:5173](http://localhost:5173) を開きます。
2. 地図上でエクスポートしたいエリアを矩形選択します。
3. プレビューを確認し、3MF または STL 形式でダウンロードします。

### CLI
コマンドラインから直接モデルの生成および品質検証が可能です。

```bash
# モデルのエクスポート（経度/緯度範囲を指定）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --flatten-bottom \
  --format 3mf \
  --output model.3mf

# メッシュの検証
npx tsx core/src/cli/index.ts validate --file model.3mf --json
```

### HTTP API

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/export` | パラメータを受け取り、3MF/STLバイナリを返却 |
| `POST` | `/api/validate` | multipart `file` を受け取り、検証結果JSONを返却 |

#### 検証の合否基準
- **pass**: 穴なし・多様体・自己交差なし、かつ単一シェル（`open_edges=0`, `non_manifold_edges=0`, `self_intersections=0`, `numShells=1`）
- **warning**: 上記を満たすが複数シェル（`numShells > 1`）
- **fail**: 穴・非多様体・自己交差のいずれかが存在

---

## ライセンス・帰属（商用利用について）

本アプリは **Cesium Ion を一切使用しません**。CesiumJS（Apache 2.0）のみを使用し、地形は PLATEAU の quantized-mesh 直配信、3D Tiles は PLATEAU 公式配信、背景地図は国土地理院タイルを使用しています。そのため **Cesium Ion の商用制限の対象外**です。

- **商用利用**: 下記の帰属表示を維持する限り、商用販売・サブスクリプション等の収益化は自由に行えます（OSM公式タイルサーバーは不使用）。
- **3Dデータの出典**: `© PLATEAU`（国土交通省 Project PLATEAU）
- **背景地図の出典**: `© 国土地理院`（地理院タイル利用規約に準拠）
- **地図エンジン**: `© Cesium`（CesiumJS, Apache License 2.0）
- **本リポジトリ**: MIT License

---

## 補足

### 既知の問題: ブラウザが localhost の開発サーバーにアクセスできない場合

**症状**: `curl` は通るが、Chrome / Edge / Firefox でアクセスするとサブリソースが `(保留中)` のまま読み込まれない。

**原因**: Windows の TCP 輻輳制御プロバイダが **BBR2** に設定されている場合、ループバック（RTT ≒ 0）で ProbeRTT 処理がハングし、並列リソース取得が停止します。

**修正方法**（管理者権限の PowerShell で実行、PC再起動不要）:
```powershell
netsh int tcp set supplemental template=Internet congestionprovider=CUBIC
netsh int tcp set supplemental template=Datacenter congestionprovider=CUBIC
netsh int tcp set supplemental template=Compat congestionprovider=CUBIC
netsh int tcp set supplemental template=DatacenterCustom congestionprovider=CUBIC
netsh int tcp set supplemental template=InternetCustom congestionprovider=CUBIC
```

**診断**:
```powershell
Get-NetTCPSetting | Select-Object SettingName, CongestionProvider
```


