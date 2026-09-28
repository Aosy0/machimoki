// machimoki デモビデオ — 全シーン共通の定数
// 仕様の正: video/STORYBOARD.md（v2: 製作仕様書トーン）

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 1800;

// セーフマージン（画面端から 88px 以上）
export const SAFE = 88;

// シーン境界フレーム（STORYBOARD のタイムライン通り。変更禁止）
export const SCENES = {
  s1: {from: 0, duration: 120}, // タイトル f0–120
  s2: {from: 120, duration: 180}, // 課題 f120–300
  s3: {from: 300, duration: 90}, // 解決 f300–390
  s4: {from: 390, duration: 360}, // 01 範囲を選ぶ f390–750
  s5: {from: 750, duration: 360}, // 02 プレビューして調整 f750–1110
  s6: {from: 1110, duration: 240}, // 03 エクスポートと検証 f1110–1350
  s7: {from: 1350, duration: 330}, // ショーケース f1350–1680
  s8: {from: 1680, duration: 120}, // アウトロ f1680–1800
} as const;

// 素材パス（staticFile() 用。public/ からの相対）
export const ASSETS = {
  coverageWide: 'captures/coverage-wide.png',
  mapFlow: 'captures/map-flow.mp4',
  selectionKitasenju: 'captures/selection-kitasenju.png',
  selectionShinjuku: 'captures/selection-shinjuku.png',
  previewKitasenju: 'captures/preview-kitasenju.png',
  previewKitasenjuSettings: 'captures/preview-kitasenju-settings.png',
  previewShinjukuWhite: 'captures/preview-shinjuku-white.png',
  turntableKitasenju: 'captures/turntable-kitasenju.mp4',
  turntableShinjuku: 'captures/turntable-shinjuku.mp4',
  exportFlow: 'captures/export-flow.mp4',
  exportDone: 'captures/export-done.png',
} as const;

// 3Dプリント実物写真。現状 null（ユーザーが後日提供）。
// null の間は Scene7 の実物サブシーンをスキップし、ターンテーブルを延長する。
export const PRINTED_PHOTO_FILE: string | null = null;

// デザインシステム v2（製作仕様書トーン）。
// グラデーション・グロー・影は禁止。色面はベタ塗りのみ。角丸は最大 4px。
export const COLORS = {
  ground: '#eef1f4',
  plate: '#ffffff',
  ink: '#101418',
  muted: '#5b6672',
  rule: '#ccd4dc',
  accent: '#1f5f8b',
  fail: '#9c3b30',
  pass: '#2c6e49',
} as const;

export const FONT = 'NotoSansJP, "Hiragino Kaku Gothic ProN", sans-serif';
// 等幅: IBM Plex Mono（OFL。video/public/fonts/ に同梱）。和文は NotoSansJP にフォールバック。
export const MONO = "'IBMPlexMono', 'NotoSansJP', monospace";

// 検証値（実測。captures/output-kitasenju.validate.json）。捏造禁止のため定数化。
export const VALIDATE = {
  openEdges: 0,
  nonManifoldEdges: 0,
  selfIntersections: 0,
  numShells: 1,
  numTri: 90394,
  numVert: 45199,
  statusCode: 'NoError',
  status: 'pass',
} as const;

// 課題シーンの実測例（captures/export-attempts/attempt-1-kitasenju-default.validate.json）
export const ATTEMPT1 = {
  numShells: 3,
  status: 'warning',
} as const;

// 実寸（アプリのプレビュー表示から読取。北千住 W 133 / D 150、新宿 W 98.0 / D 150）
export const DIMS = {
  kitasenju: {w: '133', d: '150'},
  shinjuku: {w: '98.0', d: '150'},
} as const;

// 選択範囲（実測。video/tools/capture/manifest.json の coordinates）
export const BOUNDS_KITASENJU = 'W 139.8015 / S 35.7462 / E 139.8075 / N 35.7517';

export const ATTRIBUTION =
  'データ © PLATEAU（国土交通省） ／ 地図 © 国土地理院 ／ 3Dエンジン © Cesium';
export const ATTRIBUTION_SHORT = '出典: PLATEAU（国土交通省） ／ 国土地理院 ／ Cesium';
