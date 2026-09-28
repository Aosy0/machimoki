# v1 復元の照合結果

## 結論

- v1 の原典ソース15ファイルを、webpack 永続キャッシュ（`7.pack`）の**ソースマップ `sourcesContent`** から
  **verbatim（型注釈・コメント・改行まで当時のまま）** で回収した（`modules/src/`）
- エージェントのセッション文脈から**別経路で再構築**した `../../src-v1/` と突き合わせた結果、
  **14/15 ファイルがバイト一致**。唯一 `Root.tsx` が異なるが、差分は**コンポジションIDの変更のみ**
  （`MachimokiDemo` → `MachimokiDemoV1`。v2 と共存させて再レンダリングするための意図的な変更）
- 再構築版をフルレンダリングした結果、失われた v1 動画と**バイトサイズ一致（25,616,256 bytes）**、
  参照フレーム10枚が **SHA256 一致**（画素レベルで同一）

```
Root.tsx の差分（唯一の差分）
-        id="MachimokiDemo"
+        id="MachimokiDemoV1"
```

## ファイルの関係

| パス | 内容 | コンポジションID |
|---|---|---|
| `video/v1-recovered/modules/src/` | **原典（verbatim）**。復元の来歴を証明する記録 | `MachimokiDemo` |
| `video/src-v1/` | **レンダリング用エントリ**（IDのみ変更した同一ソース） | `MachimokiDemoV1` |

## v1 の再レンダリング

```bash
cd video
npx remotion render src-v1/index.ts MachimokiDemoV1 out/machimoki-demo-v1.mp4 \
  --codec=h264 --crf=19 --pixel-format=yuv420p --muted --overwrite
```

## 復元の経緯（再発防止のための記録）

- v1 の mp4 とソースは、v2 へのリライト時に**上書きで失われた**（当時 `video/` は git 未追跡だった）
- 到達した復元経路は2つ:
  1. **webpack 永続キャッシュのパック**（`packs-raw/` に退避、v1最終修正時の `7.pack`）— ソースマップの
     `sourcesContent` に変換前の TSX が残っていたため完全回収できた
  2. **エージェントのセッション文脈**からの再構築
- 両者を突き合わせ、レンダリング結果まで含めて一致を確認した
- 現在は `video/src`（v2）と `video/src-v1`（v1）を **git で追跡**しているため、同じ事故は起きない
- `packs-raw/`（約159MB）は復元の証拠として残しているが、不要なら削除してよい（git 追跡外）
