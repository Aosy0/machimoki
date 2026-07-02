import { useEffect, useRef } from 'react'
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import {
  getSelectionSizeMeters,
} from '../lib/enuCoordinates'
import type { PipelineState } from '../types/pipeline'
import { runTilePipeline } from '../lib/tilePipeline'
import { cropGeometryToSelection } from '../lib/selectionCropper'

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  sceneRef?: React.MutableRefObject<Scene | null>
  lod: 'lod1' | 'lod2'
  manifoldRef?: React.MutableRefObject<any>
  onPipelineStateChange?: (state: PipelineState) => void
}

function Preview3D({ selectionBounds, sceneRef, lod, manifoldRef, onPipelineStateChange }: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRefInternal = useRef<Scene | null>(null)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animationIdRef = useRef<number>(0)
  const croppedMeshGroupRef = useRef<Mesh | null>(null)

  // Scene initialization — runs once on mount
  useEffect(() => {
    console.log('[Preview3D] useEffect 1 called, containerRef:', !!containerRef.current)
    if (!containerRef.current) return

    const scene = new Scene()
    scene.background = new Color(0x1a2332)

    const ambientLight = new AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    const directionalLight = new DirectionalLight(0xffffff, 1.2)
    directionalLight.position.set(1000, 2000, 1500)
    scene.add(directionalLight)

    sceneRefInternal.current = scene
    if (sceneRef) {
      sceneRef.current = scene
    }

    const camera = new PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      1,
      200000
    )
    cameraRef.current = camera

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controlsRef.current = controls

    function animate() {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()
      camera.updateMatrixWorld()
      scene.updateMatrixWorld()
      renderer.render(scene, camera)
    }
    animate()

    function handleResize() {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationIdRef.current)
      window.removeEventListener('resize', handleResize)
      controls.dispose()
      renderer.dispose()
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement)
      }
      sceneRefInternal.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      if (sceneRef) {
        sceneRef.current = null
      }
    }
  }, [sceneRef])

  useEffect(() => {
    if (!sceneRefInternal.current || !cameraRef.current || !rendererRef.current) return

    if (croppedMeshGroupRef.current) {
      sceneRefInternal.current.remove(croppedMeshGroupRef.current)
      croppedMeshGroupRef.current.geometry?.dispose()
      croppedMeshGroupRef.current = null
    }

    if (!selectionBounds) {
      onPipelineStateChange?.({ phase: 'idle', progress: 0, message: '', error: null })
      return
    }
    const bounds = selectionBounds

    if (!manifoldRef?.current) {
      const message = 'WASMが初期化されていません'
      onPipelineStateChange?.({ phase: 'error', progress: 0, message, error: message })
      return
    }
    const manifoldModule = manifoldRef.current

    const size = getSelectionSizeMeters(selectionBounds)
    const maxDim = Math.max(size.width, size.height)
    const altitude = Math.max(maxDim * 1.5, 800)

    if (cameraRef.current && controlsRef.current) {
      const cam = cameraRef.current
      const lookTarget = new Vector3(0, 0, 0)
      const camPos = new Vector3(maxDim * 0.5, altitude, maxDim * 0.5)

      cam.position.copy(camPos)
      cam.up.set(0, 1, 0)
      cam.lookAt(lookTarget)
      cam.near = 0.1
      cam.far = Math.max(maxDim * 50, 200000)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()

      controlsRef.current.target.copy(lookTarget)
      controlsRef.current.minDistance = 1
      controlsRef.current.maxDistance = altitude * 20
      controlsRef.current.update()
    }

    let cancelled = false

    async function runPipeline() {
      try {
        onPipelineStateChange?.({
          phase: 'identifying',
          progress: 0,
          message: 'タイルパイプラインを開始',
          error: null,
        })

        const result = await runTilePipeline({
          selectionBounds: bounds,
          lod,
          onProgress: (p) => {
            if (cancelled) return
            console.log('[Pipeline]', p.phase, p.progress, p.detail)
            onPipelineStateChange?.({
              phase: p.phase,
              progress: p.progress,
              message: p.detail || '',
              error: null,
            })
          },
        })

        if (cancelled) return

        if (!result.geometry) {
          const message = 'ジオメトリの取得に失敗しました'
          onPipelineStateChange?.({ phase: 'error', progress: 0, message, error: message })
          return
        }

        onPipelineStateChange?.({
          phase: 'cropping',
          progress: 0,
          message: '選択範囲でクロップ中',
          error: null,
        })

        const croppedGeometry = cropGeometryToSelection({
          geometry: result.geometry,
          selectionBounds: bounds,
          manifoldModule,
        })

        if (cancelled) {
          croppedGeometry.dispose()
          return
        }

        const mesh = new Mesh(croppedGeometry, new MeshStandardMaterial({ color: 0x888888 }))
        sceneRefInternal.current?.add(mesh)
        croppedMeshGroupRef.current = mesh

        croppedGeometry.computeBoundingBox()
        const bbox = croppedGeometry.boundingBox
        if (bbox && cameraRef.current && controlsRef.current) {
          const center = new Vector3().addVectors(bbox.min, bbox.max).multiplyScalar(0.5)
          const size = new Vector3().subVectors(bbox.max, bbox.min)
          const maxSize = Math.max(size.x, size.y, size.z)
          const camPos = new Vector3(center.x + maxSize, center.y + maxSize, center.z + maxSize)
          cameraRef.current.position.copy(camPos)
          cameraRef.current.lookAt(center)
          controlsRef.current.target.copy(center)
          controlsRef.current.update()
        }

        onPipelineStateChange?.({
          phase: 'complete',
          progress: 100,
          message: '完了',
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'パイプライン処理に失敗しました'
        onPipelineStateChange?.({ phase: 'error', progress: 0, message, error: message })
      }
    }

    runPipeline()

    return () => {
      cancelled = true
    }
  }, [selectionBounds, lod, manifoldRef, onPipelineStateChange])

  return <div ref={containerRef} style={containerStyle} />
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
}

export default Preview3D
