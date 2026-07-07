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
- `npm run dev` を実行する際は、`Start-Process` などで別プロセス・別シェルとして起動しない。
  出力がOpenCode側で検出できずコマンドがハングし続ける。
- 直接コマンドを実行し、標準エラーも合流させる。
  例: `npx vite --host 0.0.0.0 --port 5173 2>&1`
- 起動完了メッセージ（`ready in ... ms` など）が出れば正常に立ち上がっている。
- サーバーを裏で動かし続けたい場合は `&` でバックグラウンド実行する
  （例: `node server.js &`）。

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
