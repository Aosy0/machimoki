// Scene 7 — ショーケース（f1350–1680 / 11s）
// シグネチャ: 白模型に実寸の寸法線を重ねる（数値はアプリ表示の実測）。
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Img} from 'remotion';
import {
  ASSETS,
  ATTRIBUTION,
  COLORS,
  DIMS,
  FONT,
  MONO,
  PRINTED_PHOTO_FILE,
  SAFE,
} from '../config';
import {
  AssetVideo,
  Plate,
  SourceLine,
  fadeIn,
} from '../components/ui';

// 実寸の寸法線（白模型用。線と注記タグはベタ塗りのみ）
const DimLines: React.FC<{w: string; d: string}> = ({w, d}) => (
  <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
    {/* 上辺: 幅 */}
    <div
      style={{
        position: 'absolute',
        left: '22%',
        right: '22%',
        top: 30,
        height: 2,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: '22%',
        top: 22,
        width: 2,
        height: 18,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        right: '22%',
        top: 22,
        width: 2,
        height: 18,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        backgroundColor: COLORS.plate,
        color: COLORS.ink,
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: 26,
        padding: '2px 14px',
      }}
    >
      W {w} mm
    </div>
    {/* 右辺: 奥行 */}
    <div
      style={{
        position: 'absolute',
        top: '20%',
        bottom: '20%',
        right: 44,
        width: 2,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        top: '20%',
        right: 36,
        width: 18,
        height: 2,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        bottom: '20%',
        right: 36,
        width: 18,
        height: 2,
        backgroundColor: COLORS.plate,
      }}
    />
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: '50%',
        transform: 'translateY(-50%) rotate(90deg)',
        transformOrigin: 'center center',
        backgroundColor: COLORS.plate,
        color: COLORS.ink,
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: 26,
        padding: '2px 14px',
        whiteSpace: 'nowrap',
      }}
    >
      D {d} mm
    </div>
  </div>
);

export const Scene07Showcase: React.FC = () => {
  const frame = useCurrentFrame();
  const hasPhoto = PRINTED_PHOTO_FILE !== null;

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

  const dims = seg === 0 ? DIMS.kitasenju : DIMS.shinjuku;
  const dimsOpacity = fadeIn(frame, (seg === 0 ? 0 : secondStart) + 8, 10);

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground, padding: SAFE}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: FONT,
          opacity: fadeIn(frame, 0, 10),
        }}
      >
        <div style={{fontSize: 36, fontWeight: 500, color: COLORS.ink}}>
          {seg === 0 ? '北千住（足立区）' : seg === 1 && hasPhoto ? '実物プリント' : '新宿'}
        </div>

        <div style={{marginTop: 16}}>
          <Plate height={620}>
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
              <div style={{position: 'absolute', inset: 0, opacity: showPhoto}}>
                <Img
                  src={staticFile(PRINTED_PHOTO_FILE)}
                  style={{width: '100%', height: '100%', objectFit: 'contain'}}
                />
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
            {/* シグネチャ: 実寸の寸法線 */}
            {!(seg === 1 && hasPhoto) ? (
              <div style={{position: 'absolute', inset: 0, opacity: dimsOpacity}}>
                <DimLines w={dims.w} d={dims.d} />
              </div>
            ) : null}
          </Plate>
        </div>

        <div style={{marginTop: 16, fontSize: 34, fontWeight: 500, color: COLORS.ink}}>
          出力した3MF / STLはスライサーに読み込める
        </div>

        <div style={{marginTop: 'auto', paddingTop: 8}}>
          <SourceLine text={ATTRIBUTION} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
