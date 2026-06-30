import React from 'react';

interface HelpPanelProps {
  mode: 'map' | 'preview';
}

const HelpPanel: React.FC<HelpPanelProps> = ({ mode }) => {
const mapControls = [
    '🖱 左ドラッグ: 地図移動',
    '🖱 中ボタン: 視点回転',
    '🖱 ホイール: ズーム',
    '⌨ Shift + 左ドラッグ: 範囲選択',
  ];

  const previewControls = [
    '🖱 左ドラッグ: 視点回転',
    '🖱 右ドラッグ: 平行移動',
    '🖱 スクロール: ズーム',
  ];

  const controls = mode === 'map' ? mapControls : previewControls;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '12px',
        lineHeight: '1.8',
        zIndex: 100,
        maxWidth: '220px',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
        🎮 操作方法
      </div>
      {controls.map((text, i) => (
        <div key={i}>{text}</div>
      ))}
    </div>
  );
};

export default HelpPanel;
