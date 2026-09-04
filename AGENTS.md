## ビルドについて
このプロジェクトではViteの開発サーバーを使用し、変更をHMRで即時反映するようにしてください。
HMRのため、毎回サーバーを再起動する必要はありません。必要だと判断したときだけ再起動してください。

## テストについて
実装後の動作確認では、まずcurlコマンドやPlaywrightのヘッドレスモードを使用して、
サーバーが正しく起動されていること、想定通りの結果が返ってきていることを確認してください。
その後実際にブラウザを起動し、動作を確認してください。

動作確認時に使用したスクリーンショットは、正しく動いていることを確認できるものだけを残し、
バグやその他問題を確認したものは修正後に削除してください。

## 実装について
データの取得や描画が冗長的にならないようにしてください。
到達不可能で死んでいるコードがないようにしてください。

## 開発サーバーの起動について
まずはすでにサーバーが起動していないか確認すること。
サーバーの起動は別ダブなどバックグラウンドで起動すること。
```bash
npm run dev
```
でWebサーバーとAPIサーバーの両方を起動できる。

## Core/CLI/API について

`core/` ワークスペースにブラウザ非依存のヘッドレスパイプラインがある。
PLATEAU 3D Tiles + Cesium地形から 3MF/STL を生成し、メッシュ検査も行う。

### コマンド

```bash
# APIサーバー起動（port 3000）
npm run dev:api

# CLI: エクスポート（stdoutはログ、--json はないが結果はファイルに出力）
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 --flatten-bottom --format 3mf \
  --output model.3mf

# CLI: 検証（JSONはstdout、ログはstderr）
npx tsx core/src/cli/index.ts validate --file model.3mf --json
```

### APIエンドポイント

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/export` | JSON body → 3MF/STLバイナリを返す |
| POST | `/api/validate` | multipart file → 検査結果JSONを返す |

### 検査の合否ルール

- **pass**: open_edges=0, non_manifold_edges=0, self_intersections=0, numShells=1
- **warning**: 同上だが numShells>1（複数シェル）
- **fail**: open_edges>0 または non_manifold_edges>0 または self_intersections>0

### テスト

```bash
npm run test -w core   # 47 tests
```

## AIエージェント用 SKILL

`skills/machimoki-pipeline.md` に SKILL 文書がある。
AIエージェントが `machimoki-pipeline` をトリガーすると、
normalize → export → validate → judge のワークフローを自動実行できる。
CLI/API の呼び出し手順と合否ルールが記載されている。

## 既知の問題

詳細は `README.md` の「補足」セクションを参照。

## 参照コード（読み取り専用）

- ~/Documents/plateau-streaming-tutorial
- ~/Documents/plateau-catalog-generator

PLATEAU公式のCesium/データカタログAPI実装。参考にするのみで、編集・変更は禁止。

## Architecture Rules

3層構造を維持する。詳細は `README.md` の Architecture セクションを参照。

- frontend: UI/3Dレンダリングのみ。重い演算禁止
- core: メッシュ生成/検査。ブラウザAPI禁止
- worker: 静的配信/軽量プロキシ。重い演算禁止
- 依存関係: frontend -> core (API), worker -> frontend/core (Proxy)
