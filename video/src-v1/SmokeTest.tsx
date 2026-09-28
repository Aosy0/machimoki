import type {CSSProperties} from 'react';
import {AbsoluteFill} from 'remotion';

const style: CSSProperties = {
  backgroundColor: '#111',
  color: '#fff',
  fontFamily: 'NotoSansJP, sans-serif',
  fontSize: 120,
  fontWeight: 900,
  justifyContent: 'center',
  alignItems: 'center',
};

export const SmokeTest: React.FC = () => {
  return <AbsoluteFill style={style}>日本語フォント表示テスト</AbsoluteFill>;
};
