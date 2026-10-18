## ビルドについて
このプロジェクトではViteの開発サーバーを使用し、変更をHMRで即時反映するようにしてください。
HMRのため、毎回サーバーを再起動する必要はありません。必要だと判断したときだけ再起動してください。

## テストについて
テストは全ワークスペースで Vitest を使用する（`npm test`）。新しいテストの書き方・
実行コマンド・絞り込み・フォーマット/lint の使い分けは `machimoki-testing` SKILL を参照。

## 動作確認について
実装後はまず `npm run verify:ui` の結果JSONで確認し、画像が必要なときだけ `--shot` を使う。
実ブラウザでの確認は最終段階のみ。手順と結果の読み方は `machimoki-verification` SKILL を参照。
スクリーンショットは動作を確認できたものだけ残し、問題を確認したものは修正後に削除する。

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
APIサーバーは `npm run dev:api`（port 3000）。コマンド・APIエンドポイント・
合否ルールの詳細は `machimoki-pipeline` SKILL を参照。

合否の要約: **pass** は open_edges / non_manifold_edges / self_intersections が
すべて0かつ numShells=1。numShells>1 は **warning**、いずれかが0より大きいと **fail**。

## AIエージェント用 SKILL

`skills/<name>/SKILL.md` にプロジェクト固有の SKILL 文書がある
（`opencode.jsonc` の `skills.paths` で読み込む）。

| SKILL | 内容 |
|-------|------|
| `machimoki-pipeline` | normalize → export → validate → judge のワークフロー。CLI/API の呼び出し手順と合否ルール |
| `machimoki-testing` | テストの書き方・実行コマンド・絞り込み・フォーマット/lint の使い分け |
| `machimoki-verification` | ヘッドレスでの範囲選択・3Dプレビュー・エクスポート確認。結果JSONの読み方と失敗時の切り分け |

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
