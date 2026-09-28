// Scene 8 — アウトロ（f1680–1800 / 4s）
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {COLORS, FONT, MONO, SAFE} from '../config';
import {SourceLine, Wordmark, fadeIn} from '../components/ui';

export const Scene08Outro: React.FC = () => {
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
            marginTop: 24,
            fontWeight: 400,
            fontSize: 34,
            color: COLORS.ink,
          }}
        >
          CLIとHTTP APIでも利用できます
        </div>
        <div
          style={{
            marginTop: 32,
            border: `1px solid ${COLORS.rule}`,
            backgroundColor: COLORS.plate,
            padding: '20px 28px',
            fontFamily: MONO,
            fontWeight: 400,
            fontSize: 24,
            lineHeight: 1.7,
            color: COLORS.ink,
            opacity: fadeIn(frame, 12, 10),
          }}
        >
          <div>npx tsx core/src/cli/index.ts export \</div>
          <div>
            {'  '}--bounds 139.6903,35.6997,139.6906,35.7000 --terrain-thickness
            10 \
          </div>
          <div>{'  '}--flatten-bottom --format 3mf --output model.3mf</div>
        </div>
        <div style={{marginTop: 32}}>
          <SourceLine
            text="MIT License ／ データ © PLATEAU（国土交通省） ／ 地図 © 国土地理院 ／ 3Dエンジン © Cesium"
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
