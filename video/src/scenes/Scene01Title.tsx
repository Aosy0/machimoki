// Scene 1 — タイトル（f0–120 / 4s）
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {ATTRIBUTION_SHORT, COLORS, FONT, SAFE} from '../config';
import {Rule2, SourceLine, Wordmark, fadeIn} from '../components/ui';

export const Scene01Title: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground, padding: SAFE}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
          fontFamily: FONT,
          opacity: fadeIn(frame, 0, 12),
        }}
      >
        <Wordmark fontSize={64} />
        <div
          style={{
            marginTop: 28,
            fontWeight: 400,
            fontSize: 36,
            lineHeight: 1.7,
            color: COLORS.ink,
            maxWidth: 1500,
          }}
        >
          PLATEAUの3D都市モデルと地形から、3Dプリント可能な水密メッシュ（3MF /
          STL）を生成するツール
        </div>
        <div style={{marginTop: 56}}>
          <Rule2 frame={frame} delay={10} length={16} />
        </div>
        <div style={{marginTop: 20, opacity: fadeIn(frame, 20, 10)}}>
          <SourceLine text={ATTRIBUTION_SHORT} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
