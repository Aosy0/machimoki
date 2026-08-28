import { describe, it, expect } from 'vitest';
import { app } from '../../src/api/server.js';

// このテストは buildPrintableModel / validateMesh をモックせず、
// 実際の manifold パイプラインを経由して 500 を検出する。
// フロントエンドの「最大辺 150mm 自動調整」相当の小さな scale でも
// エクスポートが成功することを保証する。

describe('API integration - real export (no mocks)', () => {
  it('POST /api/export with frontend auto-scale (150mm) succeeds', async () => {
    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: { west: 139.8053, south: 35.747, east: 139.808, north: 35.7495 },
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
        lod: 'lod1',
        includeTerrain: true,
        scale: 0.0005,
      }),
    });
    if (res.status === 500) {
      const body = await res.json();
      throw new Error(`Expected 200 but got 500: ${JSON.stringify(body)}`);
    }
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  }, 30000);

  it('POST /api/export with tiny bounds and 150mm scale succeeds', async () => {
    // 以前 Bambu Studio 警告の再現に使った極小範囲
    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: { west: 139.6903, south: 35.6997, east: 139.6906, north: 35.7 },
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
        scale: 0.0045, // 27m *0.0045*1000 =122mm, 33m*0.0045*1000=149mm
      }),
    });
    if (res.status === 500) {
      const body = await res.json();
      throw new Error(`Expected 200 but got 500: ${JSON.stringify(body)}`);
    }
    expect(res.status).toBe(200);
  });

  it('POST /api/export with old buggy App.tsx scale (150/maxDim) still succeeds but is huge - should not 500', async () => {
    // 修正前の App.tsx は scale=150/maxDim を送っていた (1000倍大きい)
    // 例: 同じ範囲で scale=0.5 (本来 0.0005 の1000倍)
    // パイプライン自体は巨大でもクラッシュせず 200 を返すことを確認
    // （将来的に巨大モデルのガードを入れる場合このテストは 400 に変わるかもしれない）
    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: { west: 139.8053, south: 35.747, east: 139.808, north: 35.7495 },
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
        scale: 0.5,
      }),
    });
    // 巨大でも 500 になってはならない。422 (validation fail) か 200 のいずれか
    expect([200, 422]).toContain(res.status);
    if (res.status === 500) {
      const body = await res.json();
      throw new Error(`Should not be 500: ${JSON.stringify(body)}`);
    }
  });
});
