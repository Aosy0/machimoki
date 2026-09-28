// Scene 3 — 解決（f300–390 / 3s）。短いブリッジ + Scene 4 へのワイプ。
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT, SAFE} from '../config';
import {fadeIn} from '../components/ui';

export const Scene03Solution: React.FC = () => {
  const frame = useCurrentFrame();

  // 終盤 12 フレームで右からワイプカバーを被せ、Scene 4 へ繋ぐ（グローなし）
  const wipeX = interpolate(frame, [78, 90], [1920, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground, padding: SAFE}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
          fontFamily: FONT,
          opacity: fadeIn(frame, 0, 10),
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 60,
            letterSpacing: '-0.01em',
            color: COLORS.ink,
          }}
        >
          地図で範囲を選ぶと、生成と検証までを一括で行う
        </div>
        <div
          style={{
            marginTop: 24,
            fontWeight: 400,
            fontSize: 30,
            color: COLORS.muted,
            opacity: fadeIn(frame, 10, 10),
          }}
        >
          出力形式: 3MF / STL
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
          backgroundColor: COLORS.ground,
          borderLeft: `2px solid ${COLORS.ink}`,
        }}
      />
    </AbsoluteFill>
  );
};
