## ビルドについて
このプロジェクトではViteの開発サーバーを使用し、変更をHMRで即時反映するようにしてください。
HMRのため、毎回サーバーを再起動する必要はありません。必要だと判断したときだけ再起動してください。

## テストについて
実装後の動作確認では、まずcurlコマンドやPlaywrightのヘッドレスモードを使用して、
サーバーが正しく起動されていること、想定通りの結果が返ってきていることを確認してください。
その後実際にブラウザを起動し、動作を確認してください。

動作確認時に使用したスクリーンショットは、正しく動いていることを確認できるものだけを残し、
バグやその他問題を確認したものは修正後に削除してください。

クリッピングの動作確認を行うときは、
選択範囲: W139.6903 S35.6997 E139.6906 N35.7000
などの非常に狭い範囲の選択を行い、いくつかの建物だけが表示されていることを確認してください。

## 開発サーバーの起動について
herdrでバックグラウンド起動/終了する。`Start-Process`/`&`は使わない。SKILL: `.agents/skills/herdr/SKILL.md`
```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus  # → pane_id取得
herdr pane run <pane_id> "npm run dev:frontend 2>&1"
herdr pane wait-output <pane_id> --match "ready in" --timeout 30000
herdr pane read <pane_id> --source recent-unwrapped --lines 80  # ログ確認
# 終了
herdr pane send-keys <pane_id> ctrl+c
herdr pane close <pane_id>
```

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

### ブラウザが localhost の開発サーバーにアクセスできない

**症状**: curl は通るが、Chrome/Firefox/Edge で localhost の HTTP サーバーに
アクセスするとサブリソースが `(保留中)` のまま読み込まれない。

**原因**: TCP 輻輳制御プロバイダが **BBR2** に設定されていると、ループバック
（RTT ≒ 0）で BBR2 の ProbeRTT 処理がハングし、ブラウザの並列サブリソース
取得が停止する。curl は単一接続のため回避できていた。

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

**備考**: Vite の `host` 設定を `0.0.0.0` から `127.0.0.1` に変えても症状は
変わらないので注意。根本原因は BBR2 である。

## 参照コード（読み取り専用）

- ~/Documents/plateau-streaming-tutorial
- ~/Documents/plateau-catalog-generator

PLATEAU公式のCesium/データカタログAPI実装。参考にするのみで、編集・変更は禁止。
