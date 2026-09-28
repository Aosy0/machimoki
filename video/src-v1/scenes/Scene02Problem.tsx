// Scene 2 — 課題（f120–300 / 6s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONT, SAFE} from '../config';

const CARDS = [
  {title: '開いた穴（オープンエッジ）', mark: '◌'},
  {title: '非多様体エッジ', mark: '⚠'},
  {title: '自己交差', mark: '✕'},
] as const;

// 穴あきメッシュの簡易イラスト。欠損面を赤い破線で強調。
const HoleMeshIllust: React.FC = () => (
  <svg width="640" height="480" viewBox="0 0 560 420">
    {/* 背面の立方体 */}
    <g stroke="#5b6b7f" strokeWidth="3" fill="rgba(76, 194, 255, 0.05)">
      <polygon points="180,120 380,120 380,300 180,300" fill="rgba(76, 194, 255, 0.06)" />
      <polygon points="230,70 430,70 430,250 380,300 180,300 180,300 130,250 130,70" fill="none" />
      <line x1="180" y1="120" x2="130" y2="70" />
      <line x1="380" y1="120" x2="430" y2="70" />
      <line x1="180" y1="300" x2="130" y2="250" />
      <line x1="130" y1="70" x2="430" y2="70" />
      <line x1="430" y1="70" x2="430" y2="250" />
      <line x1="430" y1="250" x2="380" y2="300" />
      <line x1="130" y1="250" x2="130" y2="70" />
      <line x1="130" y1="250" x2="180" y2="300" />
    </g>
    {/* 欠損面（赤い破線） */}
    <polygon
      points="180,120 380,120 380,300 180,300"
      fill="rgba(255, 123, 114, 0.10)"
      stroke={COLORS.red}
      strokeWidth="5"
      strokeDasharray="18 12"
    />
    {/* ほつれたエッジ */}
    <g stroke={COLORS.red} strokeWidth="4" strokeLinecap="round">
      <line x1="230" y1="160" x2="262" y2="192" />
      <line x1="330" y1="150" x2="318" y2="188" />
      <line x1="250" y1="250" x2="282" y2="228" />
      <line x1="330" y1="262" x2="342" y2="226" />
    </g>
    {/* 欠損マーカー */}
    <g>
      <circle cx="430" cy="330" r="26" fill="rgba(255, 123, 114, 0.15)" stroke={COLORS.red} strokeWidth="3" />
      <text
        x="430"
        y="341"
        textAnchor="middle"
        fontSize="30"
        fontWeight="900"
        fill={COLORS.red}
        fontFamily={FONT}
      >
        !
      </text>
      <text
        x="470"
        y="341"
        fontSize="28"
        fontWeight="700"
        fill={COLORS.red}
        fontFamily={FONT}
      >
        欠損
      </text>
    </g>
    {/* メッシュの格子（雰囲気） */}
    <g stroke="#2d3748" strokeWidth="2">
      <line x1="40" y1="360" x2="520" y2="360" />
      <line x1="70" y1="385" x2="490" y2="385" />
      <line x1="110" y1="60" x2="110" y2="330" opacity="0.35" />
      <line x1="470" y1="60" x2="470" y2="330" opacity="0.35" />
    </g>
  </svg>
);

export const Scene02Problem: React.FC = () => {
  const frame = useCurrentFrame();

  const headingOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const headingY = interpolate(frame, [0, 14], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subOpacity = interpolate(frame, [60, 74], [0, 1], {
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
        }}
      >
        <div
          style={{
            opacity: headingOpacity,
            transform: `translateY(${headingY}px)`,
            fontSize: 88,
            fontWeight: 900,
            color: COLORS.text,
            textAlign: 'center',
            marginTop: 30,
          }}
        >
          そのままでは、印刷できない。
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 40,
            marginTop: 56,
            flex: 1,
            alignItems: 'stretch',
            justifyContent: 'center',
          }}
        >
          {/* イラストパネル */}
          <div
            style={{
              backgroundColor: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 20,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 24,
              opacity: interpolate(frame, [20, 34], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            <HoleMeshIllust />
          </div>

          {/* 赤系カード 3 枚（10 フレーム間隔のスタッガー） */}
          <div
            style={{display: 'flex', flexDirection: 'column', gap: 28, flex: 1}}
          >
            {CARDS.map((card, i) => {
              const start = 30 + i * 10;
              const o = interpolate(frame, [start, start + 12], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              const x = interpolate(frame, [start, start + 12], [60, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              return (
                <div
                  key={card.title}
                  style={{
                    opacity: o,
                    transform: `translateX(${x}px)`,
                    backgroundColor: 'rgba(255, 123, 114, 0.07)',
                    border: `2px solid ${COLORS.red}`,
                    borderRadius: 18,
                    padding: '28px 36px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 28,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      border: `3px solid ${COLORS.red}`,
                      color: COLORS.red,
                      fontSize: 36,
                      fontWeight: 900,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {card.mark}
                  </div>
                  <div
                    style={{fontSize: 46, fontWeight: 700, color: COLORS.text}}
                  >
                    {card.title}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            opacity: subOpacity,
            fontSize: 40,
            fontWeight: 400,
            color: COLORS.dim,
            textAlign: 'center',
            marginTop: 44,
          }}
        >
          PLATEAU の都市モデルは、スライサーがエラーで止まってしまう
        </div>
      </div>
    </AbsoluteFill>
  );
};
