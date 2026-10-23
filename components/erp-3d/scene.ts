import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import type { RecordGraph } from "@/lib/erp-3d/graph"
import { positionGraph, selectedRelations } from "@/lib/erp-3d/layout"
import type { RecordKey, RecordKind } from "@/lib/erp-3d/model"

export type RecordSceneHandle = { focus(key: RecordKey | null, resetCamera?: boolean): void; dispose(): void }

const COLORS: Record<RecordKind, number> = { deal: 0x67e8f9, project: 0xa78bfa, invoice: 0xfbbf24, task: 0x4ade80 }
const BAND_X = [-12, -4, 4, 12]
let activeScenes = 0

export function mountRecordScene(host: HTMLElement, graph: RecordGraph, events: { onSelect(key: RecordKey): void; onUnavailable(): void }): RecordSceneHandle {
  const canvas = document.createElement("canvas")
  canvas.setAttribute("aria-label", "Interactive record map")
  canvas.tabIndex = 0
  host.appendChild(canvas)

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" })
  } catch (error) {
    canvas.remove()
    throw error
  }
  const gl = renderer.getContext()
  if (!(gl instanceof WebGL2RenderingContext)) {
    renderer.dispose()
    canvas.remove()
    throw new Error("WebGL2 is unavailable")
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  host.dataset.renderer = gl.getParameter(gl.RENDERER) || "unknown"
  const debugRenderer = gl.getExtension("WEBGL_debug_renderer_info")
  host.dataset.gpuRenderer = debugRenderer ? String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)) : "unavailable"
  host.dataset.webgl = "active"
  host.dataset.renderCount = "0"
  host.dataset.nodeCount = String(graph.nodes.length)
  host.dataset.edgeCount = String(graph.edges.length)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1223)
  scene.fog = new THREE.Fog(0x0b1223, 28, 65)
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 300)
  camera.position.set(0, 18, 29)
  camera.lookAt(0, 0, 0)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0, 0)
  controls.enableDamping = false
  controls.enablePan = false
  controls.minDistance = 10
  controls.maxDistance = 200
  controls.maxPolarAngle = Math.PI * 0.48
  controls.update()

  scene.add(new THREE.HemisphereLight(0xb4d5ff, 0x17233b, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.8)
  sun.position.set(-12, 25, 12)
  scene.add(sun)

  const resources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = { geometries: [], materials: [] }
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { resources.geometries.push(geometry); return geometry }
  const ownMaterial = <T extends THREE.Material>(material: T): T => { resources.materials.push(material); return material }
  const points = positionGraph(graph)
  const bandDepth = Math.max(16, ...points.map(({ point }) => Math.abs(point[2]) * 2 + 3))
  const base = ownGeometry(new THREE.PlaneGeometry(7, bandDepth))
  const bandMaterial = [0x12364a, 0x342454, 0x513d16, 0x1c4533].map((color) => ownMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.48 })))
  for (let index = 0; index < BAND_X.length; index++) {
    const band = new THREE.Mesh(base, bandMaterial[index])
    band.rotation.x = -Math.PI / 2
    band.position.set(BAND_X[index], -0.02, 0)
    scene.add(band)
  }
  const geometry: Record<RecordKind, THREE.BufferGeometry> = {
    deal: ownGeometry(new THREE.IcosahedronGeometry(0.68, 1)),
    project: ownGeometry(new THREE.BoxGeometry(1.13, 1.13, 1.13)),
    invoice: ownGeometry(new THREE.CylinderGeometry(0.56, 0.56, 1.02, 12)),
    task: ownGeometry(new THREE.ConeGeometry(0.64, 1.2, 8)),
  }
  const byKey = new Map(points.map((item) => [item.key, new THREE.Vector3(...item.point)]))
  const meshes = new Map<RecordKey, THREE.Mesh>()
  for (const item of points) {
    const material = ownMaterial(new THREE.MeshStandardMaterial({ color: COLORS[item.kind], metalness: 0.08, roughness: 0.38, emissive: COLORS[item.kind], emissiveIntensity: 0.24 }))
    const mesh = new THREE.Mesh(geometry[item.kind], material)
    mesh.position.copy(byKey.get(item.key)!)
    mesh.userData.recordKey = item.key
    meshes.set(item.key, mesh)
    scene.add(mesh)
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let down: { x: number; y: number } | null = null
  let disposed = false
  let visible = true
  let raf = 0
  let count = 0
  let lines: THREE.LineSegments | null = null

  function fitView() {
    controls.target.set(0, 0, 0)
    const direction = new THREE.Vector3(0, 18, 29).normalize()
    const extentX = Math.max(15.5, ...points.map(({ point }) => Math.abs(point[0]) + 0.8))
    const extentZ = bandDepth / 2
    const corners = [-extentX, extentX].flatMap((x) => [-extentZ, extentZ].flatMap((z) => [0, 1.5].map((y) => new THREE.Vector3(x, y, z))))
    let distance = 18
    for (let step = 0; step < 28; step++) {
      camera.position.copy(direction).multiplyScalar(distance)
      camera.lookAt(controls.target)
      camera.updateMatrixWorld()
      if (corners.every((corner) => {
        const projected = corner.clone().project(camera)
        return Math.abs(projected.x) < 0.88 && Math.abs(projected.y) < 0.78
      })) break
      distance *= 1.11
    }
    controls.update()
    requestDraw()
  }

  function draw() {
    raf = 0
    if (disposed || !visible || document.hidden) return
    const started = performance.now()
    renderer.render(scene, camera)
    host.dataset.frameMs = (performance.now() - started).toFixed(2)
    host.dataset.renderCount = String(++count)
    host.dataset.pickTargets = JSON.stringify(points.map(({ key, point }) => {
      const projected = new THREE.Vector3(...point).project(camera)
      return { key, x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 }
    }))
  }
  function requestDraw() {
    if (!disposed && visible && !document.hidden && raf === 0) raf = requestAnimationFrame(draw)
  }
  function resize() {
    if (disposed) return
    const width = host.clientWidth
    const height = host.clientHeight
    if (width < 1 || height < 1) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    fitView()
  }
  function onPointerDown(event: PointerEvent) {
    if (event.button === 0) down = { x: event.clientX, y: event.clientY }
  }
  function onPointerUp(event: PointerEvent) {
    if (!down || event.button !== 0) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    down = null
    if (moved > 5 || disposed) return
    const rect = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects([...meshes.values()], false)[0]
    if (hit) events.onSelect(hit.object.userData.recordKey as RecordKey)
  }
  function onPointerCancel() { down = null }
  function onVisibility() {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0 }
    if (!document.hidden) requestDraw()
  }
  function onContextLost(event: Event) {
    event.preventDefault()
    if (disposed) return
    dispose()
    events.onUnavailable()
  }

  const resizeObserver = new ResizeObserver(resize)
  const intersectionObserver = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false
    if (!visible && raf) { cancelAnimationFrame(raf); raf = 0 }
    if (visible) requestDraw()
  })
  resizeObserver.observe(host)
  intersectionObserver.observe(host)
  controls.addEventListener("change", requestDraw)
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointerup", onPointerUp)
  canvas.addEventListener("pointercancel", onPointerCancel)
  canvas.addEventListener("pointerleave", onPointerCancel)
  canvas.addEventListener("webglcontextlost", onContextLost)
  document.addEventListener("visibilitychange", onVisibility)
  resize()
  document.documentElement.dataset.erp3dActiveScenes = String(++activeScenes)

  function focus(key: RecordKey | null, resetCamera = false) {
    if (disposed) return
    if (resetCamera) fitView()
    if (lines) {
      scene.remove(lines)
      lines.geometry.dispose()
      ;(lines.material as THREE.Material).dispose()
      lines = null
    }
    for (const [meshKey, mesh] of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = meshKey === key ? 0.85 : 0.24
      mesh.scale.setScalar(meshKey === key ? 1.3 : 1)
    }
    const relations = selectedRelations(graph, key)
    if (relations.length) {
      const vertices = relations.flatMap(({ from, to }) => {
        const a = byKey.get(from)!
        const b = byKey.get(to)!
        return [a.x, a.y, a.z, b.x, b.y, b.z]
      })
      const edgeGeometry = new THREE.BufferGeometry()
      edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
      lines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }))
      scene.add(lines)
    }
    host.dataset.selectedKey = key ?? ""
    host.dataset.visibleEdgeCount = String(relations.length)
    requestDraw()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    if (raf) cancelAnimationFrame(raf)
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    document.removeEventListener("visibilitychange", onVisibility)
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener("pointerup", onPointerUp)
    canvas.removeEventListener("pointercancel", onPointerCancel)
    canvas.removeEventListener("pointerleave", onPointerCancel)
    canvas.removeEventListener("webglcontextlost", onContextLost)
    controls.removeEventListener("change", requestDraw)
    controls.dispose()
    if (lines) { lines.geometry.dispose(); (lines.material as THREE.Material).dispose() }
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) material.dispose()
    renderer.dispose()
    canvas.remove()
    host.dataset.webgl = "disposed"
    document.documentElement.dataset.erp3dActiveScenes = String(--activeScenes)
  }

  return { focus, dispose }
}
