// Scene 8 — アウトロ（f1680–1800 / 4s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT, SAFE} from '../config';
import {Kicker, Logo} from '../components/ui';

export const Scene08Outro: React.FC = () => {
  const frame = useCurrentFrame();

  const inOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const inY = interpolate(frame, [0, 14], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // わずかにアップスケールして停止
  const scale = interpolate(frame, [0, 116], [1, 1.03], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 最後 4 フレームでフェードアウト
  const outOpacity = interpolate(frame, [116, 120], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: `radial-gradient(ellipse 900px 500px at 50% 55%, rgba(76, 194, 255, 0.10), transparent 70%)`,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: inOpacity * outOpacity,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 34,
          padding: SAFE,
          transform: `scale(${scale})`,
        }}
      >
        <div
          style={{
            opacity: inOpacity,
            transform: `translateY(${inY}px)`,
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 104,
            color: COLORS.text,
          }}
        >
          選んで、印刷する。
        </div>
        <Logo fontSize={132} />
        <Kicker>PLATEAU × 3Dプリント</Kicker>
      </div>
    </AbsoluteFill>
  );
};
