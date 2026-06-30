---
slug: machimoki
status: approved
intent: clear
pending-action: write .omo/plans/machimoki.md
approach: React+Vite frontend on Cloudflare Static Assets. CesiumJS for map/area selection and PLATEAU 3DTiles reference view. 3DTilesRendererJS to load the same tileset into Three.js for mesh processing. manifold-3d WASM for terrain thickening and bottom flattening. three-3mf-exporter + STLExporter for client-side export. No auth. LOD1 default. Docker container development environment. Optional Hono Worker scaffold for future offloading.
---

# Draft: machimoki

## Components (topology ledger)

| id | outcome | status | evidence path |
|---|---|---|---|
| C1 | Frontend shell (React + Vite + TS, Cloudflare Static Assets) with routing and layout | active | TBD |
| C2 | Map area selector (CesiumJS, PLATEAU 3DTiles integration, drag/select area) | active | TBD |
| C3 | 3D preview engine (Three.js, load PLATEAU geometry + terrain, camera/orbit controls) | active | TBD |
| C4 | Parameter adjustment panel (terrain thickness, flatten bottom, include/exclude terrain, export format selector) | active | TBD |
| C5 | PLATEAU data fetch & converter (3DTiles → Three.js mesh via 3DTilesRendererJS, terrain thickening, bottom flattening) | active | TBD |
| C6 | 3MF / STL exporter (client-side binary generation, download trigger) | active | TBD |
| C7 | Optional backend API (Cloudflare Workers + Hono, heavy conversion offloading to N150) | deferred | TBD |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| Map library | CesiumJS | PLATEAU officially distributes 3DTiles; Cesium natively supports 3DTiles streaming. api.plateauview.mlit.go.jp endpoints confirmed. | Yes |
| 3D engine for export | Three.js | Export-ready mesh manipulation (thickening, flattening) richer ecosystem. manifold-3d WASM confirmed browser-compatible. | Yes |
| 3DTiles→Three.js bridge | 3DTilesRendererJS (NASA-AMMOS) | Renders 3DTiles as native Three.js Object3D/Mesh. Cesium internal extraction is hacky/unsupported. | Yes (but switching is costly) |
| 3MF generation | `three-3mf-exporter` (browser) | Simple, Three.js-native. `@3mfconsortium/lib3mf` WASM exists as fallback if multi-material needed later. | Yes |
| STL generation | Three.js built-in `STLExporter` | Official addon, ASCII/Binary support. Zero extra deps. | Yes |
| Terrain thickening / flattening | `manifold-3d` WASM boolean + extrusion | Robust solid geometry ops in browser. Apache-2.0. | Yes |
| Hole healing (courtyards) | `meshfix-wasm` (PMP Library, Liepa) | WASM-based hole filling. MIT license. Deferred if LOD1 default keeps issue rare. | Yes |
| Backend | Deferred until client-side proves too slow | Cost minimization; architecture keeps backend slot open via Hono/Workers placeholder. | Yes |
| Auth | None | Explicit requirement. | No |
| Hosting frontend | Cloudflare Workers Static Assets | User preference. | No |
| LOD default | LOD1 | Simpler geometry prints better, fewer courtyard issues. LOD2 selectable in UI. | Yes |
| Terrain source | Separate DEM 3DTiles or terrain provider | PLATEAU VIEW may serve terrain alongside buildings. If unavailable, Cesium World Terrain fallback. | Yes |

## Findings (cited)

### PLATEAU Data Access
- **Composite tileset endpoint**: `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/{spec}/tileset.json`
- **Spec format**: `<area>-<type>-<lod>[-interior][-<texture>]-<year>`
- **Example**: `all-bldg-lod1-2025`, `13101-bldg-lod2-texture-2025`
- **LOD control**: `lod1`..`lod4` or `maxlod1`..`maxlod4` in URL. Client selects by choosing URL.
- **Data size**: No official per-block figure. Shibuya-ku (15 km²) ≈ 1.8 GB at LOD2. Extrapolated 500m×500m ≈ 25-40 MB at LOD2, but 3DTiles streams only visible tiles so actual browser load is much smaller (few MB to tens of MB).
- **Restrictions**: Experimental service, no SLA. CityGML spatial query limited to ≤50 cities. Pack API has timeouts/auto-deletion. License: CC BY 4.0.
- **Source**: https://docs.plateauview.mlit.go.jp/api/rest/operations/datacatalog3dtilesspectilesetjson/

### 3MF / STL / Mesh Processing Libraries
- **3MF exporter**: `three-3mf-exporter` (npm) is Three.js-native and simple. `@3mfconsortium/lib3mf` WASM is full-featured official binding if multi-material/color needed later.
- **STL exporter**: Three.js `STLExporter` in `three/addons/exporters/STLExporter.js`. ASCII & Binary.
- **Thickening / flattening**: `manifold-3d` WASM supports extrusion and boolean intersection. Approach: extrude terrain profile into solid, intersect with bounding block, then flatten bottom by additional boolean or vertex manipulation.
- **Hole healing**: `meshfix-wasm` (PMP Library, Liepa algorithm, MIT) can fill holes. `remesh-threejs` is pure TS alternative.
- **Manifold limitations**: No direct `offset()` API yet. Manual `.delete()` required to avoid memory leaks. Requires manifold input (no self-intersections).
- **Source**: npm registry, GitHub repos `LittleSound/bekuto3d`, `meshfix-wasm`.

### CesiumJS + Three.js Integration
- **Recommended pattern**: Overlay (dual canvas + camera sync). Cesium renders map/3DTiles underneath; Three.js overlay renders processed/export mesh on top with `pointer-events: none`. Camera matrices synced each frame.
- **Geometry extraction from Cesium**: NOT officially supported. Internal `_model.gltf` is hacky.
- **Alternative**: 3DTilesRendererJS loads `tileset.json` directly into Three.js scene as native Meshes. Supports `TilesCompressionPlugin` for GPU memory reduction, frustum culling.
- **Area selection**: `ScreenSpaceEventHandler` + `pickPosition` / `globe.pick`. `Entity.rectangle` with `CallbackProperty` for live preview.
- **Similar projects**: `TerraStl` (terrain→STL, Leaflet/Mapbox), `bekuto3d` (SVG→3D with three-3mf-exporter), `3DTilesRendererJS`.
- **Source**: Cesium blog (2017), NASA-AMMOS/3DTilesRendererJS GitHub, TerraStl repo.

### Performance
- City-scale 3DTiles can run in Cesium at ~0.2 GB RAM with Draco/gzip.
- Converting all visible tiles to Three.js duplicates memory. For 3D-print use, we must only convert the user-selected area, not the entire city.
- 3DTilesRendererJS `TilesCompressionPlugin` reduces GPU memory by 30%+.

## Decisions (with rationale)

1. **CesiumJS for map + area selection**: PLATEAU delivers 3DTiles natively; Cesium has best-in-class globe + tile streaming. Area selection APIs are mature.
2. **3DTilesRendererJS for export mesh loading**: Instead of extracting geometry from Cesium (unsupported), we load the same `tileset.json` URL into Three.js via 3DTilesRendererJS when user confirms area. This gives us native Three.js Meshes for processing.
3. **Dual-canvas overlay for preview**: Cesium shows the “reference view” with globe, terrain, and 3DTiles. Three.js overlay (synced camera) shows the “print preview” with thickened terrain, flattened bottom, and export colors. User can toggle between views or see both.
4. **Client-side processing first**: Selected area is typically small (city block). Even at LOD2, converted geometry should be manageable in browser (tens of MB). manifold-3d WASM is fast enough for block-scale booleans.
5. **LOD1 default**: Reduces initial complexity, prints more reliably, minimizes courtyard issues. LOD2 available in parameters.
6. **Terrain processing via manifold-3d**: Terrain mesh from PLATEAU is typically a surface. We extrude downward by user-defined thickness, then boolean-intersect with a bounding box to flatten bottom.
7. **Hole healing deferred if LOD1 default**: LOD1 buildings are extruded footprints with no interior courtyards. If user switches to LOD2, we document the limitation and apply `meshfix-wasm` only if time permits in MVP.

## Scope IN

- React + Vite + TS frontend skeleton with routing
- CesiumJS map integration with PLATEAU 3DTiles (composite tileset)
- Area selection (rectangle draw on map, real-world coords output)
- 3DTilesRendererJS integration for selected area geometry loading
- Three.js 3D preview of selected area (buildings + terrain) with orbit controls
- Dual-view toggle: Cesium reference view vs Three.js print preview
- Parameter panel: terrain thickness, flatten bottom toggle, include terrain toggle, LOD selector (LOD1/LOD2), format selector (3MF default, STL optional)
- Terrain thickening algorithm (extrude + flatten bottom via manifold-3d or three-bvh-csg)
- Client-side 3MF export (three-3mf-exporter) and STL export (STLExporter)
- Cloudflare Workers Static Assets hosting config

## Scope OUT (Must NOT have)

- User authentication / accounts / sessions
- Database / persistence
- Multi-user collaboration
- Advanced per-building editing (move/resize individual buildings)
- Mobile-native app
- Texturing / materials in exported file (solid color only)
- Printability analysis (overhangs, supports, slicing)
- Server-side mesh processing in MVP (client-side only; backend slot kept open)

## Open questions (for user)

1. **MVP courtyard/hole auto-fix**: LOD1 default largely avoids the courtyard-sealing problem. Should MVP skip auto hole-healing and document the limitation for LOD2, or should we include `meshfix-wasm` even in MVP? (Recommended: skip in MVP, add in v2.)
2. **Dual-view UX**: Should the screen default to (A) side-by-side Cesium map + Three.js preview, or (B) single main view with a toggle button to switch between map-mode and 3D-preview-mode? (Recommended: B — single view with toggle, cleaner for MVP.)
3. **Backend placeholder**: Should we scaffold a Hono Cloudflare Worker in the repo now (even if it only serves static assets and a no-op health check), so the offloading path is structurally ready? (Recommended: yes — minimal scaffold keeps the door open.)

## Approval gate
status: approved
pending-action: write .omo/plans/machimoki.md
approach: React+Vite frontend on Cloudflare Static Assets. CesiumJS for map/area selection and PLATEAU 3DTiles reference view. 3DTilesRendererJS to load the same tileset into Three.js for mesh processing. manifold-3d WASM for terrain thickening and bottom flattening. three-3mf-exporter + STLExporter for client-side export. No auth. LOD1 default. Docker container development environment. Optional Hono Worker scaffold for future offloading.
metis-findings: 14 gaps identified (terrain/building separation, manifold input assumptions, coordinate conversion, area extraction, export validation, bundle size, Docker wasm paths, error handling, area guardrails, backend scope creep, LOD2 warning, 3MF units, terrain datum mismatch, UI mode clarity). All mitigations folded into todos and acceptance criteria.
