// Scene 6 — STEP 3: エクスポートと検証（f1110–1350 / 8s）
// 検証カードの数値は STORYBOARD の仮置き。
// captures/output-kitasenju.validate.json の実測値が来たら更新すること。
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ASSETS, COLORS, FONT, SAFE, VALIDATE_PLACEHOLDER} from '../config';
import {AssetImage, AssetVideo, CaptionBar, StepChip, kenBurnsScale} from '../components/ui';

const CARDS = [
  {label: 'オープンエッジ', value: VALIDATE_PLACEHOLDER.openEdges},
  {label: '非多様体エッジ', value: VALIDATE_PLACEHOLDER.nonManifoldEdges},
  {label: '自己交差', value: VALIDATE_PLACEHOLDER.selfIntersections},
  {label: 'シェル数', value: VALIDATE_PLACEHOLDER.numShells},
] as const;

export const Scene06Export: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const headOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 進行スティル → クリップ（短いアクセント）→ 完了スティル
  // 開幕はエクスポート設定が読めるシャープなスティルにする
  // （export-progress.png はローディング画面のため不使用）
  const clipLayer = interpolate(frame, [70, 82], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // 完了スティルへの切り替え（保持時間を確保するため早め）
  const doneLayer = interpolate(frame, [110, 122], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // シェル数のカウントアップ（0 → 1）
  const shells = Math.round(
    interpolate(frame, [85, 110], [0, VALIDATE_PLACEHOLDER.numShells], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  // PASS スタンプのスケールイン（完成状態の保持 2.7 秒 = 82F）
  const stampScale = spring({frame: frame - 150, fps, config: {damping: 12}});
  const stampOpacity = interpolate(frame, [150, 158], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

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
          opacity: headOpacity,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 32,
          }}
        >
          <StepChip>STEP 3 — エクスポート</StepChip>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 36,
            marginTop: 32,
            flex: 1,
          }}
        >
          {/* 左: エクスポートの様子（進行スティル → クリップ → 完了スティル） */}
          <div
            style={{
              position: 'relative',
              width: 1020,
              borderRadius: 20,
              overflow: 'hidden',
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.surface,
            }}
          >
            <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  transform: `scale(${kenBurnsScale(frame, 80)})`,
                }}
              >
                <AssetImage src={ASSETS.previewKitasenjuSettings} />
              </div>
            </div>
            <div style={{position: 'absolute', inset: 0, opacity: clipLayer}}>
              <AssetVideo
                src={ASSETS.exportFlow}
                fallbackSrc={ASSETS.exportDone}
              />
            </div>
            <div style={{position: 'absolute', inset: 0, opacity: doneLayer}}>
              <AssetImage src={ASSETS.exportDone} />
            </div>
            {/* PASS スタンプ */}
            {frame >= 150 ? (
              <div
                style={{
                  position: 'absolute',
                  right: 36,
                  bottom: 36,
                  opacity: stampOpacity,
                  transform: `scale(${stampScale}) rotate(-8deg)`,
                  border: `5px solid ${COLORS.green}`,
                  borderRadius: 16,
                  color: COLORS.green,
                  backgroundColor: 'rgba(13, 17, 23, 0.88)',
                  fontSize: 52,
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  padding: '14px 36px',
                  boxShadow: `0 0 40px rgba(126, 231, 135, 0.35)`,
                }}
              >
                PASS — watertight
              </div>
            ) : null}
          </div>

          {/* 右: 検証カード 2x2 */}
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: 24,
            }}
          >
            {CARDS.map((card, i) => {
              const start = 30 + i * 10;
              const o = interpolate(frame, [start, start + 12], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              const y = interpolate(frame, [start, start + 12], [30, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              const shown = card.label === 'シェル数' ? shells : card.value;
              return (
                <div
                  key={card.label}
                  style={{
                    opacity: o,
                    transform: `translateY(${y}px)`,
                    backgroundColor: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                    borderTop: `6px solid ${COLORS.green}`,
                    borderRadius: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    padding: 16,
                  }}
                >
                  <div style={{fontSize: 30, fontWeight: 700, color: COLORS.dim}}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: 92,
                      fontWeight: 900,
                      color: COLORS.green,
                      lineHeight: 1,
                    }}
                  >
                    {shown}
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: COLORS.green,
                    }}
                  >
                    ✓ OK
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{marginTop: 32, display: 'flex', justifyContent: 'center'}}>
          <CaptionBar>
            出力と同時に自動検証。合格したモデルだけを書き出す
          </CaptionBar>
        </div>
      </div>
    </AbsoluteFill>
  );
};
