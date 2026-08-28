/**
 * Manifold creation, boolean, and import/export operations.
 */

import { getManifoldModule } from 'manifold-3d/lib/wasm.js';
import { importManifold, cleanup as cleanupImportModel } from 'manifold-3d/lib/import-model.js';
import type { Manifold } from 'manifold-3d';
import { strToU8, zipSync } from 'fflate';

import { RawMesh, UpAxis } from './types.js';
import { parseSTL } from './stlParser.js';
import { writeBinarySTL } from './stlWriter.js';

async function getWasm() {
  return getManifoldModule();
}

/**
 * Convert positions from the internal engine frame (x=east, y=up, z=south)
 * to the requested up-axis for export:
 *  - 'y-up': identity (already Y-up)
 *  - 'z-up': (x, y, z) -> (x, -z, y) — a right-handed rotation about X that
 *    maps up (y) to z and south (z) to north (-y).
 */
export function transformForUpAxis(positions: Float32Array, upAxis: UpAxis): Float32Array {
  if (upAxis === 'y-up') return positions;
  const transformed = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    transformed[i] = positions[i];
    transformed[i + 1] = -positions[i + 2];
    transformed[i + 2] = positions[i + 1];
  }
  return transformed;
}

const METERS_TO_MM = 1000;
const MM_TO_METERS = 0.001;

/**
 * Scale positions by a uniform factor (e.g. m → mm).
 */
function scalePositions(positions: Float32Array, factor: number): Float32Array {
  const scaled = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    scaled[i] = positions[i] * factor;
  }
  return scaled;
}

function meshToRaw(manifoldMesh: {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}): RawMesh {
  return {
    positions: manifoldMesh.vertProperties,
    indices: manifoldMesh.triVerts,
  };
}

function rawToMeshOptions(mesh: RawMesh) {
  return {
    numProp: 3,
    vertProperties: mesh.positions,
    triVerts: mesh.indices,
  };
}

/**
 * Create a Manifold from a RawMesh.
 */
export async function createManifoldFromMesh(mesh: RawMesh): Promise<Manifold> {
  const wasm = await getWasm();
  const { Manifold: ManifoldCtor, Mesh } = wasm;
  const meshObj = new Mesh(rawToMeshOptions(mesh));
  // Merge coincident vertices so that STL-style unshared vertex data can
  // reconstruct a manifold solid.
  meshObj.merge();
  return new ManifoldCtor(meshObj);
}

/**
 * Create a Manifold for each RawMesh and return their boolean union.
 */
export async function unionMeshes(meshes: RawMesh[]): Promise<Manifold> {
  if (meshes.length === 0) {
    throw new Error('Cannot compute union of empty mesh list');
  }
  const wasm = await getWasm();
  const manifolds: Manifold[] = [];
  try {
    for (const mesh of meshes) {
      const meshObj = new wasm.Mesh(rawToMeshOptions(mesh));
      meshObj.merge();
      manifolds.push(new wasm.Manifold(meshObj));
    }
    return wasm.Manifold.union(manifolds);
  } catch (error) {
    for (const manifold of manifolds) {
      manifold.delete();
    }
    throw error;
  }
}

/**
 * Export a Manifold to a 3MF buffer.
 *
 * @param manifold The manifold to export.
 * @param color Optional hex color string (e.g. "#ff0000") applied to the object.
 * @param upAxis Which axis points up in the exported model (default 'z-up').
 */
export async function exportTo3MF(
  manifold: Manifold,
  color?: string,
  upAxis: UpAxis = 'z-up',
): Promise<Uint8Array> {
  return exportPartsTo3MF([{ manifold, color }], upAxis);
}

/**
 * Normalize a hex color to the 3MF material format `#RRGGBBAA` (uppercase).
 * 6-digit colors get an opaque alpha (`FF`) appended; anything else falls back
 * to opaque white.
 */
function normalizeColor(color: string): string {
  let hex = color.trim();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  hex = hex.slice(1);
  if (hex.length === 6) hex += 'FF';
  if (hex.length !== 8) return '#FFFFFFFF';
  return `#${hex.toUpperCase()}`;
}

/**
 * Generate 3MF model XML with colored parts.
 *
 * 3MF supports per-object colors via <colorgroup> resources referenced by
 * pid/pindex on <object> elements. The material extension is only declared
 * when a non-white color is actually used, so pure-geometry white models
 * stay compatible with slicers that warn on unused extensions (e.g. Bambu Studio).
 */
function buildColored3mfXml(
  parts: Array<{ positions: Float32Array; indices: Uint32Array; color?: string }>,
  precision: number,
): string {
  const out: string[] = [];

  const hasColor = parts.some((p) => p.color && normalizeColor(p.color) !== '#FFFFFFFF');
  const modelHeader = hasColor
    ? `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">Machimoki model</metadata>
  <metadata name="Application">Machimoki</metadata>
  <resources>
`
    : `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Machimoki model</metadata>
  <metadata name="Application">Machimoki</metadata>
  <resources>
`;
  out.push(modelHeader);

  const partCount = parts.length;

  const colorGroups: Array<{ groupId: number; hex: string }> = [];
  for (let i = 0; i < partCount; i++) {
    const c = parts[i].color;
    if (c) {
      const normalized = normalizeColor(c);
      if (normalized === '#FFFFFFFF') continue;
      colorGroups.push({ groupId: partCount + 1 + colorGroups.length, hex: normalized });
    }
  }

  for (const cg of colorGroups) {
    out.push(`    <m:colorgroup id="${cg.groupId}">
      <m:color color="${cg.hex}"/>
    </m:colorgroup>
`);
  }

  let colorGroupIdx = 0;
  for (let i = 0; i < partCount; i++) {
    const { positions, indices, color } = parts[i];
    const objectId = i + 1;

    const normalized = color ? normalizeColor(color) : null;
    const useColor = normalized && normalized !== '#FFFFFFFF';
    const pidAttr = useColor ? ` pid="${colorGroups[colorGroupIdx].groupId}"` : '';
    const pidxAttr = useColor ? ' pindex="0"' : '';
    if (useColor) colorGroupIdx++;

    out.push(`    <object id="${objectId}" type="model"${pidAttr}${pidxAttr}>
      <mesh>
        <vertices>
`);

    for (let j = 0; j < positions.length; j += 3) {
      const x = positions[j].toPrecision(precision);
      const y = positions[j + 1].toPrecision(precision);
      const z = positions[j + 2].toPrecision(precision);
      out.push(`          <vertex x="${x}" y="${y}" z="${z}" />
`);
    }

    out.push(`        </vertices>
        <triangles>
`);

    for (let j = 0; j < indices.length; j += 3) {
      out.push(`          <triangle v1="${indices[j]}" v2="${indices[j + 1]}" v3="${indices[j + 2]}" />
`);
    }

    out.push(`        </triangles>
      </mesh>
    </object>
`);
  }

  out.push(`  </resources>
  <build>
`);

  for (let i = 0; i < partCount; i++) {
    out.push(`    <item objectid="${i + 1}" />
`);
  }

  out.push(`  </build>
</model>
`);

  return out.join('');
}

/**
 * Build a complete 3MF ZIP buffer from colored parts.
 *
 * Uses the same package metadata as manifold-3d's export3mf so slicers
 * (Bambu Studio, PrusaSlicer, ...) accept the file as valid:
 * - [Content_Types].xml declares the 3D model MIME type
 *   `application/vnd.ms-package.3dmanufacturing-3dmodel+xml`
 * - _rels/.rels targets `3D/3dmodel.model` without a leading slash
 */
function createColored3mfZip(xml: string): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="png" ContentType="image/png"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(xml),
  };

  return zipSync(files);
}

/**
 * Export multiple parts to a single 3MF buffer.
 *
 * All parts are merged into a single manifold and written as exactly one
 * <object> with one <build> <item>. Bambu Studio warns on multi-object /
 * multi-height files, so a single merged object is the safe default. The
 * merged object uses a single color (the first part's color, or white).
 */
export async function exportPartsTo3MF(
  parts: Array<
    | { manifold: Manifold; color?: string }
    | { mesh: RawMesh; color?: string }
  >,
  upAxis: UpAxis = 'z-up',
): Promise<Uint8Array> {
  if (parts.length === 0) {
    throw new Error('No parts to export');
  }

  const meshes: RawMesh[] = [];
  for (const part of parts) {
    if ('mesh' in part) {
      if (part.mesh.positions.length > 0 && part.mesh.indices.length > 0) {
        meshes.push(part.mesh);
      }
    } else {
      const m = part.manifold.getMesh();
      if (m.vertProperties.length > 0 && m.triVerts.length > 0) {
        meshes.push({ positions: m.vertProperties, indices: m.triVerts });
      }
    }
  }

  if (meshes.length === 0) {
    throw new Error('No parts to export');
  }

  const rawColor = parts.find((p) => p.color)?.color;
  const normalized = rawColor ? normalizeColor(rawColor) : '#FFFFFFFF';
  const color = normalized === '#FFFFFFFF' ? undefined : rawColor;

  const union = await unionMeshes(meshes);
  try {
    const mesh = union.getMesh();
    const positions = scalePositions(transformForUpAxis(mesh.vertProperties, upAxis), METERS_TO_MM);
    const meshParts = [
      {
        positions,
        indices: mesh.triVerts,
        color,
      },
    ];
    const xml = buildColored3mfXml(meshParts, 7);
    return createColored3mfZip(xml);
  } finally {
    union.delete();
  }
}

export function mergeRawMeshes(meshes: RawMesh[]): RawMesh {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const m of meshes) {
    totalVerts += m.positions.length;
    totalIndices += m.indices.length;
  }
  const positions = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);
  let vertOffset = 0;
  let idxOffset = 0;
  for (const m of meshes) {
    positions.set(m.positions, vertOffset);
    for (let i = 0; i < m.indices.length; i++) {
      indices[idxOffset + i] = m.indices[i] + (vertOffset / 3);
    }
    vertOffset += m.positions.length;
    idxOffset += m.indices.length;
  }
  return { positions, indices };
}

export function exportMeshesToSTL(meshes: RawMesh[], upAxis: UpAxis = 'z-up'): Uint8Array {
  const merged = mergeRawMeshes(meshes);
  let positions = scalePositions(transformForUpAxis(merged.positions, upAxis), METERS_TO_MM);
  // Weld after scaling to collapse near-coincident vertices that cause Bambu's non-manifold detection
  const welded = weldVerticesForSTL({ positions, indices: merged.indices });
  return writeBinarySTL(welded);
}

function weldVerticesForSTL(mesh: RawMesh, tolerance = 1e-4): RawMesh {
  if (mesh.positions.length === 0) return mesh;
  const cellSize = tolerance;
  const cells = new Map<string, number[]>();
  const newPositions: number[] = [];
  const remap = new Uint32Array(mesh.positions.length / 3);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const cz = Math.floor(z / cellSize);
    let found: number | undefined;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list) {
            for (const idx of list) {
              const ox = newPositions[idx * 3];
              const oy = newPositions[idx * 3 + 1];
              const oz = newPositions[idx * 3 + 2];
              if (Math.abs(ox - x) <= tolerance && Math.abs(oy - y) <= tolerance && Math.abs(oz - z) <= tolerance) {
                found = idx;
                break outer;
              }
            }
          }
        }
      }
    }
    if (found === undefined) {
      found = newPositions.length / 3;
      const key = `${cx},${cy},${cz}`;
      const list = cells.get(key) ?? [];
      list.push(found);
      cells.set(key, list);
      newPositions.push(x, y, z);
    }
    remap[i / 3] = found;
  }
  const newIndices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) newIndices[i] = remap[mesh.indices[i]];
  return { positions: new Float32Array(newPositions), indices: newIndices };
}

export async function exportMeshesTo3MF(meshes: RawMesh[], upAxis: UpAxis = 'z-up'): Promise<Uint8Array> {
  const nonEmpty = meshes.filter((m) => m.positions.length > 0 && m.indices.length > 0);
  if (nonEmpty.length === 0) {
    throw new Error('No meshes to export');
  }

  const union = await unionMeshes(nonEmpty);
  try {
    const mesh = union.getMesh();
    const positions = scalePositions(transformForUpAxis(mesh.vertProperties, upAxis), METERS_TO_MM);
    const meshParts = [
      {
        positions,
        indices: mesh.triVerts,
        color: undefined,
      },
    ];
    const xml = buildColored3mfXml(meshParts, 7);
    return createColored3mfZip(xml);
  } finally {
    union.delete();
  }
}

export function exportToSTL(manifold: Manifold, upAxis: UpAxis = 'z-up'): Uint8Array {
  const raw = meshToRaw(manifold.getMesh());
  let positions = scalePositions(transformForUpAxis(raw.positions, upAxis), METERS_TO_MM);
  const welded = weldVerticesForSTL({ positions, indices: raw.indices });
  return writeBinarySTL(welded);
}

function bufferToArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

/**
 * Import a Manifold from a 3MF buffer.
 */
export async function importFrom3MF(buffer: Uint8Array): Promise<Manifold> {
  await getWasm();
  const arrayBuffer = bufferToArrayBuffer(buffer);
  const manifold = await importManifold(arrayBuffer, { mimetype: 'model/3mf' });
  const scaled = manifold.transform([MM_TO_METERS, 0, 0, 0, 0, MM_TO_METERS, 0, 0, 0, 0, MM_TO_METERS, 0, 0, 0, 0, 1]);
  manifold.delete();
  return scaled;
}

/**
 * Import a Manifold from an STL buffer.
 */
export async function importFromSTL(buffer: Uint8Array): Promise<Manifold> {
  const rawMesh = parseSTL(buffer);
  rawMesh.positions = scalePositions(rawMesh.positions, MM_TO_METERS);
  return createManifoldFromMesh(rawMesh);
}

/**
 * Release internal import-model caches. Manifold instances must still be
 * deleted individually with `manifold.delete()`.
 */
export function cleanupManifoldImports(): void {
  cleanupImportModel();
}
