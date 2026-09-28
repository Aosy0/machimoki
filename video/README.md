# machimoki video

Remotion による動画レンダリング用の独立パッケージ。root の npm workspaces には含めない。

## セットアップ

```bash
npm install
npx remotion browser ensure
```

## 運用手順

```bash
npm run studio        # プレビュー（Remotion Studio）
npm run render        # MachimokiDemo を out/machimoki-demo.mp4 に書き出し
npm run render:smoke  # SmokeTest を out/smoke.mp4 に書き出し（3秒・動作確認用）
```

## フォント

`public/fonts/` に以下をローカル同梱している（レンダリング時のネットワーク依存を排除するため）。
読み込みは `src/fonts.ts`。

- `NotoSansJP-Regular.ttf` / `NotoSansJP-Bold.ttf` — 見出し・本文（family `NotoSansJP`、weight 400/700）
- `IBMPlexMono-Regular.ttf` / `IBMPlexMono-Medium.ttf` — データ・座標・実寸・検証値・CLI（family `IBMPlexMono`、weight 400/500）
- `OFL.txt` — IBM Plex Mono のライセンス（SIL OFL 1.1）

再ダウンロード元:

```bash
# Noto Sans JP（UA を付けないと TTF URL が返る）
curl -s "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap"
```

- IBM Plex Mono: https://github.com/IBM/plex （Releases の TTF。OFL）

## 版管理

- 追跡する: `src/`、`public/fonts/`、`tools/`、`STORYBOARD.md`、`package.json`
- 追跡しない（`.gitignore`）: `node_modules/`、`out/`（レンダリング出力）、`public/captures/`（実アプリのキャプチャ素材）
- **レンダリング結果は上書きされる**ため、提出・比較用に残す場合は `out/` 内で版管理された名前に複製する
  （例: `out/machimoki-demo-v2-2026-09-28.mp4`）

## コンポジション契約

- `MachimokiDemo`: 1920x1080, 30fps, 1800 frames（60秒）
- `SmokeTest`: 1920x1080, 30fps, 90 frames（3秒）

これら ID と仕様は変更しないこと。
