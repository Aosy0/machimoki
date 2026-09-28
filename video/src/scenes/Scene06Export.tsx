// Scene 6 — 03 エクスポートと検証（f1110–1350 / 8s）
// 検証値は captures/output-kitasenju.validate.json の実測（捏造禁止）。
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ASSETS, COLORS, FONT, MONO, SAFE, VALIDATE} from '../config';
import {AssetImage, AssetVideo, Plate, SourceLine, fadeIn} from '../components/ui';

const ROWS = [
  {key: 'open_edges', value: String(VALIDATE.openEdges)},
  {key: 'non_manifold_edges', value: String(VALIDATE.nonManifoldEdges)},
  {key: 'self_intersections', value: String(VALIDATE.selfIntersections)},
  {key: 'numShells', value: String(VALIDATE.numShells)},
] as const;

export const Scene06Export: React.FC = () => {
  const frame = useCurrentFrame();

  // 図版の切替: 設定スティル → クリップ → 完了スティル
  const clipLayer = interpolate(frame, [70, 82], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const doneLayer = interpolate(frame, [110, 122], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // テーブル出現（1回目）と判定出現（2回目）。完成状態を local 152–239 で保持
  const tableOpacity = fadeIn(frame, 40, 12);
  const verdictOpacity = fadeIn(frame, 140, 12);

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
        <div
          style={{
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: COLORS.ink,
          }}
        >
          03 エクスポートと検証
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 48,
            marginTop: 20,
            alignItems: 'flex-start',
          }}
        >
          <div style={{width: 1000}}>
            <Plate height={580}>
              <div style={{position: 'absolute', inset: 0}}>
                <AssetImage src={ASSETS.previewKitasenjuSettings} />
              </div>
              <div style={{position: 'absolute', inset: 0, opacity: clipLayer}}>
                <AssetVideo
                  src={ASSETS.exportFlow}
                  fallbackSrc={ASSETS.exportDone}
                />
              </div>
              <div style={{position: 'absolute', inset: 0, opacity: doneLayer}}>
                <AssetImage src={ASSETS.exportDone} />
              </div>
            </Plate>
          </div>

          <div style={{flex: 1, opacity: tableOpacity}}>
            <div style={{fontFamily: MONO, fontSize: 30, lineHeight: 1.5}}>
              {ROWS.map((row) => (
                <div
                  key={row.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    borderBottom: `1px solid ${COLORS.rule}`,
                    padding: '13px 0',
                  }}
                >
                  <span style={{fontWeight: 400, color: COLORS.muted}}>
                    {row.key}
                  </span>
                  <span style={{fontWeight: 500, color: COLORS.ink}}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                borderTop: `2px solid ${COLORS.ink}`,
                marginTop: 16,
                paddingTop: 14,
                opacity: verdictOpacity,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  fontFamily: MONO,
                  fontSize: 30,
                }}
              >
                <span style={{fontWeight: 400, color: COLORS.muted}}>判定</span>
                <span style={{fontWeight: 500, color: COLORS.pass}}>
                  {VALIDATE.status}
                </span>
              </div>
              <div
                style={{
                  marginTop: 18,
                  fontFamily: MONO,
                  fontWeight: 400,
                  fontSize: 24,
                  color: COLORS.muted,
                }}
              >
                numTri {VALIDATE.numTri} ／ numVert {VALIDATE.numVert} ／
                statusCode {VALIDATE.statusCode}
              </div>
            </div>
          </div>
        </div>

        <div style={{marginTop: 18}}>
          <div style={{fontSize: 34, fontWeight: 500, color: COLORS.ink}}>
            出力時に自動検証し、通らなければファイルを破棄する
          </div>
        </div>

        <div style={{marginTop: 'auto', paddingTop: 8}}>
          <SourceLine
            text="出典: PLATEAU（国土交通省） ／ 国土地理院 ／ Cesium"
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
