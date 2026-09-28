// Scene 7 — 出力ショーケース（f1350–1680 / 11s）
// PRINTED_PHOTO_FILE が null の間は実物サブシーンをスキップし、
// ターンテーブルを延長して尺を保つ（空白を作らない）。
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Img} from 'remotion';
import {
  ASSETS,
  ATTRIBUTION,
  COLORS,
  FONT,
  PRINTED_PHOTO_FILE,
  SAFE,
} from '../config';
import {
  AssetVideo,
  Attribution,
  CaptionBar,
  HudChip,
  kenBurnsScale,
} from '../components/ui';

export const Scene07Showcase: React.FC = () => {
  const frame = useCurrentFrame();
  const hasPhoto = PRINTED_PHOTO_FILE !== null;

  // セグメント境界（写真ありの場合は 3 分割、なければ 2 分割で延長）
  const photoStart = 130;
  const secondStart = hasPhoto ? 230 : 165;
  const seg = hasPhoto
    ? frame < photoStart
      ? 0
      : frame < secondStart
        ? 1
        : 2
    : frame < secondStart
      ? 0
      : 1;

  const showSecond = interpolate(frame, [secondStart - 5, secondStart + 7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const showPhoto = hasPhoto
    ? interpolate(frame, [photoStart - 5, photoStart + 7], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  const headOpacity = interpolate(frame, [0, 12], [0, 1], {
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
            justifyContent: 'space-between',
          }}
        >
          <HudChip>{seg === 0 ? '北千住' : seg === 1 && hasPhoto ? '実物プリント' : '新宿'}</HudChip>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 30,
              color: COLORS.dim,
              letterSpacing: '0.1em',
            }}
          >
            3MF / STL
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: 28,
            height: 660,
            borderRadius: 20,
            overflow: 'hidden',
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.surface,
          }}
        >
          {/* 北千住ターンテーブル */}
          <div style={{position: 'absolute', inset: 0}}>
            <AssetVideo
              src={ASSETS.turntableKitasenju}
              fallbackSrc={ASSETS.previewKitasenju}
              fit="contain"
            />
          </div>
          {/* 実物写真（PRINTED_PHOTO_FILE が設定されたら自動表示） */}
          {PRINTED_PHOTO_FILE ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: showPhoto,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  transform: `scale(${kenBurnsScale(frame - photoStart, 100)})`,
                }}
              >
                <Img
                  src={staticFile(PRINTED_PHOTO_FILE)}
                  style={{width: '100%', height: '100%', objectFit: 'contain'}}
                />
              </div>
            </div>
          ) : null}
          {/* 新宿ターンテーブル */}
          <div style={{position: 'absolute', inset: 0, opacity: showSecond}}>
            <AssetVideo
              src={ASSETS.turntableShinjuku}
              fallbackSrc={ASSETS.previewShinjukuWhite}
              fit="contain"
            />
          </div>
          {/* 帰属表示（小さく、常時。メディア右下にオーバーレイ） */}
          <div
            style={{
              position: 'absolute',
              right: 16,
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
            marginTop: 28,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
          }}
        >
          <CaptionBar>3MF / STL — スライサーにそのまま読み込める</CaptionBar>
        </div>
      </div>
    </AbsoluteFill>
  );
};
