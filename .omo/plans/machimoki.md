# machimoki - 作業計画

## TL;DR (人間向け)

**何ができるようになるか:** 日本の地図上でエリアを選択し、PLATEAUの3D都市データを取得して3Dプリント向け設定でプレビューし、3MFまたはSTLファイルとしてダウンロードできるブラウザベースの簡易CADツール。ログイン不要。

**なぜこのアプローチか:** PLATEAUの公式3DTilesストリーミングを利用（都市データのホスティングコストゼロ）、メッシュ処理はWebAssembly（manifold-3d）でブラウザ内完結するため重いサーバーが不要。単一画面のタブ切替でUIをシンプルに：地図でエリア選択 → 3Dプレビューに切替 → 厚みを調整 → エクスポート。

**何ができないか:** このバージョンでは中庭の自動修復は行わない（LOD1デフォルトで大部分を回避）。モデルのオーバーハングやサポート構造が必要かのチェックはしない。個別建物の編集やプロジェクトの保存もできない。ユーザーログインやクラウドストレージもなし。

**工数:** Large（大規模）
**リスク:** Medium（中程度）— 実際の都市データに対するブラウザ側メッシュ処理で、性能またはジオメトリ品質の問題が発生し、サーバー側フォールバックが必要になる可能性あり
**再確認すべき判断:** LOD1デフォルト（シンプルだが詳細度は低い）、単一画面切替（サイドバイサイドではない）、Dockerファーストの開発環境

次のステップ: この計画を承認し、`$start-work` で実行を開始する

---

> TL;DR (機械向け): 大規模工数、中程度リスク — CesiumJS + 3DTilesRendererJS + Three.js + manifold-3d WASM を用いたブラウザ側 PLATEAU→3Dプリントツールチェーン、クライアントサイド3MF/STL出力、Docker開発環境、Cloudflare Static Assetsホスティング

## Scope (スコープ)

### Must have (必須)
- シングルページWebアプリケーション（認証なし、ログインなし）
- Dockerコンテナ開発環境（Node.js + Vite）
- Cloudflare Workers StaticAssets デプロイ設定
- CesiumJSによる地図表示、PLATEAU公式3DTilesのストリーミング
- 地図上でのクリック＆ドラッグ矩形エリア選択（実世界座標で出力）
- 「地図モード」と「3Dプレビューモード」の単一画面切替
- Three.js + OrbitControls による3Dプレビューモード
- 選択エリアのPLATEAU 3D Tilesを3DTilesRendererJS経由でThree.jsに読み込み
- パラメータ調整パネル：地形厚みスライダー、底面フラット化トグル、地形含む/含まないトグル、LODセレクタ（LOD1デフォルト / LOD2）、出力形式セレクタ（3MFデフォルト / STL）
- manifold-3d WASM を用いた地形厚み付けと底面フラット化
- クライアントサイドでの3MF出力（three-3mf-exporter）とSTL出力（Three.js STLExporter）
- 出力単位：ミリメートル、Z-up、原点を選択矩形の中心に配置
- すべての非同期処理に対するローディングインジケーターとエラーメッセージ（PLATEAU取得、タイル読込、WASM初期化、エクスポート）
- ガードレール：最大選択面積（1 km²）、最大頂点数（500万）、最大処理時間（60秒）
- LOD2選択時の警告：「LOD2を選択すると、中庭などの開口部が正しく造形できない場合があります。」
- 最小限のHono/Cloudflare Workerスカフォールド（ヘルスチェックのみ）— 将来のサーバー側オフロードに備える

### Must NOT have (スコープ境界・対象外)
- NO ユーザー認証、アカウント、セッション
- NO データベースや永続的クラウドストレージ
- NO MVPでのサーバー側メッシュ処理（すべてブラウザ内処理、WorkerのAPIエンドポイントはヘルスチェック以外後回し）
- NO 高度な個別建物編集（移動、リサイズ、削除）
- NO MVPでの自動穴埋め・中庭修復
- NO テクスチャやマテリアルの出力（単色のみ）
- NO 造形可能性分析（オーバーハング検出、サポート生成）
- NO モバイルネイティブアプリ
- NO MVPでのサイドバイサイド（地図+3D同時表示）
- NO マルチユーザーコラボレーション

## Verification strategy (検証戦略)

> 人間介入ゼロ — すべての検証はエージェントが実行

- テスト方針: **tests-after** — 座標変換とメッシュユーティリティのユニットテスト、map→exportフローの統合/E2Eテスト
- フレームワーク: ユニットテストにVitest、Docker内E2EブラウザテストにPlaywright
- 証拠: `.omo/evidence/task-<N>-machimoki.<ext>`

## Execution strategy (実行戦略)

### 並列実行ウェーブ

目標：ウェーブあたり5-8 todos

**Wave 1 — インフラ＆技術的スパイク**
開発環境の構築と、本実装前に最も不確実性の高い技術的前提を検証する。

**Wave 2 — コア地図UI**
Cesiumベースの地図表示、エリア選択、タブ切替レイアウトを構築する。

**Wave 3 — 3Dプレビュー＆データパイプライン**
PLATEAUタイルをThree.jsに読み込み、プレビューシーンを構築し、パラメータコントロールを接続する。

**Wave 4 — メッシュ加工＆エクスポート**
地形厚み付け、底面フラット化、ファイル出力と検証を実装する。

**Wave 5 — ガードレール、エラーハンドリング＆ポリッシュ**
選択制限、LOD2警告、ローディング状態、リトライロジックを追加する。

**Wave 6 — デプロイスカフォールド＆最終検証**
Cloudflare Workerスカフォールド、本番ビルド検証、Docker E2Eテスト。

### 依存関係マトリクス
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | — | 2, 3, 4 | — |
| 2 | 1 | 5, 6, 7, 8 | 3, 4 |
| 3 | 1 | 9, 11, 12 | 2, 4 |
| 4 | 1 | 11 | 2, 3 |
| 5 | 2 | 6 | — |
| 6 | 2, 5 | 8 | — |
| 7 | 2 | — | 5, 6 |
| 8 | 2, 6 | 9 | — |
| 9 | 2, 3, 8 | 10 | — |
| 10 | 2, 9 | 11 | — |
| 11 | 2, 3, 4, 9, 10 | 12 | — |
| 12 | 2, 3, 11 | 13 | — |
| 13 | 12 | — | — |
| 14 | 2 | 15 | — |
| 15 | 2, 14 | — | — |
| 16 | 1 | — | 5, 6, 7 |
| 17 | 1, 2, 7, 13, 14 | 18 | — |
| 18 | 17 | — | — |

## Todos (タスク一覧)

> 実装＋テスト＝1つのTodo。分離しない。

- [x] 1. Docker開発環境のセットアップ
  やること / やらないこと: Node.jsベースのVite開発環境用 `Dockerfile` と `docker-compose.yml` を作成。Vite設定にCesiumJSベースアセット、Three.js、WASM（manifold-3d）のパス設定を含める。Cesiumを単一JSファイルにバンドルしてはいけない（`vite-plugin-cesium` または同等のものでアセットを正しく配信）。正しいポートの公開を忘れないこと。
  並列化: Wave 1 | Blocked by: — | Blocks: 2, 3, 4
  参考資料（実行者にインタビュー文脈はない — 網羅的に書く）: `Dockerfile`, `docker-compose.yml`, `vite.config.ts`, CesiumJS公式Vite連携ガイド, `vite-plugin-cesium` npmパッケージ
  受け入れ基準（エージェント実行可能）:
    - `docker compose up` で開発サーバーが `http://localhost:5173` で起動する
    - Cesium `Viewer` が初期化され、地球がCORS/アセットエラーなく表示される
    - `manifold-3d` WASMがMIMEタイプまたはパスエラーなく初期化される
    - `docker compose build` が正常終了する
  QAシナリオ:
    - Happy: `docker compose up` → `http://localhost:5173` を開く → Cesiumの地球が表示される → ブラウザコンソールで `manifold-3d` のインポートが成功する。証拠: `.omo/evidence/task-1-machimoki.png`（スクリーンショット）
    - Failure: `docker compose up` がポート競合で失敗 → ホスト側ポートマッピングを変更してリトライ。証拠: `.omo/evidence/task-1-failure.log`
  Commit: Y | build(docker): CesiumとWASM対応の開発環境を追加

- [x] 2. プロジェクトスカフォールド — React + Vite + TypeScript + ルーティング + Hono Worker
  やること / やらないこと: `frontend/`（React + Vite + TS）と `worker/`（Honoスカフォールド）のモノレポ構造を初期化。タブベースのルーティング（地図モード / 3Dプレビューモード）をReact Routerまたは単純な状態切替で設定。Workerロジックは `/health` 以外実装しないこと。UIコンポーネントライブラリはまだ追加しない — 軽量に保つこと。
  並列化: Wave 1 | Blocked by: 1 | Blocks: 5, 6, 7, 8
  参考資料: `package.json`（root + frontend + worker）, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `worker/src/index.ts`, React Routerドキュメントまたは単純な状態切替パターン
  受け入れ基準:
    - `npm install` が `frontend/` と `worker/` の両方で成功する
    - `frontend/` で `npm run dev` を実行するとアプリが配信され、「Map」と「3D Preview」タブが切り替わる
    - `worker/` で `npm run dev` を実行すると `/health` へ `200 OK` が返る
    - `tsc --noEmit` が両パッケージでTypeScriptエラーなく完了する
  QAシナリオ:
    - Happy: 開発サーバーを起動 → 「Map」タブをクリック → 「3D Preview」タブをクリック → Workerの `/health` が200を返す。証拠: `.omo/evidence/task-2-machimoki.log`
    - Failure: ビルド時にTypeScriptエラー → `tsconfig.json` のパスを修正。証拠: `.omo/evidence/task-2-failure.log`
  Commit: Y | feat(scaffold): ReactフロントエンドとHono Workerをタブルーティング付きで初期化

- [~] 3. Spike — PLATEAU地形データソースと座標系の検証
  やること / やらないこと: (a) PLATEAUが建物タイルとは別にDEM/地形3DTilesを提供しているか、(b) 存在する場合の正確なURLパターン、(c) PLATEAUの空間参照系から印刷用ローカル座標系（mm, Z-up）への変換を調査・検証する。このスパイクが通るまでは本番のタイル読込コードを書いてはいけない。地形タイルが利用できない場合は、「地形含む」機能をMVPスコープから除外する。
  並列化: Wave 1 | Blocked by: 1 | Blocks: 9, 11, 12
  参考資料: PLATEAU VIEW APIドキュメント `https://docs.plateauview.mlit.go.jp/api/rest/operations/datacatalog3dtilesspectilesetjson/`, `3DTilesRendererJS` 座標変換例, 日本平面直角座標系（EPSG:6668）変換ユーティリティ
  受け入れ基準:
    - 建物データと地形データの正確なPLATEAUタイルセットURLを `.omo/evidence/task-3-machimoki.md` に記録する（地形データが存在する場合）
    - サンプルタイルセットを使い捨てThree.jsシーンで正常に読み込める
    - 既知の実世界座標（lon/lat）をローカルシーン座標に変換し、スケールが約1単位=1mmであることを確認する（5%以内の誤差）
  QAシナリオ:
    - Happy: タイルセットを読み込む → バウンディングボックスを計測 → 実世界距離と比較 → 期待されるmm変換と一致する。証拠: `.omo/evidence/task-3-machimoki.md`
    - Failure: 地形タイルセットが利用できない → 判断：「地形含む」をMVPスコープから除外し、代替案を文書化する。証拠: `.omo/evidence/task-3-failure.md`
  Commit: N（スパイク証拠は `.omo/evidence/` に保存）

- [~] 4. Spike — 実際のPLATEAUジオメトリに対するmanifold-3d入力検証
  やること / やらないこと: 実際のPLATEAU LOD1およびLOD2タイルデータを3DTilesRendererJS経由でThree.jsに読み込み、メッシュをmanifold-3d形式に変換してブール演算や押し出しを試みる。この検証が通るまでは本番のメッシュ処理コードを書いてはいけない。PLATEAUジオメトリがmanifold入力を失敗する場合は、失敗モードを文書化し前処理戦略を決定する。
  並列化: Wave 1 | Blocked by: 1 | Blocks: 11
  参考資料: `manifold-3d` npmパッケージドキュメント, `3DTilesRendererJS` タイル読込例, PLATEAU 3DTiles仕様
  受け入れ基準:
    - PLATEAUから実際の建物タイルを10個以上読み込む（LOD1とLOD2の両方）
    - それぞれをmanifold-3dに変換し、少なくとも1回のブール演算または押し出しを実行する
    - 80%以上のタイルがエラーなく成功する
    - 失敗モード（自己交差、非多様体エッジ等）を `.omo/evidence/task-4-machimoki.md` に文書化する
  QAシナリオ:
    - Happy: タイルを読み込む → 変換する → ブール演算が成功する → `isManifold()` がtrueを返す。証拠: `.omo/evidence/task-4-machimoki-pass.log`
    - Failure: 20%以上のタイルが失敗する → 失敗モードを文書化 → 前処理（例：リメッシュ、頂点結合）を計画するか、`three-bvh-csg` フォールバックに切り替える。証拠: `.omo/evidence/task-4-machimoki-fail.md`
  Commit: N（スパイク証拠は `.omo/evidence/` に保存）

- [x] 5. CesiumJS地図 + PLATEAU 3DTilesリファレンスビュー
  やること / やらないこと: MapタブにCesium Viewerを統合し、PLATEAU複合タイルセット（建物）を読み込み、標準カメラコントロール（ズーム、パン、回転）を有効にする。まだプレビューモードではタイルセットを読み込まない — これはリファレンスビューのみ。エリア選択もまだ有効にしないこと。
  並列化: Wave 2 | Blocked by: 2 | Blocks: 6
  参考資料: `frontend/src/components/MapView.tsx`, CesiumJS `Viewer`, `Cesium3DTileset` API, PLATEAU複合タイルセットURLパターン `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/{spec}/tileset.json`
  受け入れ基準:
    - Cesium Viewerが地球を表示し、デフォルトで日本（東京）中心に表示される
    - PLATEAU建物タイルがストリーミングされ、正しくレンダリングされる（ピンクタイルなし、CORSエラーなし）
    - カメラが自由にズーム、パン、回転できる
  QAシナリオ:
    - Happy: Mapタブを開く → 日本が表示される → 東京にズーム → 建物が表示される。証拠: `.omo/evidence/task-5-machimoki.png`
    - Failure: タイル読込でCORSエラー → `vite` プロキシ設定を確認するか、PLATEAUエンドポイントを直接使用する。証拠: `.omo/evidence/task-5-failure.log`
  Commit: Y | feat(map): CesiumJS地図にPLATEAU 3DTilesストリーミングを追加

- [x] 6. 地図上での矩形エリア選択
  やること / やらないこと: `ScreenSpaceEventHandler` を使用してクリック＆ドラッグ矩形選択を実装。`CallbackProperty` でライブ矩形プレビューを表示し、最終的な矩形境界をWGS84度で出力する。まだガードレール制限を超えるエリア選択は許可しない（Todo 15で対応）。
  並列化: Wave 2 | Blocked by: 2, 5 | Blocks: 8
  参考資料: `frontend/src/components/MapView.tsx`, Cesium `ScreenSpaceEventType.LEFT_DOWN`, `MOUSE_MOVE`, `LEFT_UP`, `Entity.rectangle`, `pickPosition`, `Cartographic.fromCartesian`
  受け入れ基準:
    - 地図上をドラッグすると可視の矩形が描画される
    - ドラッグ中に矩形がリアルタイム更新される
    - マウスアップで矩形境界（west, south, east, north）がReact stateに保存される
    - 境界は度単位（WGS84）である
  QAシナリオ:
    - Happy: 地図上をドラッグ → 矩形が表示される → リリース → stateに正しい度が含まれる。証拠: `.omo/evidence/task-6-machimoki.log`
    - Failure: ドラッグ中に矩形が消える → `CallbackProperty` の使用を確認する。証拠: `.omo/evidence/task-6-failure.log`
  Commit: Y | feat(map): ドラッグ矩形エリア選択を追加

- [x] 7. 単一画面タブ切替（地図モード / 3Dプレビューモード）
  やること / やらないこと: 画面上部にタブバー（「地図で選ぶ」 / 「3Dで確認する」）を追加。タップでCesiumとThree.jsの表示コンテナを切り替える。メモリ節約のため、両エンジンを同時にレンダリングしてはいけない — 条件付きレンダリングまたはdisplay:noneを使用すること。Three.jsシーンのコンテンツはまだ実装しないこと。
  並列化: Wave 2 | Blocked by: 2 | Blocks: —
  参考資料: `frontend/src/App.tsx`, `frontend/src/components/TabBar.tsx`, React状態切替パターン
  受け入れ基準:
    - 画面上部に2つのタブが表示されるタブバーが見える
    - 「3Dで確認する」をクリックするとCesiumが非表示になり、Three.jsキャンバスコンテナが表示される
    - 「地図で選ぶ」をクリックするとThree.jsが非表示になり、Cesiumが表示される
    - 一度に1つのWebGLコンテキストのみがアクティブである（ブラウザDevToolsのPerformanceタブで確認）
  QAシナリオ:
    - Happy: 3Dタブをクリック → Cesiumが非表示 → Three.jsコンテナが表示される → 地図タブをクリック → 逆になる。証拠: `.omo/evidence/task-7-machimoki.png`
    - Failure: 両方のコンテナが表示される → 条件付きレンダリングロジックを修正する。証拠: `.omo/evidence/task-7-failure.log`
  Commit: Y | feat(ui): 地図/3Dプレビュータブ切替を追加

- [x] 8. 3DTilesRendererJS — 選択エリアをThree.jsに読み込み
  やること / やらないこと: エリアが選択されたら、PLATEAUタイルセットURL（選択されたLOD）を構築し、`3DTilesRendererJS` で読み込む。バウンディングボックスが選択矩形と交差するタイルのみに読み込みを制限する。まだメッシュ処理は行わない — 読み込んでThree.jsプレビューシーンに表示するだけ。
  並列化: Wave 2 | Blocked by: 2, 6 | Blocks: 9
  参考資料: `frontend/src/components/Preview3D.tsx`, `3DTilesRendererJS` `TilesRenderer` クラス, `setCamera`, タイルバウンディングボックス交差判定ロジック
  受け入れ基準:
    - エリア選択確定時に3DTilesRendererJSが正しいタイルセットURLの読み込みを開始する
    - 選択矩形と交差するタイルのみが読み込まれる（カスタムカリングまたは読み込み後フィルタリング）
    - タイルメッシュがThree.jsシーンに表示される
    - ユーザーに進捗が表示される
  QAシナリオ:
    - Happy: エリアを選択 → 3Dタブに切り替える → タイルが読み込まれる → 建物が表示される。証拠: `.omo/evidence/task-8-machimoki.png`
    - Failure: 選択エリア外のタイルが読み込まれる → バウンディングボックスフィルタリングを実装する。証拠: `.omo/evidence/task-8-failure.log`
  Commit: Y | feat(3d): PLATEAUタイルを3DTilesRendererJS経由でThree.jsに読み込み

- [x] 9. Three.js 3Dプレビューシーン
  やること / やらないこと: Three.js Scene、PerspectiveCamera、WebGLRenderer、OrbitControlsを初期化。カメラターゲトを選択エリアの中心に設定し、選択範囲に合わせてビューをフィットさせる。まだパラメータ駆動のメッシュ変更は追加しないこと。
  並列化: Wave 3 | Blocked by: 2, 3, 8 | Blocks: 10
  参考資料: `frontend/src/components/Preview3D.tsx`, Three.js `Scene`, `PerspectiveCamera`, `WebGLRenderer`, `OrbitControls` (`three/examples/jsm/controls/OrbitControls.js`)
  受け入れ基準:
    - Three.jsシーンがプレビューコンテナにレンダリングされる
    - カメラが読み込まれたジオメトリの周りをスムーズに回転する
    - カメラが選択矩形の中心を向いている
    - シーンにはニュートラルな背景色と方向を示すグリッドフロアがある
  QAシナリオ:
    - Happy: 3Dタブに切り替える → ジオメトリが表示される → マウスドラッグで回転 → ズームが動作する。証拠: `.omo/evidence/task-9-machimoki.png`
    - Failure: カメラが誤った位置を向いている → 座標変換計算を確認する。証拠: `.omo/evidence/task-9-failure.log`
  Commit: Y | feat(3d): OrbitControls付きThree.jsプレビューシーンを初期化

- [x] 10. パラメータ調整パネル
  やること / やらないこと: 右側（または下部）にパラメータパネルを構築：地形厚みスライダー（1-50mm、デフォルト10mm）、底面フラット化トグル（デフォルトON）、地形含む/含まないトグル（デフォルトON、スパイク3が成功した場合のみ）、LODセレクタ（LOD1デフォルト / LOD2）、出力形式セレクタ（3MFデフォルト / STL）。パネル状態はReactで管理し、Three.jsプレビューコンポーネントに渡される。まだ実際のメッシュ変更は実装しないこと。
  並列化: Wave 3 | Blocked by: 2, 9 | Blocks: 11
  参考資料: `frontend/src/components/ParameterPanel.tsx`, React `useState`, パネルレイアウト用CSS
  受け入れ基準:
    - すべてのパラメータが正しいデフォルト値でレンダリングされる
    - パラメータを変更するとReact stateが即座に更新される
    - パラメータが視覚的にグループ化されている（出力、地形、品質）
    - モバイル幅ではパネルが折りたたみ可能である
  QAシナリオ:
    - Happy: パネルを開く → 厚みを25に変更 → stateが更新される → フラット化をOFFに切り替える → stateが更新される。証拠: `.omo/evidence/task-10-machimoki.png`
    - Failure: スライダーがstateを更新しない → イベントハンドラのバインディングを修正する。証拠: `.omo/evidence/task-10-failure.log`
  Commit: Y | feat(ui): パラメータ調整パネルを追加

- [~] 11. 地形厚み付けと底面フラット化
  やること / やらないこと: パラメータが変更されると、地形メッシュを再生成する：読み込まれたタイルから地形ジオメトリを抽出し、manifold-3d Meshに変換、厚み値で下方へ押し出し、次にバウンディングボックスとのブール交差で底面をフラット化する。Three.js Meshに戻してシーンを更新する。地形トグルがOFFの場合は実行してはいけない。スパイク4でmanifold-3dがPLATEAU入力で失敗した場合は、単純な頂点変位へのフォールバックを文書化して優雅にスキップする。
  並列化: Wave 3 | Blocked by: 2, 3, 4, 9, 10 | Blocks: 12
  参考資料: `frontend/src/lib/meshProcessor.ts`, `manifold-3d` ドキュメント（押し出し、ブール演算）, Three.js `BufferGeometry` 属性
  受け入れ基準:
    - 「地形厚み」の変更がデバウンス付きで2秒以内にメッシュ再生成をトリガーする
    - 底面が完全にフラットである（すべての底面頂点が同じZ座標を共有する）
    - 処理後のメッシュが多様体のままである（`manifold.isManifold()` で検証）
    - 地形トグルがOFFの場合、地形メッシュがシーンから非表示になる
  QAシナリオ:
    - Happy: 厚みを10mmに設定 → 地形メッシュが厚くなる → 底面がフラットになる → トグルをOFFにする → 地形が消える。証拠: `.omo/evidence/task-11-machimoki.png`
    - Failure: manifold-3dが「non-manifold input」をスローする → 文書化し、単純な変位へのフォールバックを行う。証拠: `.omo/evidence/task-11-failure.log`
  Commit: Y | feat(mesh): manifold-3dを使用した地形厚み付けと底面フラット化を追加

- [x] 12. 3MFおよびSTL出力とダウンロード
  やること / やらないこと: エクスポートボタンクリック時に、表示されているすべてのThree.jsメッシュを収集し、`three-3mf-exporter` で3MF Blobに変換するか、`STLExporter` でSTL Blobに変換し、ブラウザダウンロードをトリガーする。出力単位はミリメートル、Z-up、原点を選択中心にすること。3MFの場合は出力が多様体であることを検証する。ファイル名にはエリア名とタイムスタンプを含めること。
  並列化: Wave 4 | Blocked by: 2, 3, 11 | Blocks: 13
  参考資料: `frontend/src/lib/exporter.ts`, `three-3mf-exporter` npmドキュメント, Three.js `STLExporter` (`three/addons/exporters/STLExporter.js`)
  受け入れ基準:
    - エクスポートボタンが `.3mf` または `.stl` ファイルのダウンロードをトリガーする
    - ファイルサイズが妥当である（LOD1で1km²選択時<50MB）
    - 3MF: `lib3mf` で有効、またはWindows 3D Builderでエラーなく開ける
    - STL: `admesh` で有効、またはPrusaSlicerで開ける
    - 単位がmmである（スライサーで開いて寸法を確認）
  QAシナリオ:
    - Happy: エクスポートをクリック → ファイルがダウンロードされる → スライサーで開く → 寸法が実世界スケールと一致する。証拠: `.omo/evidence/task-12-machimoki.3mf` または `.stl`
    - Failure: エクスポートが空ファイルを生成する → メッシュ収集ロジックを確認する。証拠: `.omo/evidence/task-12-failure.log`
  Commit: Y | feat(export): クライアントサイド3MFおよびSTL出力を追加

- [x] 13. 出力検証とファイルガード
  やること / やらないこと: エクスポート生成後、ダウンロードトリガー前に出力を検証する：ファイルサイズ<50MBを確認、多様体であることを確認（3MFの場合）、退化三角形がないことを確認。検証が失敗した場合はエラーメッセージを表示してダウンロードを中止する。無効なファイルを黙ってエクスポートしてはいけない。
  並列化: Wave 4 | Blocked by: 12 | Blocks: —
  参考資料: `frontend/src/lib/exporter.ts`, manifold-3d `isManifold()`, ファイルサイズチェック
  受け入れ基準:
    - ファイル>50MBは「選択範囲が広すぎます（最大1km²）」メッセージで拒否される
    - 非多様体の3MF出力は「メッシュが造形可能ではありません」メッセージで拒否される
    - 有効な出力は正常にダウンロードに進む
  QAシナリオ:
    - Happy: 小さなエリアをエクスポート → 検証を通過 → ダウンロードが開始される。証拠: `.omo/evidence/task-13-machimoki.log`
    - Failure: 大きなエリアをエクスポート → 「広すぎます」アラートが表示される → ダウンロードがブロックされる。証拠: `.omo/evidence/task-13-failure.log`
  Commit: Y | feat(export): 出力検証ガードを追加

- [x] 14. 非同期操作のローディング状態とエラーハンドリング
  やること / やらないこと: 以下の操作にローディングスピナー/プログレスバーを追加する：PLATEAUタイル読込、3Dタイル解析、WASM初期化、メッシュ処理、エクスポート生成。以下のエラーにリトライUIを追加する：ネットワーク失敗（PLATEAU 503/タイムアウト）、WASM読込失敗、タイル解析エラー。ユーザーが空白の画面を見つめている状態を作ってはいけない。
  並列化: Wave 5 | Blocked by: 2 | Blocks: 15
  参考資料: `frontend/src/components/LoadingOverlay.tsx`, `frontend/src/components/ErrorToast.tsx`, React `Suspense` または手動state
  受け入れ基準:
    - すべての非同期操作にテキストラベル付きのローディングインジケーターが表示される（例：「PLATEAUデータを読み込み中...」）
    - ネットワークエラーにはリトライボタンと明確なエラーメッセージが表示される
    - WASM初期化失敗には「3D processing unavailable」フォールバックメッセージが表示される
    - 可能な場合は操作をキャンセル可能である（例：タイル読込の中止）
  QAシナリオ:
    - Happy: 遅いネットワーク → スピナーが表示される → 成功 → スピナーが非表示になる。証拠: `.omo/evidence/task-14-machimoki.png`
    - Failure: ネットワークを切断 → PLATEAU取得が失敗 → エラートーストにリトライ → リトライをクリック → 再読み込みされる。証拠: `.omo/evidence/task-14-failure.log`
  Commit: Y | feat(ui): ローディング状態とエラーリトライハンドリングを追加

- [x] 15. 選択ガードレールとLOD2警告
  やること / やらないこと: 最大選択面積1 km²、最大頂点数500万、最大処理時間60秒を強制する。ユーザーがLOD2を選択したら警告バナーを表示する：「LOD2を選択すると、中庭などの開口部が正しく造形できない場合があります。」制限を超えた場合はエクスポートをブロックする。大きな選択を黙って無視してはいけない。
  並列化: Wave 5 | Blocked by: 2, 14 | Blocks: —
  参考資料: `frontend/src/lib/guardrails.ts`, 面積計算（球面矩形）, Three.jsジオメトリの頂点カウンター
  受け入れ基準:
    - 面積>1 km²は「選択範囲が広すぎます（最大1km²）」をトリガーし、エクスポートを無効にする
    - 頂点数>500万は「データが大きすぎます」をトリガーし、エクスポートを無効にする
    - LOD2セレクタに警告バナーが表示される
    - LOD1が再選択されると警告が消える
  QAシナリオ:
    - Happy: 小さなエリアを選択 → 警告なし → エクスポート有効。証拠: `.omo/evidence/task-15-machimoki.png`
    - Failure: 巨大なエリアを選択 → 警告が表示される → エクスポートボタンが無効になる。証拠: `.omo/evidence/task-15-failure.log`
  Commit: Y | feat(guardrails): 選択制限とLOD2警告を追加

- [x] 16. 将来のオフロード用Hono Workerスカフォールド
  やること / やらないこと: `worker/` に最小限のHonoアプリを作成し、`/health` ルートのみを `{"status":"ok"}` を返すようにする。Cloudflare Workers Static Assets用にWranglerを設定する。今はメッシュ処理APIエンドポイントを実装してはいけない。
  並列化: Wave 6 | Blocked by: 1 | Blocks: —
  参考資料: `worker/src/index.ts`, `wrangler.toml`, Honoクイックスタートドキュメント
  受け入れ基準:
    - `worker/` で `npm run dev` を実行すると `/health` へ200を返す
    - `wrangler deploy --dry-run` が成功する（設定が有効）
    - `/health` 以外のルートが存在しない
  QAシナリオ:
    - Happy: `curl http://localhost:8787/health` → `{"status":"ok"}`。証拠: `.omo/evidence/task-16-machimoki.log`
    - Failure: Wrangler設定エラー → `wrangler.toml` を修正する。証拠: `.omo/evidence/task-16-failure.log`
  Commit: Y | feat(worker): 最小限のHonoヘルスチェックスカフォールドを追加

- [x] 17. 本番ビルドとDocker検証
  やること / やらないこと: `vite build` を本番用に実行し、アセットが最適化されていることを検証する。バンドルサイズを確認する（初期JSのgzipped目標：<2MB）。Docker本番イメージがビルドして実行できることを検証する。まだCloudflareへのデプロイは行わないこと。
  並列化: Wave 6 | Blocked by: 1, 2, 7, 13, 14 | Blocks: 18
  参考資料: `frontend/Dockerfile.prod`（別途作成する場合）, `vite.config.ts` ビルドオプション, `npm run build`
  受け入れ基準:
    - `frontend/` で `npm run build` がエラーなく完了する
    - 初期JSバンドルのgzippedサイズが<2MB（`vite-bundle-visualizer` または同等のもので計測）
    - Dockerイメージが正常にビルドする：`docker build -t machimoki-frontend .
    - コンテナが期待されるポートでビルド済みファイルを正しく配信する
  QAシナリオ:
    - Happy: ビルドが完了 → バンドルサイズがgzippedで1.8MB → Dockerイメージが実行 → アプリが読み込まれる。証拠: `.omo/evidence/task-17-machimoki.log`
    - Failure: バンドルサイズが4MB → ツリーシェイキングを調査するか、Cesium/Three.jsを遅延ロードする。証拠: `.omo/evidence/task-17-failure.log`
  Commit: Y | build(deploy): 本番ビルドとDockerイメージを検証

- [x] 18. 最終エンドツーエンド検証
  やること / やらないこと: Docker内で完全なユーザーフローを実行する：(1) アプリを開く、(2) 地図に切り替える、(3) テストエリアにズーム（例：東京駅）、(4) 矩形を選択、(5) 3Dプレビューに切り替える、(6) タイルの読込を待つ、(7) 厚みを変更、(8) エクスポートをクリック、(9) 3MFをダウンロード、(10) ファイルがスライサーまたはバリデータで正しく開けることを検証する。どのステップもスキップしてはいけない。逸脱があれば文書化する。
  並列化: Wave 6 | Blocked by: 17 | Blocks: —
  参考資料: フルアプリ統合、PLATEAUテストタイルセット、3MF検証ツール（例：`lib3mf` CLIまたはWindows 3D Builder）
  受け入れ基準:
    - 完全なフローが手動介入なしでエンドツーエンド成功する
    - エクスポートされた3MFファイルが基本的な検証を通過する（解析エラーなし）
    - 各ステップのスクリーンショットが `.omo/evidence/task-18-machimoki-step-N.png` に保存される
    - 失敗があれば証拠とともに文書化される
  QAシナリオ:
    - Happy: フルフロー → すべてのスクリーンショットがキャプチャされる → 3MFファイルが有効。証拠: `.omo/evidence/task-18-machimoki-e2e.log`
    - Failure: タイルの読込に失敗 → ネットワークまたはテストエリア選択を確認する。証拠: `.omo/evidence/task-18-machimoki-failure.log`
  Commit: Y | test(e2e): エンドツーエンドフロー検証を完了

## Final verification wave (最終検証ウェーブ)
> すべてのTodo完了後に並列実行。すべてが承認される必要がある。結果を提示し、完了宣言前にユーザーの明示的なOKを待つ。

- [x] F1. 計画遵守監査
  計画内のすべてのtodoが完了、参照、承認されていることを検証する。スコープクリープ項目が追加されていないことを確認する。Docker環境が動作することを確認する。

- [x] F2. コード品質レビュー
  TypeScript厳密チェック（`tsc --noEmit`）を実行し、Biome/ESLint（設定されている場合）でリントを実行し、未使用インポートをチェックし、本番コードに `console.log` が残っていないことを確認する。

- [x] F3. 実際の手動QA
  実ブラウザでDockerホストのアプリを開き、map→exportフローを完全に実行し、ダウンロードされた3MFがスライサー（例：PrusaSlicer、Bambu Studio）で正しい寸法で開けることを検証する。

- [x] F4. スコープ忠実性
  認証、サーバー側処理、穴埋め、個別建物編集、テクスチャ、造形可能性分析がコードベースに存在しないことを確認する。それらが明示的に後回しにされていることを検証する。

## Commit strategy (コミット戦略)

- Conventional Commitsを使用する
- コミットメッセージの言語：日本語
- すべてのコミットに `Co-authored-by: OpenCode <noreply@opencode.ai>` を含める
- Todoが自然に論理的単位に分割される場合を除き、1つのTodoあたり1コミット
- コミットは原子的で焦点を絞ったものに保つ

## Success criteria (成功基準)

1. ユーザーがブラウザ（Docker経由）でアプリを開き、PLATEAU 3D建物が表示された日本地図を見て、最大1 km²の矩形エリアを選択し、3Dプレビューに切り替え、選択がThree.jsに読み込まれるのを確認し、地形厚みと底面フラット化設定を調整し、有効な3MFまたはSTLファイルをダウンロードできる。
2. アプリがDocker内で正常にビルドされ、初期JSがgzippedで<2MBにバンドルされる。
3. 認証またはサーバー側データベースが存在しない。
4. Cloudflare Workerスカフォールドが存在するが、静的アセット配信と `/health` のみを提供する。
5. すべての非同期操作にローディング状態が表示され、エラーを優雅にハンドリングする。
6. LOD2選択時に警告が表示され、選択は許可されるが、中庭問題は既知の制限として文書化されている。
