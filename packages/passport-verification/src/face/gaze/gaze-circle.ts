// ─── gaze-face.ts ─────────────────────────────────────────────────────────────
// Renders a minimalist wireframe face on a canvas and animates its gaze in a
// continuous circle, simulating 3D head rotation via sphere-projection math.
//
// Usage:
//   const face = new GazeFace(canvasElement);
//   face.start();          // begin animation loop
//   face.stop();           // cancel animation
//   face.setSpeed(0.012);  // radians per frame (default 0.008 ≈ 3 s / revolution)

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vec3 {
  x: number
  y: number
  z: number
}

interface ProjectedPoint extends Vec3 {
  visible: boolean
}

interface EyeDescriptor {
  side: -1 | 1
  sphereX: number
  sphereY: number
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const BLUE = '#00e5ff'
const BLUE_DIM = 'rgba(0,180,220,0.25)'
const BLUE_MID = 'rgba(0,210,240,0.65)'

// ─── Pure math helpers ────────────────────────────────────────────────────────

/** Rotate a 3-D point by yaw (Y-axis) then pitch (X-axis). */
function rotateYP(x: number, y: number, z: number, yaw: number, pitch: number): Vec3 {
  // Yaw around Y
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y1 = y
  // Pitch around X
  const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch)
  return { x: x1, y: y2, z: z2 }
}

// ─── GazeFace class ───────────────────────────────────────────────────────────

export class GazeFace {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D

  private readonly W: number
  private readonly H: number
  private readonly CX: number
  private readonly CY: number

  /** Sphere radius in pixels — scales all geometry. */
  private readonly R = 118

  /** How far off-centre the iris sits (0–1). */
  private gazeRadius = 0.72

  /** Current gaze angle in radians (drives iris offset). */
  private gazeAngle = 0

  /** Time accumulator for the circular animation. */
  private t = 0

  /** Radians advanced per animation frame (~60 fps → 0.008 ≈ 3 s/rev). */
  private speed = 0.008

  /** Maximum yaw / pitch excursion in radians. 30° = π/6. */
  private readonly MAX_ANGLE = Math.PI / 6

  private rafId: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D context from canvas')
    this.ctx = ctx

    this.W = canvas.width
    this.H = canvas.height
    this.CX = this.W / 2
    this.CY = this.H / 2
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.rafId !== null) return
    const loop = () => {
      this.tick()
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /** Override animation speed (radians per frame). */
  setSpeed(radiansPerFrame: number): void {
    this.speed = radiansPerFrame
  }

  /**
   * Draw a single frame at an explicit head pose, bypassing the animation loop.
   * Useful for snapshot rendering or external control.
   */
  drawAtPose(yaw: number, pitch: number, gazeAngle: number, gazeRadius = 0.72): void {
    this.gazeAngle = gazeAngle
    this.gazeRadius = gazeRadius
    this.draw(yaw, pitch)
  }

  // ── Private: animation tick ─────────────────────────────────────────────────

  private tick(): void {
    this.t += this.speed

    const yaw = Math.cos(this.t) * this.MAX_ANGLE
    const pitch = Math.sin(this.t) * this.MAX_ANGLE

    this.gazeAngle = this.t
    this.gazeRadius = 0.72

    this.draw(yaw, pitch)
  }

  // ── Private: rendering ──────────────────────────────────────────────────────

  private setLine(width: number, color: string, glow = 0): void {
    this.ctx.lineWidth = width
    this.ctx.strokeStyle = color
    this.ctx.shadowBlur = glow
    this.ctx.shadowColor = BLUE
  }

  /**
   * Project a unit-sphere surface point (sx, sy, sz) to canvas coordinates,
   * applying yaw/pitch rotation and a perspective divide.
   */
  private project(sx: number, sy: number, sz: number, yaw: number, pitch: number): ProjectedPoint {
    const FOV = 2.2
    const r = rotateYP(sx, sy, sz, yaw, pitch)
    const z = r.z + FOV
    return {
      x: this.CX + (r.x / z) * FOV * this.R,
      y: this.CY + (r.y / z) * FOV * this.R,
      z: r.z,
      visible: r.z > -0.55,
    }
  }

  private draw(yaw: number, pitch: number): void {
    const { ctx, CX, CY, R } = this
    ctx.clearRect(0, 0, this.W, this.H)
    ctx.lineCap = 'round'

    // ── Face ellipse ──────────────────────────────────────────────────────────
    // The silhouette of a rotated sphere stays circular; we add a slight
    // foreshortening factor for the jaw-elongation feel.
    const fRx = R * (1 - Math.abs(yaw) * 0.03)
    const fRy = R * (1.07 - Math.abs(pitch) * 0.03)
    const fCx = CX + yaw * R * 0.04
    const fCy = CY + pitch * R * 0.04

    // Volume fill
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(fCx, fCy, fRx, fRy, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,30,45,0.55)'
    ctx.fill()
    ctx.restore()

    // Glow pass
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(fCx, fCy, fRx, fRy, 0, 0, Math.PI * 2)
    this.setLine(5, BLUE_DIM, 18)
    ctx.stroke()
    ctx.restore()

    // Crisp outline
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(fCx, fCy, fRx, fRy, 0, 0, Math.PI * 2)
    this.setLine(1.5, BLUE, 6)
    ctx.stroke()
    ctx.restore()

    // ── Eyes ──────────────────────────────────────────────────────────────────
    const eyes: EyeDescriptor[] = [
      { side: -1, sphereX: -0.3, sphereY: -0.13 },
      { side: 1, sphereX: 0.3, sphereY: -0.13 },
    ]

    eyes.forEach(eye => {
      const ep = this.project(eye.sphereX, eye.sphereY, 0.94, yaw, pitch)
      if (!ep.visible) return

      // Foreshortening: far eye narrows slightly
      const lat = eye.side * yaw
      const eRx = R * 0.115 * (1 - lat * 0.22)
      const eRy = R * 0.068 * (1 - Math.abs(pitch) * 0.1)
      if (eRx < 2) return // fully rotated out of view

      // Socket fill
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(ep.x, ep.y, eRx, eRy, yaw * 0.12, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,15,25,0.7)'
      ctx.fill()
      ctx.restore()

      // Socket glow
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(ep.x, ep.y, eRx, eRy, yaw * 0.12, 0, Math.PI * 2)
      this.setLine(4, BLUE_DIM, 14)
      ctx.stroke()
      ctx.restore()

      // Socket outline
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(ep.x, ep.y, eRx, eRy, yaw * 0.12, 0, Math.PI * 2)
      this.setLine(1.2, BLUE, 4)
      ctx.stroke()
      ctx.restore()

      // ── Iris + pupil clipped inside socket ──────────────────────────────
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(ep.x, ep.y, eRx, eRy, yaw * 0.12, 0, Math.PI * 2)
      ctx.clip()

      // Iris centre: offset in the gaze direction, clipped by socket ellipse
      const maxOff = eRx * 0.4
      const irisX = ep.x + Math.cos(this.gazeAngle) * this.gazeRadius * maxOff
      const irisY = ep.y + Math.sin(this.gazeAngle) * this.gazeRadius * maxOff * 0.78
      const irisR = eRx * 0.58 * (1 - lat * 0.05)

      // Iris glow
      ctx.beginPath()
      ctx.arc(irisX, irisY, irisR, 0, Math.PI * 2)
      this.setLine(4, BLUE_DIM, 10)
      ctx.stroke()

      // Iris crisp ring
      ctx.beginPath()
      ctx.arc(irisX, irisY, irisR, 0, Math.PI * 2)
      this.setLine(1.2, BLUE_MID, 3)
      ctx.stroke()

      // Pupil dot
      const pupR = irisR * 0.36
      ctx.beginPath()
      ctx.arc(irisX, irisY, pupR, 0, Math.PI * 2)
      ctx.fillStyle = BLUE
      ctx.shadowBlur = 8
      ctx.shadowColor = BLUE
      ctx.fill()

      ctx.restore()
    })

    // ── Mouth ────────────────────────────────────────────────────────────────
    const mp = this.project(0, 0.44, 0.9, yaw, pitch)
    if (mp.visible) {
      const mRx = R * 0.2 * (1 - Math.abs(yaw) * 0.45)
      const mRy = R * 0.055 * (1 - Math.abs(pitch) * 0.3)

      // Glow
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(mp.x, mp.y, mRx, mRy, yaw * 0.1, 0, Math.PI * 2)
      this.setLine(4, BLUE_DIM, 12)
      ctx.stroke()
      ctx.restore()

      // Crisp line
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(mp.x, mp.y, mRx, mRy, yaw * 0.1, 0, Math.PI * 2)
      this.setLine(1.2, BLUE, 4)
      ctx.stroke()
      ctx.restore()
    }

    // Reset shadow so it doesn't bleed into unrelated draws
    ctx.shadowBlur = 0
  }
}
