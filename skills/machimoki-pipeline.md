---
name: machimoki-pipeline
description: 3D printable model export and validation pipeline for machimoki. Use when user asks to "export 3D model", "validate mesh", "check printability", "generate 3MF/STL", "run machimoki pipeline", or "build printable model from PLATEAU data".
allowed-tools: [Bash, Read, Write]
---

# Machimoki 3D Pipeline SKILL

## Overview

This SKILL enables AI agents to export 3D printable models from PLATEAU city data and validate mesh quality for 3D printing. The pipeline runs through four stages: normalize, export, validate, judge.

## When to Use

- "Export 3D model from geographic bounds"
- "Validate mesh for 3D printing"
- "Check if model is printable"
- "Generate 3MF or STL file from PLATEAU data"
- "Run machimoki pipeline"
- "Build printable model"
- "Check mesh topology"

## Workflow

### Step 1: Normalize Coordinates

Ensure bounds are in WGS84 decimal degrees (longitude, latitude):

- `west`, `south`, `east`, `north` in decimal degrees
- `west < east` and `south < north` (must hold)
- Area should be under 1000 km for reasonable export time
- Heights are in meters (terrain from Cesium World Terrain)
- All coordinates use the WGS84 datum

### Step 2: Export Model

#### CLI Usage

```bash
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --flatten-bottom \
  --format 3mf \
  --output model.3mf
```

#### API Usage

```bash
# Start the server
npx tsx core/src/api/server.ts

# Export a model
curl -X POST http://localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{
    "bounds": {"west": 139.6903, "south": 35.6997, "east": 139.6906, "north": 35.7000},
    "terrainThickness": 10,
    "flattenBottom": true,
    "format": "3mf"
  }' \
  --output model.3mf
```

### Step 3: Validate Model

The CLI `export` command now **automatically validates** the generated file and deletes it if validation does not return `pass`.

#### CLI Auto-Validation Exit Codes

| Exit Code | When | Meaning |
|-----------|------|---------|
| `0` | Validation status is `pass` | File is kept and printable |
| `1` | Validation status is `warning` | File is deleted; model has multiple shells or other non-fatal issues |
| `2` | Validation status is `fail` | File is deleted; model has holes, non-manifold edges, self-intersections, or invalid geometry |

#### Manual Validation CLI Usage

Use this to validate an existing file:

```bash
npx tsx core/src/cli/index.ts validate --file model.3mf --json
```

#### API Usage

```bash
# Validate an existing file
curl -X POST http://localhost:3000/api/validate \
  -F "file=@model.3mf"
```

### Step 4: Judge Result

The validation returns JSON with these metrics:

```json
{
  "status": "pass",
  "numTri": 12345,
  "numVert": 6789,
  "numEdge": 10000,
  "volume": 1234.56,
  "surfaceArea": 567.89,
  "genus": 0,
  "numShells": 1,
  "open_edges": 0,
  "non_manifold_edges": 0,
  "self_intersections": 0,
  "statusCode": "NoError"
}
```

#### Pass/Fail Rules

| Condition | Status | Meaning |
|-----------|--------|---------|
| `open_edges === 0 && non_manifold_edges === 0 && self_intersections === 0 && numShells === 1` | **pass** | Model is watertight and printable |
| Same topology conditions but `numShells > 1` | **warning** | Model has multiple disconnected shells. Printable but not ideal for single-object printing |
| `open_edges > 0 \|\| non_manifold_edges > 0 \|\| self_intersections > 0` | **fail** | Model has holes, non-manifold edges, or self-intersections. Not printable as-is |

#### Metric Interpretation

| Metric | Good Range | Description |
|--------|-----------|-------------|
| `open_edges` | `0` | Boundary edges with only 1 adjacent triangle. Must be 0 for a watertight mesh |
| `non_manifold_edges` | `0` | Edges with more than 2 adjacent triangles. Must be 0 |
| `self_intersections` | `0` | Triangles that intersect other triangles. Must be 0 |
| `numShells` | `1` | Number of disconnected components. 1 for a single object |
| `numTri` | `> 0` | Triangle count |
| `numVert` | `> 0` | Vertex count |
| `numEdge` | `> 0` | Edge count |
| `genus` | `0` | Number of "handles" or through-holes. 0 means no topological holes |
| `volume` | `> 0` | Enclosed volume in mm³. Must be a positive finite number |
| `surfaceArea` | `> 0` | Total surface area in mm². Must be a positive finite number |
| `statusCode` | `"NoError"` | Manifold library status. Any other value indicates a problem |

A model is automatically downgraded to `fail` if `numTri` is 0, `numVert` is 0, `volume` is not positive, or `surfaceArea` is not positive.

## Examples

### Example 1: Full export and validate cycle

```bash
# Export a small area in Shinjuku
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --flatten-bottom \
  --format 3mf \
  --output shinjuku.3mf

# Validate the result
npx tsx core/src/cli/index.ts validate --file shinjuku.3mf --json
```

### Example 2: STL export without terrain

```bash
npx tsx core/src/cli/index.ts export \
  --bounds 139.6903,35.6997,139.6906,35.7000 \
  --terrain-thickness 10 \
  --no-terrain \
  --format stl \
  --output buildings.stl
```

### Example 3: API server workflow

```bash
# Terminal 1: Start server
npx tsx core/src/api/server.ts

# Terminal 2: Export and validate
curl -s -X POST http://localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{"bounds":{"west":139.6903,"south":35.6997,"east":139.6906,"north":35.7000},"terrainThickness":10,"format":"3mf"}' \
  --output model.3mf

curl -s -X POST http://localhost:3000/api/validate \
  -F "file=@model.3mf" | python -m json.tool
```

## Parameters

### Export Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `--bounds` | Yes | `west,south,east,north` | -- | Geographic bounds in WGS84 decimal degrees |
| `--terrain-thickness` | Yes | number | -- | Terrain thickness in meters below lowest point |
| `--flatten-bottom` / `--no-flatten-bottom` | No | flag | `true` | Flatten the bottom surface for stable printing |
| `--format` | No | `3mf` \| `stl` | `3mf` | Output format. 3MF recommended over STL |
| `--lod` | No | `lod1` \| `lod2` | `lod1` | Level of detail for buildings |
| `--terrain` / `--no-terrain` | No | flag | `true` | Include terrain mesh generation |
| `--pick-point` | No | `lon,lat` (repeatable) | -- | Keep only buildings whose footprint contains the point. Bounds is then used only for tile fetch and terrain |
| `--output` | Yes | path | -- | Output file path |

### Validate Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `--file` | Yes | path | -- | Path to 3MF or STL file |
| `--json` / `--no-json` | No | flag | `true` | Output JSON to stdout |

## Error Handling

### Export Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Invalid bounds format` | Bounds not 4 comma-separated numbers | Use `west,south,east,north` format |
| `Invalid bounds: west=X...` | `west >= east` or `south >= north` | Swap coordinates so west < east and south < north |
| `Invalid terrain thickness` | Non-positive or NaN value | Provide a positive number |
| `Invalid format` | Not `3mf` or `stl` | Use one of the supported formats |
| `Failed to build printable model: No meshes generated` | Area has no buildings or terrain | Check bounds cover a built-up area in Japan |
| `Failed to build printable model: ...` | Network or API error | Check connectivity to PLATEAU API and Cesium Ion |
| CLI exits with code `1` | Validation status is `warning` | Output file is deleted; model is printable but has multiple shells or metric issues |
| CLI exits with code `2` | Validation status is `fail` | Output file is deleted; model has topology or geometry problems |
| HTTP 422 on API `/api/export` | Generated model failed validation | Response body contains `{ error, warnings, validation }` for diagnosis |
| HTTP 500 on API | Server-side error during export | Check server logs for details |

### Validate Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Unsupported file extension` | File does not end in `.3mf` or `.stl` | Use the correct extension |
| `ENOENT: no such file or directory` | File path is wrong | Check the file exists |
| Manifold import error | Corrupted or invalid mesh file | Re-export the model |
| Process exits with code 2 | Validation status is `fail` | Check topology metrics in JSON output |

## Notes

- **3MF is recommended over STL**: 3MF preserves manifold topology and produces smaller files. STL is supported for compatibility with older slicers.
- **Terrain sampling**: Terrain uses a 64x64 grid from Cesium World Terrain. Larger areas take longer to sample.
- **Building data**: Buildings come from PLATEAU 3D Tiles (municipality-specific). Coverage depends on which cities have published data.
- **Coordinate system**: All coordinates are in WGS84 degrees. Heights are in meters above ellipsoid.
- **Export time**: Depends on area size and LOD. Small areas (a few city blocks) take 10-30 seconds. Larger areas may take several minutes.
- **Memory**: Large areas can use significant memory. Stick to areas under 1 km for reliable results.
- **Manifold WASM**: Validation requires the manifold-3d WASM module to be initialized. This happens on first call and may take a moment.
- **Auto-validation**: The CLI export command validates the output automatically. Treat any non-zero exit code as a failed export, even if a file was briefly written.
