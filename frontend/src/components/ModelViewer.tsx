import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { importManifold } from 'manifold-3d/lib/import-model.js'
import type { Manifold } from 'manifold-3d'

interface ModelViewerProps {
  manifoldRef: React.MutableRefObject<unknown>
}

interface RawMesh {
  positions: Float32Array
  indices: Uint32Array
}

function isASCIISTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 5) return false
  const text = new TextDecoder('ascii').decode(buffer.slice(0, 5)).toLowerCase()
  return text === 'solid'
}

function parseBinarySTL(buffer: ArrayBuffer): RawMesh {
  const dataView = new DataView(buffer)
  const numTri = dataView.getUint32(80, true)
  const expectedSize = 84 + numTri * 50
  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Binary STL buffer too short: expected ${expectedSize} bytes for ${numTri} triangles, got ${buffer.byteLength}`
    )
  }

  const positions = new Float32Array(numTri * 9)
  const indices = new Uint32Array(numTri * 3)

  let offset = 84
  for (let tri = 0; tri < numTri; tri++) {
    offset += 12 // skip normal
    for (let vert = 0; vert < 3; vert++) {
      const posIdx = tri * 9 + vert * 3
      positions[posIdx] = dataView.getFloat32(offset, true)
      positions[posIdx + 1] = dataView.getFloat32(offset + 4, true)
      positions[posIdx + 2] = dataView.getFloat32(offset + 8, true)
      offset += 12
      indices[tri * 3 + vert] = tri * 3 + vert
    }
    offset += 2 // skip attribute byte count
  }

  return { positions, indices }
}

function parseASCIISTL(text: string): RawMesh {
  const facetRegex =
    /facet\s+normal\s+[^\n]+\s+outer\s+loop\s+vertex\s+([^\n]+)\s+vertex\s+([^\n]+)\s+vertex\s+([^\n]+)\s+endloop\s+endfacet/g

  const positionsList: number[] = []
  const indicesList: number[] = []
  let vertexCount = 0

  let match = facetRegex.exec(text)
  while (match !== null) {
    for (let i = 1; i <= 3; i++) {
      const parts = match[i].trim().split(/\s+/).map(Number)
      if (parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`Invalid vertex coordinates in ASCII STL: ${match[i]}`)
      }
      positionsList.push(parts[0], parts[1], parts[2])
      indicesList.push(vertexCount)
      vertexCount++
    }
    match = facetRegex.exec(text)
  }

  if (vertexCount === 0) {
    throw new Error('No valid facets found in ASCII STL')
  }

  return {
    positions: new Float32Array(positionsList),
    indices: new Uint32Array(indicesList),
  }
}

function parseSTL(buffer: ArrayBuffer): RawMesh {
  if (isASCIISTL(buffer)) {
    return parseASCIISTL(new TextDecoder('ascii').decode(buffer))
  }
  return parseBinarySTL(buffer)
}

interface ManifoldModule {
  Manifold: new (mesh: unknown) => Manifold
  Mesh: new (options: {
    numProp: number
    vertProperties: Float32Array
    triVerts: Uint32Array
  }) => { merge: () => void }
}

function createManifoldFromSTL(wasm: ManifoldModule, buffer: ArrayBuffer): Manifold {
  const rawMesh = parseSTL(buffer)
  const meshObj = new wasm.Mesh({
    numProp: 3,
    vertProperties: rawMesh.positions,
    triVerts: rawMesh.indices,
  })
  meshObj.merge()
  return new wasm.Manifold(meshObj)
}

interface ManifoldMesh {
  vertProperties: Float32Array
  triVerts: Uint32Array
}

function manifoldMeshToGeometry(mesh: ManifoldMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3))
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1))
  geometry.computeVertexNormals()
  return geometry
}

interface SceneData {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  mesh: THREE.Mesh | null
  rafId: number
  manifold: Manifold | null
}

export default function ModelViewer({ manifoldRef }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneDataRef = useRef<SceneData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)

    const camera = new THREE.PerspectiveCamera(
      50,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.01,
      10000
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    containerRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
    fillLight.position.set(-5, 0, -5)
    scene.add(fillLight)

    let rafId = 0
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    rafId = requestAnimationFrame(animate)

    const data: SceneData = {
      scene,
      camera,
      renderer,
      controls,
      mesh: null,
      rafId,
      manifold: null,
    }
    sceneDataRef.current = data

    const handleResize = () => {
      if (!containerRef.current || !sceneDataRef.current) return
      const { clientWidth, clientHeight } = containerRef.current
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
    }
    window.addEventListener('resize', handleResize)

    const container = containerRef.current
    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafId)
      controls.dispose()
      renderer.dispose()
      if (data.mesh) {
        data.mesh.geometry.dispose()
        const material = data.mesh.material
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose())
        } else {
          material.dispose()
        }
      }
      if (data.manifold) {
        data.manifold.delete()
      }
      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      sceneDataRef.current = null
    }
  }, [])

  const clearPreviousMesh = useCallback(() => {
    const data = sceneDataRef.current
    if (!data) return
    if (data.mesh) {
      data.scene.remove(data.mesh)
      data.mesh.geometry.dispose()
      const material = data.mesh.material
      if (Array.isArray(material)) {
        material.forEach((m) => m.dispose())
      } else {
        material.dispose()
      }
      data.mesh = null
    }
    if (data.manifold) {
      data.manifold.delete()
      data.manifold = null
    }
  }, [])

  const fitCameraToMesh = useCallback((mesh: THREE.Mesh) => {
    const data = sceneDataRef.current
    if (!data) return
    const box = new THREE.Box3().setFromObject(mesh)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = data.camera.fov * (Math.PI / 180)
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.5

    data.camera.position.set(center.x + cameraZ * 0.5, center.y + cameraZ * 0.8, center.z + cameraZ)
    data.camera.lookAt(center)
    data.controls.target.copy(center)
    data.controls.update()
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setError(null)
      clearPreviousMesh()

      if (!manifoldRef.current) {
        setError('WASMが初期化されていません。しばらくしてから再度お試しください。')
        return
      }

      try {
        const arrayBuffer = await file.arrayBuffer()
        let manifold: Manifold

        const fileName = file.name.toLowerCase()
        if (fileName.endsWith('.3mf')) {
          manifold = await importManifold(arrayBuffer, { mimetype: 'model/3mf' })
        } else if (fileName.endsWith('.stl')) {
          manifold = createManifoldFromSTL(manifoldRef.current as ManifoldModule, arrayBuffer)
        } else {
          setError('対応していないファイル形式です。3MFまたはSTLファイルを選択してください。')
          return
        }

        const meshData = manifold.getMesh()
        const geometry = manifoldMeshToGeometry(meshData)
        const material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          roughness: 0.5,
          metalness: 0.1,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true
        mesh.receiveShadow = true

        const data = sceneDataRef.current
        if (!data) {
          manifold.delete()
          return
        }

        data.scene.add(mesh)
        data.mesh = mesh
        data.manifold = manifold

        fitCameraToMesh(mesh)
      } catch (err) {
        console.error('[ModelViewer] Failed to load file:', err)
        setError(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました')
      }
    },
    [manifoldRef, clearPreviousMesh, fitCameraToMesh]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 10,
          background: 'rgba(0, 0, 0, 0.7)',
          padding: '12px',
          borderRadius: '6px',
          color: '#fff',
          fontSize: '13px',
          maxWidth: '320px',
        }}
      >
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          3Dモデルを読み込む
        </label>
        <input
          type="file"
          accept=".3mf,.stl"
          onChange={handleFileChange}
          style={{ color: '#fff', fontSize: '12px' }}
        />
        {error && (
          <div style={{ marginTop: '8px', color: '#ff6b6b', fontSize: '12px' }}>{error}</div>
        )}
      </div>
    </div>
  )
}
