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
4. 設定パネルの「刻印モードを開始」を押すと、**刻印専用UI**に切り替わります（右の設定パネルは隠れ、
   3Dビュー外周にアクセント色のグローと上部バナーが出ます）。面（底面/南/北/東/西）・
   内容（地名・座標・メッシュコード・縮尺・出典・作成年・自由入力）・大きさを編集でき、
   **位置は3Dプレビュー上で刻印をドラッグして調整**します（面からはみ出すと枠線が赤くなります）。
   刻印モード中は3Dプレビューが刻印面を自動で向き、視点回転はロックされます（ホイールズームは可）。
   「反映」で3Dモデルに刻み込み、バナーの「エクスポート」で書き出します。
   「終了」で通常のプレビューに戻ります（適用済みの刻印は維持されます）。日本語対応。

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

# 底面を開口した中空シェル（LED・タッチセンサー等を内蔵する用途）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --scale 0.004545 \
  --open-bottom \
  --shell-thickness 1.6 \
  --format 3mf \
  --output shell.3mf

# 土台（地形枠）と建物部分に分割
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --open-bottom \
  --shell-thickness 1.6 \
  --split-at-ground \
  --format 3mf \
  --output model.3mf
# => model_base.3mf（地形枠）/ model_buildings.3mf（地表プレート＋建物＋平らなベース）

# メッシュの検証
npx tsx core/src/cli/index.ts validate --file model.3mf --json
```

`--open-bottom` を指定すると、地形スライスと建物の内部をくり抜き、底面が開いた
中空シェルとして出力します（外形は変わりません）。`--shell-thickness` で壁の厚み
（印刷mm）を、`--no-hollow-buildings` で建物内部の中空化の無効化を指定できます。
建物内部の空洞は底面まで貫通するため、逆さにして水を入れると建物内部まで到達します。

`--split-at-ground` を `--open-bottom` と併用すると、モデルを「地形枠」と
「建物部分（地表プレート＋建物＋平らなベース）」の2パーツに分割します。

- 地形枠は側壁＋底面リムのリングで、上端は外側（外形 O）が `terrain - 0.9t`、
  内側（空洞境界 C）が `terrain - 1.9t` の **45°マイター**です。建物側プレートの
  下面が同じ45°面で嵌まり、外周 O の継ぎ目はフラッシュのままです。枠自体に
  天井がないため、正立印刷で内部サポートが不要です。C側の壁高は
  `terrainThickness - 1.9 × shellThickness` になります（0 より大きいこと）。
- 建物部分は地表プレート＋建物に、プレート下の凹凸を埋める**短い中実ベース**を
  union したものです。プレート外周は外形 O のままで、ベースは地形枠の空洞に
  片側 0.15mm のクリアランスで嵌まります（枠の内周 C とパッド P の差が張り出し
  **約 0.15mm**）。底面は45°楔の先端（`terrain - 1.9t`）よりさらに 0.2mm 下の
  **平らな面**で、建物パーツの最下点になります（楔先端は底面から 0.2mm 浮く）。
  ベースはその分深くなりますが、分割後の底面の凹凸によるサポートを減らせます。
  合体後の高さは地形厚み＋建物高さになります。
- `--hollow-buildings`（既定）と併用しても、建物内部の空洞の開口は中空化で使った
  カッターがベースを貫通するため、ベース底面に開口が空いたままになります
  （密閉空洞にはなりません）。穴はプレートの開口と同じ位置です。
- 建物部分は**切り口（ベース底面）を下、屋根を上**にして正立印刷できます。
  屋根や地表がベッドに触れないため、天面にビルドプレート模様が転写されません。
  建物内部の空洞が不要な場合は `--no-hollow-buildings` で中実にできます。
- Web UI は完成形状のキャッシュに分割済みの2パーツも保存し、エクスポート時は
  それをそのままシリアライズします（再分割しないため、ベースの開口も保たれます）。
- `terrainThickness - shellThickness` は **2.0mm 以上**必要です。薄すぎる場合は
  エラーになります。
- 起伏が大きい範囲では、低地の建物下部が地形枠側に残ります。

### 刻印（engraving）

地形・建物の**側面または底面に文字を彫り込む**機能です。底面には中心座標・メッシュコード・
縮尺・出典などを、側面にはタイトルや地名などを刻印できます。地形を含むエクスポート
（`--terrain`）が対象です。

```bash
# 底面に中心座標を刻印（JSONを直接指定）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --engraving '{"enabled":true,"face":"bottom","lines":[{"id":"coord","text":"35.68120N 139.76710E","sizeMm":8}]}' \
  --format 3mf \
  --output engraved.3mf

# 刻印設定をJSONファイルから読み込む場合（--engraving とは併用不可）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --engraving-file engraving.json \
  --format 3mf \
  --output engraved.3mf
```

`engraving.json` の例:

```json
{
  "enabled": true,
  "face": "south",
  "lines": [
    { "id": "title", "text": "新宿区", "sizeMm": 10 },
    { "id": "scale", "text": "1:1,000  W150 x D100 x T10 mm", "sizeMm": 5 }
  ]
}
```

HTTP API でも同じJSONを `engraving` フィールドで渡せます（`defaultEngravingOptions()` を
ベースにマージし、不正な値は **400** を返します）。

```bash
curl -X POST http://localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{
    "bounds": {"west": 139.6903, "south": 35.6997, "east": 139.6906, "north": 35.7000},
    "terrainThickness": 10,
    "format": "3mf",
    "engraving": {
      "enabled": true,
      "face": "bottom",
      "lines": [{"id": "coord", "text": "35.68120N 139.76710E", "sizeMm": 8}]
    }
  }' \
  --output engraved.3mf
```

| パラメータ | 既定 | 説明 |
|---|---|---|
| `enabled` | `false` | `true` で刻印を適用。**JSONで明示しない限り刻印しません** |
| `face` | `bottom` | 面: `bottom`（底面）/ `south`（南）/ `north`（北）/ `east`（東）/ `west`（西） |
| `lines` | `[]` | 刻印する行 `{id, text, sizeMm}` の配列。`text` 内の改行は行として分割されます |
| `centerX`, `centerY` | `0.5`, `0.5` | 使用可能領域内のブロック中心（0..1） |
| `lineGapMm` | `1.5` | 行間（印刷mm） |
| `depthMm` | `0.4` | 刻印深さ（印刷mm） |
| `printProfile` | `{"nozzleMm":0.4,"layerHeightMm":0.2}` | 印刷プロファイル。FDM 0.4mmノズル・0.2mmピッチが既定 |
| `wrap` | `true` | 面の幅に収まるよう自動折り返し |

- **面の可否**: 底面は `--flatten-bottom`（または `--reflect-actual-elevation`）で平坦な
  ときだけ刻印できます。`--open-bottom` / `--split-at-ground` の底面開口時は**底面に
  刻印できません**（側面は刻印できます）。側面は地形厚みから決まる帯の高さが 6.0mm 以上
  必要です。
- **FDMの前提**: 既定は 0.4mm ノズル・0.2mm 積層ピッチです。最小線幅は 0.45mm
  （ノズル径 + 0.05mm）、既定の刻印深さは 2層分の 0.4mm です。`printProfile` で変更できます。
  最小フォントサイズは 0.4mm ノズル時に欧文 3.2mm・日本語 6.0mm です。
- **フォント**: 日本語対応の M PLUS 1p Bold（SIL Open Font License 1.1）を同梱しています
  （`core/assets/MPLUS1p-Bold.ttf`、ライセンスは `core/assets/OFL.txt`）。CLI/API はこの
  同梱フォントを自動で読み込みます。
- **3MFメタデータ**: 刻印した全文は 3MF のメタデータ（`Title` / `Description` /
  `CreationDate`）にも保存されます（面に収まらない長文も失われません。`unzip` で
  `3D/3dmodel.model` を見ると確認できます）。**STL はメタデータを持てない**ため、
  刻印テキストはファイルに保存されません。
- **失敗時**: 面が使えない・文字が面に収まらない・フォントに無い文字がある等の場合は、
  刻印だけをスキップしてエクスポートは続行します（CLIは警告をstderrに表示。APIは警告を
  レスポンスに含めませんが200を返します）。

### HTTP API

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/export` | パラメータを受け取り、3MF/STLバイナリを返却。`splitAtGround: true` 時は2パーツ入りZIP（`model_split.zip`） |
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


