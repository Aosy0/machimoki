// Scene 3 — 解決（f300–390 / 3s）。短いブリッジ + Scene 4 へのワイプ遷移。
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT, SAFE} from '../config';

export const Scene03Solution: React.FC = () => {
  const frame = useCurrentFrame();

  const headingOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const headingY = interpolate(frame, [0, 12], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 終盤 12 フレームで右からワイプカバーを被せ、Scene 4 へ繋ぐ
  const wipeX = interpolate(frame, [78, 90], [1920, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: `radial-gradient(ellipse 800px 460px at 50% 50%, rgba(126, 231, 135, 0.08), transparent 70%)`,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          padding: SAFE,
        }}
      >
        <div
          style={{
            opacity: headingOpacity,
            transform: `translateY(${headingY}px)`,
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 104,
            color: COLORS.text,
            textAlign: 'center',
          }}
        >
          選んで、出力するだけ。
        </div>
        <div
          style={{
            opacity: subOpacity,
            fontFamily: FONT,
            fontWeight: 400,
            fontSize: 42,
            color: COLORS.dim,
            textAlign: 'center',
          }}
        >
          地図で範囲を選ぶと、検証済みの 3MF / STL が手に入る
        </div>
      </div>
      {/* ワイプカバー */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: wipeX,
          width: 1920,
          backgroundColor: COLORS.bg,
          borderLeft: `6px solid ${COLORS.accent}`,
        }}
      />
    </AbsoluteFill>
  );
};
