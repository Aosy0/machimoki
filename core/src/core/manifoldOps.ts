/**
 * Manifold creation, boolean, and import/export operations.
 */

import { Document } from '@gltf-transform/core';
import { getManifoldModule } from 'manifold-3d/lib/wasm.js';
import { writeMesh } from 'manifold-3d/lib/gltf-io.js';
import { toArrayBuffer as export3mf } from 'manifold-3d/lib/export-3mf.js';
import { importManifold, cleanup as cleanupImportModel } from 'manifold-3d/lib/import-model.js';
import type { Manifold } from 'manifold-3d';

import { RawMesh } from './types.js';
import { parseSTL } from './stlParser.js';
import { writeBinarySTL } from './stlWriter.js';

async function getWasm() {
  return getManifoldModule();
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
 */
export async function exportTo3MF(manifold: Manifold): Promise<Buffer> {
  const doc = new Document();
  const mesh = manifold.getMesh();

  // writeMesh needs a properties map keyed by the mesh's runOriginalID
  // entries so that position accessors are actually created.
  const id2properties = new Map<number, { material: ReturnType<typeof doc.createMaterial>; attributes: Array<'POSITION'> }>();
  for (const id of mesh.runOriginalID) {
    id2properties.set(id, { material: doc.createMaterial(), attributes: ['POSITION'] });
  }

  const gltfMesh = writeMesh(doc, mesh, id2properties);
  const node = doc.createNode();
  node.setMesh(gltfMesh);

  const arrayBuffer = await export3mf(doc, { header: { unit: 'millimeter' } });
  return Buffer.from(arrayBuffer);
}

/**
 * Export a Manifold to a binary STL buffer.
 */
export function exportToSTL(manifold: Manifold): Buffer {
  const mesh = manifold.getMesh();
  return writeBinarySTL(meshToRaw(mesh));
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
