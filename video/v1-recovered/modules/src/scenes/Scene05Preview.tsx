// Scene 5 — STEP 2: プレビューして調整（f750–1110 / 12s）
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ASSETS, ATTRIBUTION, COLORS, FONT, SAFE} from '../config';
import {
  AssetImage,
  AssetVideo,
  Attribution,
  CaptionBar,
  HighlightRing,
  HudChip,
  StepChip,
  kenBurnsScale,
} from '../components/ui';

const MEDIA_H = 600;

const HUDS = ['LOD1', '地形厚み 10mm', '底面フラット化', '白模型プレビュー'] as const;

export const Scene05Preview: React.FC = () => {
  const frame = useCurrentFrame();

  const chipOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // メディアセグメントのクロスフェード
  const layerB = interpolate(frame, [115, 127], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const layerC = interpolate(frame, [225, 237], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const seg = frame < 122 ? 0 : frame < 232 ? 1 : 2;
  const captions = [
    '建物と地形を自動で統合',
    '地形の厚み・底面のフラット化をワンクリック',
    '不要な建物はクリックで除外',
  ] as const;
  const capStart = [8, 130, 240][seg];
  const capOpacity = interpolate(frame, [capStart, capStart + 12], [0, 1], {
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
          opacity: chipOpacity,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <StepChip>STEP 2 — プレビューして調整</StepChip>
          <div style={{display: 'flex', flexDirection: 'row', gap: 16}}>
            {HUDS.map((hud, i) => {
              const start = 20 + i * 10;
              const o = interpolate(frame, [start, start + 10], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              return (
                <div key={hud} style={{opacity: o}}>
                  <HudChip>{hud}</HudChip>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: 32,
            height: MEDIA_H,
            borderRadius: 20,
            overflow: 'hidden',
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.surface,
          }}
        >
          {/* 1: 建物+地形の統合プレビュー */}
          <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
            <div
              style={{
                width: '100%',
                height: '100%',
                transform: `scale(${kenBurnsScale(frame, 120)})`,
              }}
            >
              <AssetImage src={ASSETS.previewKitasenju} />
            </div>
          </div>
          {/* 2: 設定パネル */}
          <div style={{position: 'absolute', inset: 0, opacity: layerB}}>
            <AssetImage src={ASSETS.previewKitasenjuSettings} />
          </div>
          {/* 3: ターンテーブル（実ファイルが来たら動画、なければ白模型スティル） */}
          <div style={{position: 'absolute', inset: 0, opacity: layerC}}>
            <AssetVideo
              src={ASSETS.turntableKitasenju}
              fallbackSrc={ASSETS.previewShinjukuWhite}
            />
          </div>
          {/* 設定パネル・建物一覧へのハイライト */}
          {seg === 1 ? (
            <HighlightRing left={1180} top={60} width={420} height={480} />
          ) : null}
          {/* 帰属表示（小さく、常時。メディア左下にオーバーレイ） */}
          <div
            style={{
              position: 'absolute',
              left: 16,
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
            marginTop: 32,
            display: 'flex',
            justifyContent: 'center',
            opacity: capOpacity,
          }}
        >
          <CaptionBar>{captions[seg]}</CaptionBar>
        </div>
      </div>
    </AbsoluteFill>
  );
};
