import { useEffect, useRef } from 'react'
import styles from './CodeRunner.module.css'
import type { TurtleDrawing } from '../../utils/pyTurtle'

const HEIGHT = 360
const PAD = 16

// Рисунок черепахи: весь рисунок вписывается в окно, оси координат — серым через (0, 0)
function TurtleCanvas({ drawing }: { drawing: TurtleDrawing }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const width = canvas.clientWidth
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
      const g = canvas.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = drawing.bg || 'white'
      g.fillRect(0, 0, width, HEIGHT)

      // Границы рисунка (с началом координат и черепахами)
      let minX = 0, maxX = 0, minY = 0, maxY = 0
      const see = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      for (const [x1, y1, x2, y2] of drawing.lines) { see(x1, y1); see(x2, y2) }
      for (const [x, y] of drawing.dots) see(x, y)
      for (const [pts] of drawing.fills) for (let i = 0; i + 1 < pts.length; i += 2) see(pts[i], pts[i + 1])
      for (const [x, y] of drawing.texts) see(x, y)
      for (const [x, y] of drawing.turtles) see(x, y)
      const spanX = Math.max(maxX - minX, 1)
      const spanY = Math.max(maxY - minY, 1)
      const k = Math.min((width - 2 * PAD) / spanX, (HEIGHT - 2 * PAD) / spanY)
      const ox = (width - spanX * k) / 2 - minX * k
      const oy = (HEIGHT - spanY * k) / 2 + maxY * k
      const sx = (x: number) => ox + x * k
      const sy = (y: number) => oy - y * k

      // Оси
      g.strokeStyle = 'rgba(128,128,128,0.35)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, sy(0)); g.lineTo(width, sy(0))
      g.moveTo(sx(0), 0); g.lineTo(sx(0), HEIGHT)
      g.stroke()

      for (const [pts, color] of drawing.fills) {
        g.fillStyle = color
        g.beginPath()
        for (let i = 0; i + 1 < pts.length; i += 2) {
          if (i === 0) g.moveTo(sx(pts[i]), sy(pts[i + 1]))
          else g.lineTo(sx(pts[i]), sy(pts[i + 1]))
        }
        g.closePath()
        g.fill()
      }

      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (const [x1, y1, x2, y2, color, w] of drawing.lines) {
        g.strokeStyle = color
        g.lineWidth = Math.max(w, 1)
        g.beginPath()
        g.moveTo(sx(x1), sy(y1))
        g.lineTo(sx(x2), sy(y2))
        g.stroke()
      }

      for (const [x, y, size, color] of drawing.dots) {
        g.fillStyle = color
        g.beginPath()
        g.arc(sx(x), sy(y), Math.max(size / 2, 1), 0, Math.PI * 2)
        g.fill()
      }

      g.font = '14px sans-serif'
      for (const [x, y, text, color] of drawing.texts) {
        g.fillStyle = color
        g.fillText(text, sx(x), sy(y))
      }

      // Черепахи — стрелкой по направлению движения
      for (const [x, y, heading, color] of drawing.turtles) {
        const a = (-heading * Math.PI) / 180
        g.save()
        g.translate(sx(x), sy(y))
        g.rotate(a)
        g.fillStyle = color
        g.beginPath()
        g.moveTo(9, 0); g.lineTo(-6, 5); g.lineTo(-3, 0); g.lineTo(-6, -5)
        g.closePath()
        g.fill()
        g.restore()
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [drawing])

  return (
    <div className={styles.turtle}>
      <canvas ref={ref} className={styles.canvas} style={{ height: HEIGHT }} />
      {drawing.truncated && <p className={styles.note}>Рисунок слишком большой — показана только часть</p>}
    </div>
  )
}

export default TurtleCanvas
