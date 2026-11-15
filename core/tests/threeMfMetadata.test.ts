import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import {
  cleanupManifoldImports,
  createBox,
  exportPartsTo3MF,
  exportTo3MF,
  importFrom3MF,
} from '../src/manifoldOps.js';

/** 3MF(ZIP) から `3D/3dmodel.model` の XML を取り出す。 */
function readModelXml(buffer: Uint8Array): string {
  const files = unzipSync(buffer);
  const model = files['3D/3dmodel.model'];
  expect(model).toBeDefined();
  return strFromU8(model);
}

describe('3MF metadata', () => {
  it('writes the default Title and Application when no metadata is given', async () => {
    const box = await createBox(1);
    try {
      const xml = readModelXml(await exportTo3MF(box));
      expect(xml).toContain('<metadata name="Title">Machimoki model</metadata>');
      expect(xml).toContain('<metadata name="Application">Machimoki</metadata>');
      // 3MF 仕様では metadata は resources より前。
      expect(xml.indexOf('<metadata')).toBeLessThan(xml.indexOf('<resources>'));
    } finally {
      box.delete();
      cleanupManifoldImports();
    }
  });

  it('writes custom metadata before <resources> and overrides the defaults', async () => {
    const box = await createBox(1);
    try {
      const xml = readModelXml(
        await exportTo3MF(box, undefined, 'z-up', {
          Title: 'Shinjuku 1:1000',
          Description: '35.68120N 139.76710E\nMESH 5339-46-11',
          CreationDate: '2026-11-10T00:00:00.000Z',
          Application: 'Machimoki CLI',
        }),
      );

      expect(xml).toContain('<metadata name="Title">Shinjuku 1:1000</metadata>');
      expect(xml).toContain('<metadata name="Application">Machimoki CLI</metadata>');
      expect(xml).toContain('<metadata name="CreationDate">2026-11-10T00:00:00.000Z</metadata>');
      // 複数行の値もそのまま（改行はXMLのテキストとして有効）保存される。
      expect(xml).toContain(
        '<metadata name="Description">35.68120N 139.76710E\nMESH 5339-46-11</metadata>',
      );
      expect(xml.indexOf('<metadata')).toBeLessThan(xml.indexOf('<resources>'));
      // 既定値が上書きされ、二重に出力されていない。
      expect(xml).not.toContain('Machimoki model');
      expect(xml.match(/<metadata name="Title">/g)).toHaveLength(1);
      expect(xml.match(/<metadata name="Application">/g)).toHaveLength(1);
    } finally {
      box.delete();
      cleanupManifoldImports();
    }
  });

  it('XML-escapes metadata values and names (& < > " \')', async () => {
    const box = await createBox(1);
    try {
      const xml = readModelXml(
        await exportTo3MF(box, undefined, 'z-up', {
          Description: 'A & B <tag> "dq" \'sq\'',
          'Custom "Name"': 'x&y',
        }),
      );

      expect(xml).toContain(
        '<metadata name="Description">A &amp; B &lt;tag&gt; &quot;dq&quot; &apos;sq&apos;</metadata>',
      );
      expect(xml).toContain('<metadata name="Custom &quot;Name&quot;">x&amp;y</metadata>');
      // 生の特殊文字がXMLに漏れていない（タグ・属性として解釈されない）。
      expect(xml).not.toContain('<tag>');
      expect(xml).not.toContain('"dq"');
    } finally {
      box.delete();
      cleanupManifoldImports();
    }
  });

  it('keeps the exported 3MF importable when metadata is present', async () => {
    const box = await createBox(2);
    try {
      const buffer = await exportTo3MF(box, '#ff0000', 'z-up', {
        Description: 'roundtrip <>&"\'',
      });
      const imported = await importFrom3MF(buffer);
      try {
        expect(imported.status()).toBe('NoError');
        expect(imported.volume()).toBeCloseTo(8, 6);
      } finally {
        imported.delete();
      }
    } finally {
      box.delete();
      cleanupManifoldImports();
    }
  });

  it('exportPartsTo3MF forwards metadata too', async () => {
    const box = await createBox(1);
    try {
      const buffer = await exportPartsTo3MF([{ manifold: box }], 'y-up', {
        Description: 'parts metadata',
      });
      const xml = readModelXml(buffer);
      expect(xml).toContain('<metadata name="Description">parts metadata</metadata>');
      expect(xml.indexOf('<metadata')).toBeLessThan(xml.indexOf('<resources>'));
    } finally {
      box.delete();
      cleanupManifoldImports();
    }
  });
});
