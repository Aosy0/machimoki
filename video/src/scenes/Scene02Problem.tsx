// Scene 2 — 課題（f120–300 / 6s）
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {ATTEMPT1, COLORS, FONT, SAFE} from '../config';
import {Plate, fadeIn} from '../components/ui';

const ITEMS = [
  '建物メッシュは閉じた立体ではない（底面が開いている）',
  `地形と統合すると複数のシェルに分かれることがある（北千住・LOD1の実測で${ATTEMPT1.numShells}シェル）`,
  '穴・非多様体・自己交差があるとスライサーが止まる',
] as const;

// 欠損メッシュの線画（白地・インク線・欠損面のみ破線と注記）
const MeshLineDrawing: React.FC = () => (
  <svg width="520" height="420" viewBox="0 0 560 420">
    <g stroke={COLORS.ink} strokeWidth="2.5" fill="none">
      <polygon points="180,120 380,120 380,300 180,300" />
      <polygon points="230,70 430,70 430,250 380,300 180,300 130,250 130,70" />
      <line x1="180" y1="120" x2="130" y2="70" />
      <line x1="380" y1="120" x2="430" y2="70" />
      <line x1="180" y1="300" x2="130" y2="250" />
      <line x1="130" y1="70" x2="430" y2="70" />
      <line x1="430" y1="70" x2="430" y2="250" />
      <line x1="430" y1="250" x2="380" y2="300" />
      <line x1="130" y1="250" x2="130" y2="70" />
      <line x1="130" y1="250" x2="180" y2="300" />
    </g>
    {/* 欠損面（破線・赤はここだけ） */}
    <polygon
      points="180,120 380,120 380,300 180,300"
      fill="none"
      stroke={COLORS.fail}
      strokeWidth="4"
      strokeDasharray="16 10"
    />
    <line x1="380" y1="300" x2="440" y2="348" stroke={COLORS.fail} strokeWidth="2.5" />
    <text
      x="448"
      y="356"
      fontSize="26"
      fontWeight={500}
      fill={COLORS.fail}
      fontFamily={FONT}
    >
      欠損面
    </text>
  </svg>
);

export const Scene02Problem: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground, padding: SAFE}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 72,
          height: '100%',
          alignItems: 'center',
          fontFamily: FONT,
        }}
      >
        <div style={{flex: 1.15}}>
          <div
            style={{
              opacity: fadeIn(frame, 0, 10),
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: COLORS.ink,
            }}
          >
            配信データは、水密ではない
          </div>
          <div style={{marginTop: 40}}>
            {ITEMS.map((item, i) => (
              <div
                key={item}
                style={{
                  opacity: fadeIn(frame, 18 + i * 16, 10),
                  borderTop: `1px solid ${COLORS.rule}`,
                  padding: '22px 0',
                  fontSize: 32,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: COLORS.ink,
                }}
              >
                {item}
              </div>
            ))}
            <div style={{borderTop: `1px solid ${COLORS.rule}`}} />
          </div>
        </div>
        <div style={{flex: 1, opacity: fadeIn(frame, 24, 12)}}>
          <Plate height={560}>
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <MeshLineDrawing />
            </div>
          </Plate>
        </div>
      </div>
    </AbsoluteFill>
  );
};
