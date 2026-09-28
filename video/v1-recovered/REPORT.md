# v1 Remotion ソース復元レポート

対象: `video/v1-recovered/`
入力（読み取り専用）: `video/v1-recovered/packs-raw/`（webpack 永続キャッシュの pack 退避）
作業日: 2026-09-28 / webpack 5.105.0 / Remotion 4.0.520

---

## 1. 手法

### 1.1 pack コンテナ（FileMiddleware 形式）
`webpack/lib/serialization/FileMiddleware.js` の実装どおりのバイナリ。

```
File    = Header Section*
Header  = Version(u32 LE) AmountOfSections(u32 LE) SectionSize(i32 LE)*
Section = Buffer (SectionSize バイト)
Version = 0x01637077  ("wpc\x01")
SectionSize < 0 は lazy（別ファイル格納）
```

実測（7.pack）: version=`0x01637077`、sections=1、セクション長 8,481,399、末尾まで過不足なく一致。lazy セクションなし。

### 1.2 セクション内部（BinaryMiddleware 形式）
`webpack/lib/serialization/BinaryMiddleware.js` の `_deserialize` を忠実に移植してデコード（一時スクリプト。`video/` に依存追加なし）。
ヘッダは 1 バイトで、`0x1e`=UTF-8文字列（i32長）、`0x1f`=バッファ（i32長）、`0x80|n`=短い latin1 文字列、数値/真偽/null 系など。

### 1.3 決定的な発見：モジュールは「ソースマップの sourcesContent」に原典のまま残っていた
デコード結果の文字列は最大 231 文字で、JS ソースそのものは**文字列ではなくバッファ**として格納されていた。
各バッファの多くは、モジュール単位の **ソースマップ JSON**（`{"version":3,"sources":[...],"sourcesContent":[...],"mappings":...}`）であり、
`sourcesContent` に**変換前のオリジナル TypeScript/TSX**（型注釈・ジェネリクス・`as const` 付き）がそのまま入っていた。

→ 復元は「コンパイル済み JS からの逆変換」ではなく、**原典 TSX のバイト一致取り出し**。
`React.createElement`/`jsx()` への逆変換は不要（そもそも原典が取れた）。

### 1.4 圧縮の有無
**無圧縮**。`PackFileCacheStrategy` はこのキャッシュで gzip/brotli を指定しておらず、セクション内の文字列・バッファは生の UTF-8 のまま並んでいた（日本語・`#4cc2ff`・`jsx` 等がそのまま可読）。伸長処理は不要だった。

### 1.5 走査範囲
- `7.pack`（8,481,411 B, 1 セクション）: **v1 の全 15 モジュールのソースマップを収録**
- `6.pack`（22,599 B）: v1 `Scene04Select.tsx` のソースマップ 1 件のみ。`7.pack` 抽出物と **SHA-256 完全一致**（重複）
- `4.pack`（8,165,034 B）: **v2**（ライト改訂後）のソースマップ 18 件。v1 復元には不使用
- 参考: 背景説明の「8.1MB の 6.pack」は現物では `4.pack`(8.17MB)/`7.pack`(8.48MB) に相当（ハッシュ更新で番号がずれた可能性）

---

## 2. 復元モジュール一覧と確度

`video/v1-recovered/modules/src/` に 15 ファイル。すべて**完全**（ソースマップ `sourcesContent` からの原典そのまま、バイト一致）。

| モジュール | bytes | 確度 | 主な内容 |
|---|---:|---|---|
| `config.ts` | 2745 | 完全 | COLORS(#4cc2ff/#7ee787 他), SCENES, ASSETS, VALIDATE_PLACEHOLDER, ATTRIBUTION, FONT |
| `fonts.ts` | 340 | 完全 | NotoSansJP 400/700/900 の loadFont |
| `index.ts` | 105 | 完全 | registerRoot |
| `Root.tsx` | 575 | 完全 | MachimokiDemo / SmokeTest の 2 コンポジション |
| `MachimokiDemo.tsx` | 1733 | 完全 | 8 シーンの `<Sequence>` 合成 |
| `SmokeTest.tsx` | 425 | 完全 | 日本語表示テスト |
| `components/ui.tsx` | 6975 | 完全 | 素材存在チェック, **HighlightRing**, **kenBurnsScale**, Logo/Kicker/StepChip/CaptionBar/HudChip/Attribution |
| `scenes/Scene01Title.tsx` | 2270 | 完全 | タイトル |
| `scenes/Scene02Problem.tsx` | 7043 | 完全 | 課題（「そのままでは、印刷できない。」） |
| `scenes/Scene03Solution.tsx` | 2377 | 完全 | 解決 |
| `scenes/Scene04Select.tsx` | 5621 | 完全 | STEP 1（HighlightRing） |
| `scenes/Scene05Preview.tsx` | 4775 | 完全 | STEP 2（kenBurnsScale） |
| `scenes/Scene06Export.tsx` | 7497 | 完全 | STEP 3（PASS — watertight） |
| `scenes/Scene07Showcase.tsx` | 4844 | 完全 | ショーケース |
| `scenes/Scene08Outro.tsx` | 1873 | 完全 | アウトロ（「選んで、印刷する。」） |

### 欠落
- **ソースの欠落なし**。v1 に存在した `src/**` の 15 ファイルすべてを回収。
- 画像・動画素材（`public/captures/**`）は JS キャッシュには入らないため復元対象外（現存する v2 の public/captures をそのまま利用可能）。
- v1 の `tsconfig.json` / `package.json` はソースマップ対象外。v2 のものを流用可（後述）。

---

## 3. 検証（必須マーカー）

`node video/v1-recovered/verify.mjs` を実行可能（依存なし）。結果は全 PASS:

| マーカー | 有無 | 所在 |
|---|---|---|
| `#4cc2ff` | OK | config.ts |
| `#7ee787` | OK | config.ts |
| `HighlightRing` | OK | ui.tsx, Scene04Select, Scene05Preview |
| `kenBurnsScale` | OK | ui.tsx, Scene04/05/06/07 |
| `STEP 1 — 範囲を選ぶ` | OK | Scene04Select.tsx |
| `PASS — watertight` | OK | Scene06Export.tsx |
| `選んで、印刷する。` | OK | Scene08Outro.tsx |
| `そのままでは、印刷できない。` | OK | Scene02Problem.tsx |

---

## 4. TSX への逆変換は現実的か

**不要**。原典 TSX が `sourcesContent` から直接取れたため。
参考として、`7.pack` のバッファにはコンパイル済み版（`jsx()` / `jsxs()` 呼び出し、型除去済み、`export const X = ({children}) =>`）も含まれていた（約 493KB / 5MB の ConcatSource）。仮に `sourcesContent` が無ければ、
- `jsx("div", {...})` / `jsxs(...)` → JSX への逆変換は機械的に可能（属性名・style オブジェクトはそのまま）
- ただし**型注釈は失われる**ため `React.FC` や `: string | null` 等の再付与が必要で、原典比の fidelity は落ちる。
今回はこの作業は発生していない。

---

## 5. レンダリング可能な v1 を組み立てる推奨手順

前提: `video/src-v1/**`（別レーン再構築中）と `video/src/**`（v2）には触れない。復元物は `video/v1-recovered/modules/src/**`。

1. **v1 ソースを独立ディレクトリへ配置**（例 `video/src-v1-recovered/` を新規作成）:
   `video/v1-recovered/modules/src/**` を丸ごとコピー。`Root.tsx` は `./fonts`,`./MachimokiDemo`,`./SmokeTest` を相対 import しており、15 ファイルが同階層に揃うのでそのまま解決する。
2. **エントリ**: 既存 `index.ts`（`registerRoot(RemotionRoot)`）をそのまま使用。
3. **tsconfig**: v2 の `video/tsconfig.json`（jsx: react-jsx 等）を流用可。
4. **依存**: v1 は `@remotion/fonts`・`react`・`remotion` のみ。v2 の `package.json` にすべて含まれるため**追加 install 不要**（IBM Plex Mono も v1 では未使用）。
5. **フォント**: 既存 `video/public/fonts/NotoSansJP-{Regular,Bold,Black}.ttf` をそのまま使用（v1 `fonts.ts` が参照）。
6. **素材**: 既存 `video/public/captures/**` をそのまま使用。
7. **レンダリング**: 上書き事故防止のため**出力先を分ける**。
   ```bash
   cd video
   npx remotion still  src-v1-recovered/index.ts MachimokiDemo out/v1-check.png --frame=100
   npx remotion render src-v1-recovered/index.ts MachimokiDemo out/machimoki-demo-v1.mp4 \
     --codec=h264 --crf=19 --pixel-format=yuv420p --muted --overwrite
   npx remotion ffprobe out/machimoki-demo-v1.mp4
   ```
   既存 `npm run render` は v2 (`src/index.ts`) を指すため、**触らないこと**。
8. コンポジション契約は v1 も同一（`MachimokiDemo` 1920x1080/30fps/1800、`SmokeTest` 90f）。

### 注意
- `SCENES` のフレーム境界（config.ts）は v1 版。v2 と内容が異なるため混在させない。
- `VALIDATE_PLACEHOLDER` は v1 では仮置き値（0/0/0/1）。v1 当時の実測 JSON と同値。
- ソースは `sourcesContent` 由来のため**改行・コメント・日本語コメントまで当時のまま**。整形不要。

---

## 6. 成果物一覧

- `video/v1-recovered/modules/src/**`（15 ファイル、TSX/TS 原典）
- `video/v1-recovered/strings.txt`（v1 文字列 46 件、重複排除＋ソート）
- `video/v1-recovered/REPORT.md`（本ファイル）
- `video/v1-recovered/verify.mjs`（必須マーカー検証、依存なし）
- `video/v1-recovered/_meta/modules-index.json`（各モジュールの抽出元バッファ・元ソースパス）

一時作業（成果物ではない）: `%TEMP%\opencode\v1recover\`（デコーダ・中間バッファ）
