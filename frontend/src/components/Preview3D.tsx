import { useEffect, useRef } from 'react'
import { Scene, PerspectiveCamera, WebGLRenderer, Color, GridHelper, Sphere } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TilesRenderer } from '3d-tiles-renderer'

interface Preview3DProps {
  selectionBounds: { west: number; south: number; east: number; north: number } | null
  sceneRef?: React.MutableRefObject<Scene | null>
}

function Preview3D({ selectionBounds, sceneRef }: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new Scene()
    scene.background = new Color(0x222222)

    if (sceneRef) {
      sceneRef.current = scene
    }

    const gridHelper = new GridHelper(2000, 50, 0x555555, 0x333333)
    scene.add(gridHelper)

    const camera = new PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000000
    )
    camera.position.set(0, 500, 1000)

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    containerRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    // Load PLATEAU tileset
    const tilesetUrl = 'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13-bldg-lod1-2025/tileset.json'
    const tilesRenderer = new TilesRenderer(tilesetUrl)
    tilesRenderer.setCamera(camera)
    tilesRenderer.setResolutionFromRenderer(camera, renderer)
    scene.add(tilesRenderer.group)

    // Center tileset at origin when loaded so it's visible
    tilesRenderer.addEventListener('load-root-tileset', () => {
      const sphere = new Sphere()
      tilesRenderer.getBoundingSphere(sphere)
      tilesRenderer.group.position.copy(sphere.center).multiplyScalar(-1)

      // Position camera based on tileset size
      const radius = sphere.radius
      if (radius > 0) {
        camera.position.set(radius * 0.5, radius * 0.8, radius * 1.2)
        controls.target.set(0, 0, 0)
        controls.update()
      }
    })

    // Log load errors but don't crash
    tilesRenderer.addEventListener('load-error', (ev: ErrorEvent) => {
      console.warn('Tile load error (non-critical):', ev.error || ev.message)
    })

    let animationId: number
    function animate() {
      animationId = requestAnimationFrame(animate)
      controls.update()
      camera.updateMatrixWorld()
      tilesRenderer.update()
      renderer.render(scene, camera)
    }
    animate()

    function handleResize() {
      if (!containerRef.current) return
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', handleResize)
      controls.dispose()
      renderer.dispose()
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement)
      }
    }
  }, [selectionBounds, sceneRef])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  )
}

export default Preview3D
