export {
  boundsToEngineXZ,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js';

export { buildPrintableModelFromMeshes } from './pipelineUtils.js';

export { exportMachimoki, exportMachimokiFromMeshes } from './pipeline.js';
export type { MachimokiExportResult } from './pipeline.js';

export {
  createMachimokiBuffer,
  inspectMachimoki,
  MACHIMOKI_MANIFEST,
  MACHIMOKI_MODEL_3MF,
  MACHIMOKI_MODEL_STL,
} from './machimokiFormat.js';
export type { MachimokiManifest } from './machimokiFormat.js';

export {
  capBuildingBottom,
  splitConnectedComponents,
  weldVertices,
} from './buildingCapper.js';

export {
  createManifoldFromMesh,
  exportPartsTo3MF,
  exportMeshesToSTL,
  unionMeshes,
  exportTo3MF,
  exportToSTL,
  mergeRawMeshes,
  exportMeshesTo3MF,
  importFrom3MF,
  importFromSTL,
  cleanupManifoldImports,
} from './manifoldOps.js';

export type {
  Bounds,
  ExportOptions,
  ExportResult,
  RawMesh,
  UpAxis,
  ValidationResult,
} from './types.js';

export { buildPrintableModel } from './pipeline.js';

export { buildBuildingMeshes } from './meshBuilder.js';
export { buildTerrainMesh } from './terrain.js';

export { validateMesh } from './validate.js';

export { parseSTL } from './stlParser.js';
export { writeBinarySTL } from './stlWriter.js';
