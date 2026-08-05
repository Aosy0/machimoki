/**
 * Manifold creation, boolean, and import/export operations.
 */

import { Document } from '@gltf-transform/core';
import { getManifoldModule } from 'manifold-3d/lib/wasm.js';
import { writeMesh } from 'manifold-3d/lib/gltf-io.js';
import { toArrayBuffer as export3mf } from 'manifold-3d/lib/export-3mf.js';
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

function createId2Properties(
  doc: Document,
  manifoldMesh: { runOriginalID: Uint32Array },
  material: ReturnType<typeof doc.createMaterial>,
): Map<number, { material: ReturnType<typeof doc.createMaterial>; attributes: Array<'POSITION'> }> {
  const id2properties = new Map<number, { material: ReturnType<typeof doc.createMaterial>; attributes: Array<'POSITION'> }>();
  for (const id of manifoldMesh.runOriginalID) {
    id2properties.set(id, { material, attributes: ['POSITION'] });
  }
  return id2properties;
}

/**
 * Export a Manifold to a 3MF buffer.
 *
 * @param manifold The manifold to export.
 * @param color Optional hex color string (e.g. "#ff0000") applied to all materials.
 * @param upAxis Which axis points up in the exported model (default 'z-up').
 */
export async function exportTo3MF(
  manifold: Manifold,
  color?: string,
  upAxis: UpAxis = 'z-up',
): Promise<Buffer> {
  return exportPartsTo3MF([{ manifold, color }], upAxis);
}

/**
 * Generate 3MF model XML with colored parts.
 *
 * 3MF supports per-object colors via <colorgroup> resources referenced by
 * pid/pindex on <object> elements.
 */
function buildColored3mfXml(
  parts: Array<{ positions: Float32Array; indices: Uint32Array; color?: string }>,
  precision: number,
): string {
  const out: string[] = [];

  out.push(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Machimoki model</metadata>
  <metadata name="Application">Machimoki</metadata>
  <resources>
`);

  const partCount = parts.length;

  const colorGroups: Array<{ groupId: number; hex: string }> = [];
  for (let i = 0; i < partCount; i++) {
    const c = parts[i].color;
    if (c) {
      colorGroups.push({ groupId: partCount + 1 + colorGroups.length, hex: c });
    }
  }

  for (const cg of colorGroups) {
    out.push(`    <colorgroup id="${cg.groupId}">
      <color color="${cg.hex}"/>
    </colorgroup>
`);
  }

  let colorGroupIdx = 0;
  for (let i = 0; i < partCount; i++) {
    const { positions, indices, color } = parts[i];
    const objectId = i + 1;

    const pidAttr = color ? ` pid="${colorGroups[colorGroupIdx].groupId}"` : '';
    const pidxAttr = color ? ' pindex="0"' : '';
    if (color) colorGroupIdx++;

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
 */
function createColored3mfZip(xml: string): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="model/3mf"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(xml),
  };

  return Buffer.from(zipSync(files).buffer);
}

/**
 * Export multiple Manifold parts to a single 3MF buffer, each with an optional
 * material color. Each part becomes a separate build item in the 3MF file.
 *
 * For parts with colors, generates the 3MF XML directly to include colorgroup
 * resources. For monochrome exports, falls back to manifold-3d's export3mf
 * which preserves roundtrip compatibility with importFrom3MF via
 * EXT_mesh_manifold extension.
 */
interface MeshPart {
  positions: Float32Array;
  indices: Uint32Array;
  color?: string;
}

function getMeshPart(
  part: { manifold: Manifold; color?: string } | { mesh: RawMesh; color?: string },
): MeshPart {
  if ('mesh' in part) {
    return {
      positions: part.mesh.positions,
      indices: part.mesh.indices,
      color: part.color,
    };
  }
  const m = part.manifold.getMesh();
  return {
    positions: m.vertProperties,
    indices: m.triVerts,
    color: part.color,
  };
}

export async function exportPartsTo3MF(
  parts: Array<
    | { manifold: Manifold; color?: string }
    | { mesh: RawMesh; color?: string }
  >,
  upAxis: UpAxis = 'z-up',
): Promise<Buffer> {
  if (parts.length === 0) {
    throw new Error('No parts to export');
  }

  const hasRawMesh = parts.some((p) => 'mesh' in p);
  const hasColor = parts.some((p) => 'color' in p && p.color);

  // If any part is a RawMesh or has color, use the colored XML builder.
  // RawMesh parts cannot go through manifold-3d's export3mf.
  if (hasRawMesh || hasColor) {
    const precision = 7;
    const meshParts = parts.map((p) => {
      const mp = getMeshPart(p);
      return {
        positions: transformForUpAxis(mp.positions, upAxis),
        indices: mp.indices,
        color: mp.color,
      };
    });
    const xml = buildColored3mfXml(meshParts, precision);
    return createColored3mfZip(xml);
  }

  // All parts are pure Manifold objects — use manifold-3d's export3mf.
  const doc = new Document();

  for (const part of parts as Array<{ manifold: Manifold }>) {
    // (x, y, z) -> (x, -z, y) as a column-major rotation about X (z-up).
    if (upAxis === 'z-up') {
      part.manifold.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
    }
    const manifoldMesh = part.manifold.getMesh();
    const material = doc.createMaterial();
    const id2properties = createId2Properties(doc, manifoldMesh, material);
    const gltfMesh = writeMesh(doc, manifoldMesh, id2properties);
    const node = doc.createNode();
    node.setMesh(gltfMesh);
  }

  const arrayBuffer = await export3mf(doc, { header: { unit: 'millimeter' } });
  return Buffer.from(arrayBuffer);
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

export function exportMeshesToSTL(meshes: RawMesh[], upAxis: UpAxis = 'z-up'): Buffer {
  const merged = mergeRawMeshes(meshes);
  merged.positions = transformForUpAxis(merged.positions, upAxis);
  return writeBinarySTL(merged);
}

export async function exportMeshesTo3MF(meshes: RawMesh[], upAxis: UpAxis = 'z-up'): Promise<Buffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  for (const mesh of meshes) {
    if (mesh.positions.length === 0 || mesh.indices.length === 0) continue;

    const positionAccessor = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(transformForUpAxis(mesh.positions, upAxis))
      .setBuffer(buffer);

    const indicesAccessor = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(mesh.indices)
      .setBuffer(buffer);

    const primitive = doc
      .createPrimitive()
      .setAttribute('POSITION', positionAccessor)
      .setIndices(indicesAccessor);

    const gltfMesh = doc.createMesh().addPrimitive(primitive);
    const node = doc.createNode().setMesh(gltfMesh);
    scene.addChild(node);
  }

  doc.getRoot().setDefaultScene(scene);

  const arrayBuffer = await export3mf(doc, { header: { unit: 'millimeter' } });
  return Buffer.from(arrayBuffer);
}

/**
 * Export a Manifold to a binary STL buffer.
 */
export function exportToSTL(manifold: Manifold, upAxis: UpAxis = 'z-up'): Buffer {
  const raw = meshToRaw(manifold.getMesh());
  raw.positions = transformForUpAxis(raw.positions, upAxis);
  return writeBinarySTL(raw);
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  // In Node.js Buffer always wraps an ArrayBuffer.
  return arrayBuffer as ArrayBuffer;
}

/**
 * Import a Manifold from a 3MF buffer.
 */
export async function importFrom3MF(buffer: Buffer): Promise<Manifold> {
  await getWasm();
  const arrayBuffer = bufferToArrayBuffer(buffer);
  return importManifold(arrayBuffer, { mimetype: 'model/3mf' });
}

/**
 * Import a Manifold from an STL buffer.
 */
export async function importFromSTL(buffer: Buffer): Promise<Manifold> {
  const rawMesh = parseSTL(buffer);
  return createManifoldFromMesh(rawMesh);
}

/**
 * Release internal import-model caches. Manifold instances must still be
 * deleted individually with `manifold.delete()`.
 */
export function cleanupManifoldImports(): void {
  cleanupImportModel();
}
