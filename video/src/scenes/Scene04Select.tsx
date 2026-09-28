// Scene 4 — 01 範囲を選ぶ（f390–750 / 12s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ASSETS, BOUNDS_KITASENJU, COLORS, FONT, MONO, SAFE} from '../config';
import {
  AssetImage,
  AssetVideo,
  Outline,
  Plate,
  Rule2,
  SourceLine,
  fadeIn,
} from '../components/ui';

// 選択スティル（3200x1800）に対し、選択矩形の上端と「座標で選択」パネル下端の
// 両方を枠内に収めるため、プレート幅を 1440 に絞って表示倍率を抑える。
const PLATE_W = 1440;
const SELECT_FRAMING = '50% 98%';

export const Scene04Select: React.FC = () => {
  const frame = useCurrentFrame();

  const layerB = interpolate(frame, [105, 118], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const clipOut = interpolate(frame, [118, 130], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const layerB2 = interpolate(frame, [118, 130], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const layerC = interpolate(frame, [310, 322], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const isShinjuku = frame >= 315;
  const caption2 = frame >= 115;
  const capOpacity = interpolate(
    frame,
    caption2 ? [115, 123] : [8, 16],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

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
          01 範囲を選ぶ
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 30,
            fontWeight: 500,
            color: COLORS.ink,
            opacity: fadeIn(frame, 8, 10),
          }}
        >
          {isShinjuku ? '新宿' : '北千住（足立区）'}
        </div>

        <div style={{marginTop: 16, width: PLATE_W}}>
          <Plate height={560}>
            {/* A: カバレッジ広域（静止） */}
            <div style={{position: 'absolute', inset: 0}}>
              <AssetImage src={ASSETS.coverageWide} />
            </div>
            {/* B: ズーム+選択フロー（クリップは短いアクセント） */}
            <div style={{position: 'absolute', inset: 0, opacity: layerB * clipOut}}>
              <AssetVideo
                src={ASSETS.mapFlow}
                fallbackSrc={ASSETS.selectionKitasenju}
                position={SELECT_FRAMING}
              />
            </div>
            {/* B2: 選択状態のスティル（静止） */}
            <div style={{position: 'absolute', inset: 0, opacity: layerB2}}>
              <AssetImage src={ASSETS.selectionKitasenju} position={SELECT_FRAMING} />
            </div>
            {/* C: 新宿インサート（後半 1.5 秒） */}
            <div style={{position: 'absolute', inset: 0, opacity: layerC}}>
              <AssetImage src={ASSETS.selectionShinjuku} position={SELECT_FRAMING} />
            </div>
            {/* 適用ボタンへの静止アウトライン（B セグメントのみ） */}
            {frame >= 118 && frame < 310 ? (
              <Outline left={1225} top={502} width={190} height={52} />
            ) : null}
          </Plate>
        </div>

        <div
          style={{
            marginTop: 16,
            fontFamily: MONO,
            fontWeight: 400,
            fontSize: 26,
            lineHeight: 1.6,
            color: COLORS.ink,
            opacity: fadeIn(frame, 10, 10),
          }}
        >
          <div>{BOUNDS_KITASENJU}</div>
          <div style={{color: COLORS.muted}}>プリセット 足立区 / 新宿 / 東京駅</div>
        </div>

        <div style={{marginTop: 14, opacity: capOpacity}}>
          <div style={{fontSize: 34, fontWeight: 500, color: COLORS.ink}}>
            {caption2
              ? '座標入力または Shift+ドラッグで矩形を選択'
              : '整備済みエリアをカバレッジで表示'}
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
