// Scene 4 — STEP 1: 範囲を選ぶ（f390–750 / 12s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ASSETS, ATTRIBUTION, COLORS, FONT, SAFE} from '../config';
import {
  AssetImage,
  AssetVideo,
  Attribution,
  CaptionBar,
  HighlightRing,
  HudChip,
  StepChip,
  kenBurnsScale,
} from '../components/ui';

const MEDIA_H = 670;
// 選択スティルは 16:9 に対して枠がワイドなため、下寄せで表示する。
// 「座標で選択」パネル（右下・適用ボタン行）を枠内に収めつつ、選択矩形も見切れさせない。
const SELECT_FRAMING = '50% 93%';

export const Scene04Select: React.FC = () => {
  const frame = useCurrentFrame();

  const chipOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // メディアセグメントのクロスフェード
  // B はクリップを短いアクセントに留め、シャープな高解像度スティルを主役にする。
  // f520（local 130）時点でスティルが乗り切るよう前倒しする
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
    caption2 ? [115, 127] : [8, 20],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{backgroundColor: COLORS.bg, padding: `${SAFE}px ${SAFE}px`}}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: FONT,
          opacity: chipOpacity,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <StepChip>STEP 1 — 範囲を選ぶ</StepChip>
          <HudChip>{isShinjuku ? '新宿' : '北千住（足立区）'}</HudChip>
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: 24,
            height: MEDIA_H,
            borderRadius: 20,
            overflow: 'hidden',
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.surface,
          }}
        >
          {/* A: カバレッジ広域（Ken Burns） */}
          <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
            <div
              style={{
                width: '100%',
                height: '100%',
                transform: `scale(${kenBurnsScale(frame, 110)})`,
              }}
            >
              <AssetImage src={ASSETS.coverageWide} />
            </div>
          </div>
          {/* B: ズーム+選択フロー（クリップは短いアクセント） */}
          <div style={{position: 'absolute', inset: 0, opacity: layerB * clipOut}}>
            <AssetVideo
              src={ASSETS.mapFlow}
              fallbackSrc={ASSETS.selectionKitasenju}
              position={SELECT_FRAMING}
            />
          </div>
          {/* B2: 選択状態のシャープなスティルを主役に（Ken Burns） */}
          <div style={{position: 'absolute', inset: 0, opacity: layerB2, overflow: 'hidden'}}>
            <div
              style={{
                width: '100%',
                height: '100%',
                transform: `scale(${kenBurnsScale(Math.max(0, frame - 118), 192)})`,
              }}
            >
              <AssetImage src={ASSETS.selectionKitasenju} position={SELECT_FRAMING} />
            </div>
          </div>
          {/* C: 新宿インサート（後半 1.5 秒） */}
          <div style={{position: 'absolute', inset: 0, opacity: layerC}}>
            <AssetImage src={ASSETS.selectionShinjuku} position={SELECT_FRAMING} />
          </div>
          {/* 適用ボタンへのハイライト（B セグメントのみ）。
              選択矩形はアプリ自体が描画するため、自前のリングはボタン側に寄せる */}
          {frame >= 118 && frame < 310 ? (
            <HighlightRing left={1470} top={612} width={250} height={56} radius={14} />
          ) : null}
          {/* 帰属表示（小さく、常時。メディア左下にオーバーレイ） */}
          <div
            style={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              backgroundColor: 'rgba(13, 17, 23, 0.85)',
              borderRadius: 10,
              padding: '8px 18px',
            }}
          >
            <Attribution text={ATTRIBUTION} />
          </div>
        </div>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            justifyContent: 'center',
            opacity: capOpacity,
          }}
        >
          <CaptionBar>
            {caption2
              ? '座標指定・Shift+ドラッグで、かんたん選択'
              : '整備済みエリアがひと目でわかる（カバレッジ表示）'}
          </CaptionBar>
        </div>
      </div>
    </AbsoluteFill>
  );
};
