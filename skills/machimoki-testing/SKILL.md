---
name: machimoki-testing
description: テストの書き方・実行方法（Vitest/Biome）。machimoki で新しいテストを追加する、テストの実行方法や絞り込みを知りたい、Biome/ESLint の使い分けを確認したいときに使う。Use when writing or running tests, "add a test", "run tests", "test a function", or checking formatter/linter usage.
---

# Machimoki テスト SKILL

## Overview

machimoki のテストはすべて **Vitest** で実行する。フォーマットは **Biome**、React 固有の lint は **ESLint**（frontend のみ）が担当する。実行系は3ワークスペース（core / frontend / worker）で統一されている。

## 実行コマンド

ルートから実行する。用途別スクリプトが用意されている。

| 目的 | コマンド |
|------|---------|
| 全ワークスペース | `npm test` |
| core のみ | `npm run test:core` |
| frontend のみ | `npm run test:frontend` |
| worker のみ | `npm run test:worker` |
| ファイル指定 | `npm run test:file -- src/lib/poiSearch.test.ts` |
| watch（core） | `npm run test:watch` |

- `test:file` は frontend の Vitest を対象に、指定したパスだけを実行する。
- 特定のテスト名で絞る場合は Vitest を直接使う: `npm exec --workspace frontend -- vitest run -t "部分一致"`

## テストの置き場所

- テストファイルは `*.test.ts` とし、**対象コードの隣**に置く（例: `src/lib/poiSearch.ts` → `src/lib/poiSearch.test.ts`）。
- frontend は `frontend/src/**/*.test.ts` が自動収集される（`frontend/vitest.config.ts` の `include`）。
- core は `core/tests/**/*.test.ts`、worker は `worker/tests/**/*.test.ts`。

## 単体テストの雛形（Vitest）

アサーションは **`node:assert/strict`** を使う（既存テストに合わせる。`expect` への書き換えはしない）。

```ts
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { 対象の関数 } from './対象モジュール'

describe('対象の関数', () => {
  it('期待する振る舞いを日本語で書く', () => {
    const actual = 対象の関数(入力)
    assert.equal(actual, 期待値)
  })
})
```

- `beforeEach` なども `vitest` から import する（`import { describe, it, beforeEach } from 'vitest'`）。
- 環境は `node`（jsdom なし）。DOM に依存するテストは書けない。

## DOM / 画面のテスト（E2E / Playwright）

DOM レイアウトや実ブラウザでの操作が必要なテストは Playwright を使う。frontend に基盤がある。

### 実行コマンド

| 目的 | コマンド |
|------|---------|
| E2E 実行 | `npm run test:e2e` |
| E2E UI モード | `npm run test:e2e:ui` |

- `webServer` が Vite dev（port 5173）を自動起動する。既に起動中なら再利用される。
- 初回は Chromium が必要: `npx playwright install chromium`。

### 置き場所とモック

- テストは `frontend/e2e/*.spec.ts` に置く。
- **外部APIは必ずモックする**（オフラインでも安定させるため）。`e2e/helpers/api.ts` の `mockPoiSearch(page, options?)` が OpenPOI / GSI / Photon をスタブする。
  - `facilityCount`（既定20）/ `facilityNames` / `addressCount` で候補を制御できる。

### 要素の干渉テスト（独自ヘルパー）

`e2e/helpers/overlap.ts` に再利用可能な干渉検出がある。新しいオーバーレイUIを追加したら、`others` に足すだけで回帰テストを書ける。

```ts
import { assertNoOverlap, DEFAULT_OTHER_UI } from './helpers/overlap'

// 対象要素（data-testid）が既知の他UIと重なっていないことを検証
await assertNoOverlap(page, 'facility-search-dropdown', DEFAULT_OTHER_UI(page))
```

| ヘルパー | 用途 |
|----------|------|
| `getBox(locator)` | `boundingBox()` を返す |
| `rectsOverlap(a, b, margin)` | 2矩形の重なり判定 |
| `findOverlaps(page, targetTestId, others, margin)` | 重なっている相手の名前配列を返す |
| `assertNoOverlap(page, targetTestId, others, margin)` | 重なれば失敗（矩形付き） |
| `DEFAULT_OTHER_UI(page)` | 既定の他UIセット（建物ピック等）。`[{ name, selector }]` を足して拡張 |

- `others` の `selector` は CSS 文字列でも `Locator` でもよい。
- `margin` で許容余白（px）を指定できる。

### 参考

- パネルの干渉・リサイズ追随テストは `frontend/e2e/search-panel.spec.ts` を参照。
- 主要な `data-testid`: `facility-search-input` / `facility-search-submit` / `facility-search-dropdown` / `facility-search-results` / `map2d-container` / `map2d-select-current-bounds` / `dev-badge`。

## フォーマットと lint

| ツール | 役割 | コマンド |
|--------|------|---------|
| Biome | 整形（format）＋基本 lint | `npm run format` / `npm run format:check` / `npm run lint:biome` |
| Biome | 検査＋自動修正 | `npm run lint:biome:fix` |
| ESLint | React 固有（hooks 等、frontend のみ） | `npm run lint -w frontend` |

- コード流儀: セミコロンなし・シングルクォート・2スペースインデント・行幅100（`biome.json`）。
- 変更後は `npm run format` を当ててからコミットする。

## Notes

- 実装後はまず `npm test`（または対象WSのテスト）を通し、その後必要に応じてブラウザで動作確認する。
- テストを追加したら、既存テストと合わせて全件パスすることを確認する。
