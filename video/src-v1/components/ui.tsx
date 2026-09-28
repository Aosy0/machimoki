// 複数シーンで使う共通部品のみ。過剰抽象化しない。
import React, {useEffect, useState} from 'react';
import {
  Img,
  OffthreadVideo,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {COLORS, FONT} from '../config';

// ---------- 存在チェックつき素材 ----------
// captures/ は別レーンが生成中のため、実在しない場合は中立プレースホルダに
// フォールバックする。実ファイルが来たら自動で表示される。
const availabilityCache = new Map<string, boolean>();

export const useAssetAvailable = (path: string): boolean | null => {
  const [handle] = useState(() => delayRender(`asset:${path}`));
  const [state, setState] = useState<boolean | null>(() =>
    availabilityCache.has(path) ? availabilityCache.get(path) ?? false : null,
  );
  useEffect(() => {
    if (availabilityCache.has(path)) {
      setState(availabilityCache.get(path) ?? false);
      continueRender(handle);
      return;
    }
    let cancelled = false;
    fetch(staticFile(path), {method: 'HEAD'}).then(
      (res) => {
        const ok = res.ok || res.status === 405;
        availabilityCache.set(path, ok);
        if (!cancelled) {
          setState(ok);
          continueRender(handle);
        }
      },
      () => {
        availabilityCache.set(path, false);
        if (!cancelled) {
          setState(false);
          continueRender(handle);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, handle]);
  return state;
};

export const AssetMissing: React.FC<{file: string; height?: number | string}> = ({
  height = '100%',
}) => (
  <div
    style={{
      width: '100%',
      height,
      minHeight: 200,
      backgroundColor: COLORS.panel,
      backgroundImage: `repeating-linear-gradient(45deg, rgba(76, 194, 255, 0.05) 0px, rgba(76, 194, 255, 0.05) 2px, transparent 2px, transparent 26px)`,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 20,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: FONT,
      opacity: 0.9,
    }}
  >
    <div style={{opacity: 0.55}}>
      <Logo fontSize={56} />
    </div>
  </div>
);

export const AssetImage: React.FC<{
  src: string;
  style?: React.CSSProperties;
  fit?: 'cover' | 'contain';
  position?: string;
}> = ({src, style, fit = 'cover', position = 'center'}) => {
  const available = useAssetAvailable(src);
  if (available !== true) {
    return <AssetMissing file={src} />;
  }
  return (
    <Img
      src={staticFile(src)}
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
        objectPosition: position,
        ...style,
      }}
    />
  );
};

export const AssetVideo: React.FC<{
  src: string;
  fallbackSrc?: string;
  style?: React.CSSProperties;
  fit?: 'cover' | 'contain';
  position?: string;
}> = ({src, fallbackSrc, style, fit = 'cover', position = 'center'}) => {
  const available = useAssetAvailable(src);
  if (available === null) {
    return <AssetMissing file={src} />;
  }
  if (available === false) {
    if (fallbackSrc) {
      return <AssetImage src={fallbackSrc} style={style} fit={fit} position={position} />;
    }
    return <AssetMissing file={src} />;
  }
  return (
    <OffthreadVideo
      src={staticFile(src)}
      pauseWhenBuffering
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
        objectPosition: position,
        ...style,
      }}
    />
  );
};

// ---------- 見た目の部品 ----------

export const Logo: React.FC<{fontSize: number}> = ({fontSize}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 900,
      fontSize,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      background: `linear-gradient(92deg, ${COLORS.accent}, ${COLORS.green})`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    }}
  >
    machimoki
  </div>
);

export const Kicker: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 30,
      letterSpacing: '0.35em',
      color: COLORS.accent,
    }}
  >
    {children}
  </div>
);

export const StepChip: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      display: 'inline-block',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 34,
      letterSpacing: '0.08em',
      color: COLORS.accent,
      border: `2px solid ${COLORS.accent}`,
      borderRadius: 999,
      padding: '10px 34px',
      backgroundColor: 'rgba(76, 194, 255, 0.08)',
    }}
  >
    {children}
  </div>
);

// 画面下部の字幕バー。40–44px 目安。
export const CaptionBar: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      display: 'inline-block',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 42,
      lineHeight: 1.5,
      color: COLORS.text,
      backgroundColor: 'rgba(22, 27, 34, 0.92)',
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16,
      padding: '16px 40px',
    }}
  >
    {children}
  </div>
);

export const HudChip: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 30,
      color: COLORS.text,
      backgroundColor: 'rgba(28, 35, 48, 0.92)',
      border: `1px solid ${COLORS.border}`,
      borderLeft: `6px solid ${COLORS.accent}`,
      borderRadius: 12,
      padding: '12px 24px',
    }}
  >
    {children}
  </div>
);

// UI の注目箇所に重ねるシアンのハイライトリング（決定論的パルス）
export const HighlightRing: React.FC<{
  left: number;
  top: number;
  width: number;
  height: number;
  radius?: number;
}> = ({left, top, width, height, radius = 24}) => {
  const frame = useCurrentFrame();
  const t = (frame % 45) / 45;
  const scale = interpolate(t, [0, 0.5, 1], [1, 1.06, 1]);
  const opacity = interpolate(t, [0, 0.5, 1], [0.95, 0.55, 0.95]);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        border: `4px solid ${COLORS.accent}`,
        borderRadius: radius,
        transform: `scale(${scale})`,
        opacity,
        boxShadow: `0 0 32px rgba(76, 194, 255, 0.45)`,
        pointerEvents: 'none',
      }}
    />
  );
};

export const Attribution: React.FC<{text: string}> = ({text}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 400,
      fontSize: 24,
      color: COLORS.dim,
    }}
  >
    {text}
  </div>
);

// 3200x1800 スティル用のゆっくりズーム（3〜5%）。決定論的。
export const kenBurnsScale = (frame: number, duration: number): number =>
  interpolate(frame, [0, duration], [1, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
