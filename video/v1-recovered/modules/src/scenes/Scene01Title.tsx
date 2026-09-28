// Scene 1 — タイトル（f0–120 / 4s）
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, FONT, SAFE} from '../config';
import {Kicker, Logo} from '../components/ui';

export const Scene01Title: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const logoScale = spring({frame, fps, config: {damping: 200}});
  const logoOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // サブとキッカーを 8 フレーム間隔でスタッガー
  const kickerOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const kickerY = interpolate(frame, [12, 24], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subOpacity = interpolate(frame, [20, 32], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subY = interpolate(frame, [20, 32], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: `radial-gradient(ellipse 900px 500px at 50% 42%, rgba(76, 194, 255, 0.12), transparent 70%)`,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 36,
          padding: SAFE,
        }}
      >
        <div style={{opacity: kickerOpacity, transform: `translateY(${kickerY}px)`}}>
          <Kicker>PLATEAU × 3Dプリント</Kicker>
        </div>
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        >
          <Logo fontSize={200} />
        </div>
        <div
          style={{
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
            fontFamily: FONT,
            fontWeight: 400,
            fontSize: 46,
            color: COLORS.dim,
          }}
        >
          都市の3Dモデルを、そのまま印刷できる形に。
        </div>
      </div>
    </AbsoluteFill>
  );
};
