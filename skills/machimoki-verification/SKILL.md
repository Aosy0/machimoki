---
name: machimoki-verification
description: machimoki の動作確認手順。ヘッドレスでの範囲選択・3Dプレビュー・エクスポート確認、結果JSONの読み方、失敗時の切り分けに使う。Use when verifying UI changes, "動作確認", "画面確認", "スクショ", "確認して", "verify UI", or checking map selection / preview / export behavior.
---

# Machimoki 動作確認 SKILL

## 原則

1. まず `npm run verify:ui` の JSON で判定する（画像は撮らない）
2. 見た目の確認が必要なときだけ `--shot` を付ける
3. 実ブラウザ（`--headed`）は最終確認のみ

サーバーは自動起動しない。未起動なら `npm run dev` を別ペインで起動してから実行する。

## 前提

- 開発サーバー: `npm run dev`（frontend 5173 + API 3000）
- 初回のみ: `npx playwright install chromium`
- preview / export は外部データを取得するためネットワークが必要

## コマンド

| 目的 | コマンド |
|---|---|
| 地図に範囲を適用して確認 | `npm run verify:ui -- --scenario map --bounds 139.6899,35.7029,139.6932,35.707` |
| Shift+ドラッグ操作の確認 | `npm run verify:ui -- --scenario drag --drag 0.2,0.2,0.7,0.7` |
| 3Dプレビュー完了待ち | `npm run verify:ui -- --scenario preview --bounds ...`（既定で完了まで待つ） |
| エクスポートまで確認 | `npm run verify:ui -- --scenario preview --bounds ... --export --export-out out.3mf` |
| 画像も保存 | 上記に `--shot` を追加（`--selector` / `--clip` で範囲を絞れる） |
| 実ブラウザで確認 | `--headed` を追加 |

- `--bounds` は `west,south,east,north`（WGS84）。
- `--drag` は地図キャンバスに対する 0〜1 の相対座標 `x1,y1,x2,y2`。
- 全フラグは `node frontend/scripts/verify-ui.mjs --help` を参照。

## 結果JSONの読み方

```json
{
  "ok": true,
  "scenario": "map",
  "selection": { "west": 139.6899, "south": 35.7029, "east": 139.6932, "north": 35.707 },
  "selectionInfo": "横 ... → ...mm",
  "pipeline": "complete",
  "consoleErrors": [],
  "pageErrors": [],
  "shot": null,
  "durationMs": 2140
}
```

| フィールド | 判定 |
|---|---|
| `ok` | `false` なら失敗。`error` を読む |
| `pageErrors` | 空であること |
| `consoleErrors` | 既定では参考情報。`--fail-on-console` で失敗扱いにできる |
| `selectionInfo` | 寸法・縮尺の表示。期待値と比較する |
| `pipeline` | preview の完了状態。`complete` 以外は待機タイムアウト等 |
| `shot` | `--shot` を付けたときだけパスが入る |

## 失敗時の切り分け

| 症状 | 対処 |
|---|---|
| `開発サーバーが起動していません` | 別ペインで `npm run dev` を起動 |
| `browserType.launch` エラー | `npx playwright install chromium` |
| `map2d-webgl-error` が出る | `--headed` で再実行。改善しなければ実ブラウザで確認 |
| preview が `timeout` | ネットワーク、APIサーバー、対象範囲のデータ有無を確認 |
| ポート競合 | `--base-url` で別ポートを指定 |

## スクリーンショット

- 保存先は `.screenshots/`（gitignore 済み）
- 動作を確認できたものだけ残し、問題を確認したものは修正後に削除する
- 添付は確認したい領域だけに絞る（`--selector` / `--clip`）

## 関連

- 回帰テストとして残す場合は `machimoki-testing` SKILL に従い `frontend/e2e/*.spec.ts` に追加する。
