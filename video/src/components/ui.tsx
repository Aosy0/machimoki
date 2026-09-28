// v2 共通部品（製作仕様書トーン）。装飾は 2px 構造線と実データのみ。
import React, {useEffect, useState} from 'react';
import {
  Img,
  OffthreadVideo,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
} from 'remotion';
import {COLORS, FONT, MONO} from '../config';

// ---------- 存在チェックつき素材（検出ロジックは v1 のまま） ----------
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

// 欠落時は白地の図版枠＋小さなワードマークのみ（パス・説明文なし）
export const AssetMissing: React.FC<{file: string; height?: number | string}> = ({
  height = '100%',
}) => (
  <div
    style={{
      width: '100%',
      height,
      minHeight: 200,
      backgroundColor: COLORS.plate,
      border: `1px solid ${COLORS.rule}`,
      borderRadius: 4,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    <div
      style={{
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: 34,
        letterSpacing: '-0.01em',
        color: COLORS.rule,
      }}
    >
      machimoki
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

// ---------- v2 見た目の部品 ----------

// 単色ワードマーク（グラデーション禁止）
export const Wordmark: React.FC<{fontSize: number}> = ({fontSize}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 700,
      fontSize,
      letterSpacing: '-0.01em',
      lineHeight: 1,
      color: COLORS.ink,
    }}
  >
    machimoki
  </div>
);

// 2px 構造線（左→右に描画）。フェードと並ぶ数少ないモーションの1つ
export const Rule2: React.FC<{frame: number; delay?: number; length?: number}> = ({
  frame,
  delay = 0,
  length = 12,
}) => {
  const w = interpolate(frame, [delay, delay + length], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        height: 2,
        backgroundColor: COLORS.ink,
        transform: `scaleX(${w})`,
        transformOrigin: 'left center',
      }}
    />
  );
};

// アプリ素材を載せる図版プレート（白地・1px rule枠・角丸4px・影なし）
export const Plate: React.FC<{
  children: React.ReactNode;
  height: number;
}> = ({children, height}) => (
  <div
    style={{
      position: 'relative',
      height,
      backgroundColor: COLORS.plate,
      border: `1px solid ${COLORS.rule}`,
      borderRadius: 4,
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

// UI注目箇所の細い静止アウトライン（グロー・パルスなし）
export const Outline: React.FC<{
  left: number;
  top: number;
  width: number;
  height: number;
}> = ({left, top, width, height}) => (
  <div
    style={{
      position: 'absolute',
      left,
      top,
      width,
      height,
      border: `2px solid ${COLORS.accent}`,
      borderRadius: 4,
      pointerEvents: 'none',
    }}
  />
);

// 等幅データ行
export const DataLine: React.FC<{children: React.ReactNode; size?: number}> = ({
  children,
  size = 28,
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontWeight: 400,
      fontSize: size,
      lineHeight: 1.6,
      color: COLORS.ink,
    }}
  >
    {children}
  </div>
);

// 小さな帰属・出典行
export const SourceLine: React.FC<{text: string}> = ({text}) => (
  <div
    style={{
      fontFamily: FONT,
      fontWeight: 400,
      fontSize: 22,
      color: COLORS.muted,
    }}
  >
    {text}
  </div>
);

// フェード出現（8〜12F）。スライドは使わない
export const fadeIn = (frame: number, delay: number, length = 10): number =>
  interpolate(frame, [delay, delay + length], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
