// Scene 5 — 02 プレビューして調整（f750–1110 / 12s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ASSETS, COLORS, FONT, MONO, SAFE} from '../config';
import {
  AssetImage,
  AssetVideo,
  Plate,
  Rule2,
  SourceLine,
  fadeIn,
} from '../components/ui';

export const Scene05Preview: React.FC = () => {
  const frame = useCurrentFrame();

  const layerB = interpolate(frame, [115, 127], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const layerC = interpolate(frame, [225, 237], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const layerD = interpolate(frame, [300, 312], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const seg = frame < 122 ? 0 : frame < 232 ? 1 : frame < 306 ? 2 : 3;
  const captions = [
    '建物メッシュと地形をブール演算で統合',
    '地形の厚み・底面のフラット化・LODを設定',
    '不要な建物はクリックで削除（Ctrl+Z で取り消し）',
    '白模型表示で形状を確認',
  ] as const;
  const capStart = [8, 130, 240, 308][seg];
  const capOpacity = interpolate(frame, [capStart, capStart + 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground, padding: SAFE}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: FONT,
          opacity: fadeIn(frame, 0, 10),
        }}
      >
        <div
          style={{
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: COLORS.ink,
          }}
        >
          02 プレビューして調整
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: MONO,
            fontWeight: 400,
            fontSize: 28,
            color: COLORS.ink,
            opacity: fadeIn(frame, 10, 10),
          }}
        >
          LOD1 ／ 地形厚み 10mm ／ 底面フラット化 ／ 出力 3MF
        </div>

        <div style={{marginTop: 16}}>
          <Plate height={590}>
            {/* 1: 建物+地形の統合プレビュー（静止） */}
            <div style={{position: 'absolute', inset: 0}}>
              <AssetImage src={ASSETS.previewKitasenju} />
            </div>
            {/* 2: 設定パネル（静止） */}
            <div style={{position: 'absolute', inset: 0, opacity: layerB}}>
              <AssetImage src={ASSETS.previewKitasenjuSettings} />
            </div>
            {/* 3: ターンテーブル */}
            <div style={{position: 'absolute', inset: 0, opacity: layerC}}>
              <AssetVideo
                src={ASSETS.turntableKitasenju}
                fallbackSrc={ASSETS.previewShinjukuWhite}
              />
            </div>
            {/* 4: 白模型スティル（静止） */}
            <div style={{position: 'absolute', inset: 0, opacity: layerD}}>
              <AssetImage src={ASSETS.previewShinjukuWhite} />
            </div>
          </Plate>
        </div>

        <div style={{marginTop: 14, opacity: capOpacity}}>
          <div style={{fontSize: 34, fontWeight: 500, color: COLORS.ink}}>
            {captions[seg]}
          </div>
          <div style={{marginTop: 10}}>
            <Rule2 frame={frame} delay={8} length={14} />
          </div>
        </div>

        <div style={{marginTop: 'auto', paddingTop: 8}}>
          <SourceLine
            text="出典: PLATEAU（国土交通省） ／ 国土地理院 ／ Cesium"
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
