import { describe, it, expect } from 'vitest';
import {
  createMachimokiBuffer,
  inspectMachimoki,
  MACHIMOKI_MANIFEST,
  MACHIMOKI_MODEL_3MF,
  MACHIMOKI_MODEL_STL,
} from '../src/machimokiFormat.js';
import { Bounds, ExportOptions } from '../src/types.js';

const bounds: Bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 };

const options: ExportOptions = {
  terrainThickness: 10,
  flattenBottom: true,
  format: '3mf',
  lod: 'lod1',
  includeTerrain: true,
  buildingColor: '#ff0000',
  terrainColor: '#00ff00',
  upAxis: 'z-up',
  scale: 1,
};

describe('machimokiFormat', () => {
  it('creates a ZIP containing manifest.json and model.3mf', () => {
    const model = new TextEncoder().encode('fake-3mf-bytes');
    const buffer = createMachimokiBuffer(model, '3mf', bounds, options, ['a warning']);

    const { manifest, model: extracted, modelFormat } = inspectMachimoki(buffer);

    expect(modelFormat).toBe('3mf');
    expect(extracted).toEqual(model);
    expect(manifest.version).toBe(1);
    expect(manifest.bounds).toEqual(bounds);
    expect(manifest.modelFormat).toBe('3mf');
    expect(manifest.options.terrainThickness).toBe(10);
    expect(manifest.options.buildingColor).toBe('#ff0000');
    expect(manifest.warnings).toEqual(['a warning']);
    expect(manifest.createdAt).toBeTruthy();
  });

  it('uses model.stl for stl models', () => {
    const model = new TextEncoder().encode('fake-stl-bytes');
    const buffer = createMachimokiBuffer(model, 'stl', bounds, options);

    const { manifest, model: extracted, modelFormat } = inspectMachimoki(buffer);

    expect(modelFormat).toBe('stl');
    expect(manifest.modelFormat).toBe('stl');
    expect(extracted).toEqual(model);
  });

  it('throws when manifest.json is missing', () => {
    expect(() => inspectMachimoki(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('exposes the expected entry names', () => {
    expect(MACHIMOKI_MANIFEST).toBe('manifest.json');
    expect(MACHIMOKI_MODEL_3MF).toBe('model.3mf');
    expect(MACHIMOKI_MODEL_STL).toBe('model.stl');
  });
});