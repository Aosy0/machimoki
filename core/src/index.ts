export {
  boundsToEngineXZ,
  buildFrameCutterMesh,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  printedMmToModelMeters,
  scaleRawMesh,
} from './pipelineCore.js'

export {
  buildHollowBuildingShells,
  buildPrintableGeometryFromMeshes,
  buildPrintableModelFromMeshes,
  buildSplitModelFromFinalMesh,
  DEFAULT_SHELL_THICKNESS_MM,
  serializeSplitParts,
} from './pipelineUtils.js'
export type { PrintableGeometryResult } from './pipelineUtils.js'

export {
  BASE_CLEARANCE_MM,
  BASE_EXTENSION_MM,
  MIN_FRAME_HEIGHT_MM,
  splitFrameAndBuildings,
} from './frameSplit.js'
export {
  FRAME_MITER_DEPTH_RATIO,
  hasMiterBase,
  hasMiterWall,
} from './frameSplitConstants.js'
export type { FrameSplitParts, FrameSplitPrebuilt } from './frameSplit.js'

export { exportMachimoki, exportMachimokiFromMeshes } from './pipeline.js'
export type { MachimokiExportResult } from './pipeline.js'

export {
  createMachimokiBuffer,
  inspectMachimoki,
  MACHIMOKI_MANIFEST,
  MACHIMOKI_MODEL_3MF,
  MACHIMOKI_MODEL_STL,
} from './machimokiFormat.js'
export type { MachimokiManifest } from './machimokiFormat.js'

export {
  capBuildingBottom,
  splitConnectedComponents,
  weldVertices,
} from './buildingCapper.js'

export {
  createManifoldFromMesh,
  createZipBuffer,
  exportPartsTo3MF,
  exportMeshesToSTL,
  unionMeshes,
  exportTo3MF,
  exportToSTL,
  mergeRawMeshes,
  exportMeshesTo3MF,
  exportMeshWithTriangleColorsTo3MF,
  importFrom3MF,
  importFromSTL,
  removeTinyShells,
  sectionMesh,
  cleanupManifoldImports,
} from './manifoldOps.js'
export type { SectionAxis } from './manifoldOps.js'

export type {
  Bounds,
  ExportOptions,
  ExportResult,
  LayerMeshes,
  LayerType,
  RawMesh,
  SplitExportParts,
  UpAxis,
  ValidationResult,
} from './types.js'

export {
  applyEngravingToManifold,
  autoFitEngraving,
  computeEngravingFaceDims,
  DEFAULT_PRINT_PROFILE,
  defaultEngravingDepthMm,
  defaultEngravingOptions,
  engravingMaxDepthMm,
  engravingMinFontSizes,
  engravingSideBandHeightMm,
  formatAttribution,
  formatCenterCoordinate,
  formatDateLine,
  formatMeshCodeLine,
  formatScaleAndSize,
  isCjkChar,
  isCjkText,
  jisMeshCode1km,
  layoutEngraving,
  parseEngravingFont,
  setEngravingFontProvider,
} from './engraving/index.js'
export type {
  EngravingApplyResult,
  EngravingFace,
  EngravingFaceDims,
  EngravingFaceFrame,
  EngravingFont,
  EngravingFontBBox,
  EngravingFontPoint,
  EngravingLayout,
  EngravingLayoutLine,
  EngravingLine,
  EngravingModelDims,
  EngravingOptions,
  EngravingTerrainContext,
  PrintProfile,
} from './engraving/index.js'

export { buildPrintableModel } from './pipeline.js'

export { buildBuildingMeshes, buildLayerMeshes } from './meshBuilder.js'
export type { BuildLayerMeshesOptions } from './meshBuilder.js'

export { assignTriangleColors } from './exportColors.js'
export type {
  ExportMeshColors,
  TriangleColorOptions,
  TriangleColorResult,
} from './exportColors.js'
export { buildTerrainMesh, sampleTerrainGrid, buildTerrainSlabFromSample } from './terrain.js'
export type { TerrainSample } from './terrain.js'

export { validateMesh } from './validate.js'

export { parseSTL } from './stlParser.js'
export { writeBinarySTL } from './stlWriter.js'

export {
  buildCoverageMap,
  enrichGeoJsonFeatures,
  generateCoverageJson,
} from './coverage/index.js'
export type {
  CatalogDataset,
  CoverageInfo,
  CoverageMap,
  GeoJsonFeature,
} from './coverage/index.js'
