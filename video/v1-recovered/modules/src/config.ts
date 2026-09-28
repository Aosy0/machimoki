// machimoki デモビデオ — 全シーン共通の定数
// 仕様の正: video/STORYBOARD.md

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 1800;

// セーフマージン（画面端から 88px 以上）
export const SAFE = 88;

// シーン境界フレーム（STORYBOARD のタイムライン通り）
export const SCENES = {
  s1: {from: 0, duration: 120}, // タイトル f0–120
  s2: {from: 120, duration: 180}, // 課題 f120–300
  s3: {from: 300, duration: 90}, // 解決 f300–390
  s4: {from: 390, duration: 360}, // STEP1 f390–750
  s5: {from: 750, duration: 360}, // STEP2 f750–1110
  s6: {from: 1110, duration: 240}, // STEP3 f1110–1350
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
// 実ファイルが来たら 'captures/printed-xxx.png' 等に書き換えるだけで自動表示される。
export const PRINTED_PHOTO_FILE: string | null = null;

// デザインシステム（docs/slides.html 踏襲）
export const COLORS = {
  bg: '#0d1117',
  surface: '#161b22',
  panel: '#1c2330',
  border: '#2d3748',
  text: '#e6edf3',
  dim: '#9da7b3',
  accent: '#4cc2ff',
  green: '#7ee787',
  yellow: '#f2cc60',
  red: '#ff7b72',
} as const;

export const FONT = 'NotoSansJP, "Hiragino Kaku Gothic ProN", sans-serif';

// 検証カードの仮置き値（STORYBOARD 通り）。
// captures/output-kitasenju.validate.json の実測値が来たら更新すること。
// 実測値以外の数値は画面に出さない。
export const VALIDATE_PLACEHOLDER = {
  openEdges: 0,
  nonManifoldEdges: 0,
  selfIntersections: 0,
  numShells: 1,
} as const;

export const ATTRIBUTION =
  'データ © PLATEAU（国土交通省） ／ 地図 © 国土地理院 ／ 3Dエンジン © Cesium';
