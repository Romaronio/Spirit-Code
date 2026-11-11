import { useEffect, useRef } from 'react'
import styles from './Celebration.module.css'

// Праздник поверх страницы: шарики летят снизу вверх, в небе взрываются салюты.
// Ничего не перекрывает для мыши и клавиатуры — можно сразу печатать дальше.
// Кто отключил анимацию в системе (prefers-reduced-motion), праздника не увидит

const DURATION_MS = 6500 // сколько запускаются новые шарики и салюты; потом всё догорает и исчезает
const COLORS = ['#ff8400', '#ff4d6d', '#ffd60a', '#4cc9f0', '#80ed99', '#c77dff', '#ff9a2e']

interface Balloon {
  x: number
  y: number
  r: number
  speed: number
  sway: number
  phase: number
  color: string
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number // 1 → 0
  decay: number
  color: string
}

interface Rocket {
  x: number
  y: number
  vy: number
  targetY: number
  color: string
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

function drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon, t: number) {
  const x = b.x + Math.sin(t / 700 + b.phase) * b.sway
  const { y, r } = b
  // Ниточка
  ctx.strokeStyle = 'rgba(80, 60, 40, 0.55)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(x, y + r * 1.2)
  ctx.quadraticCurveTo(x + Math.sin(t / 300 + b.phase) * 8, y + r * 2.2, x, y + r * 3.2)
  ctx.stroke()
  // Шарик чуть вытянут вниз
  ctx.fillStyle = b.color
  ctx.beginPath()
  ctx.ellipse(x, y, r, r * 1.2, 0, 0, Math.PI * 2)
  ctx.fill()
  // Узелок
  ctx.beginPath()
  ctx.moveTo(x - 4, y + r * 1.25)
  ctx.lineTo(x + 4, y + r * 1.25)
  ctx.lineTo(x, y + r * 1.15)
  ctx.closePath()
  ctx.fill()
  // Блик
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.beginPath()
  ctx.ellipse(x - r * 0.35, y - r * 0.45, r * 0.18, r * 0.32, -0.5, 0, Math.PI * 2)
  ctx.fill()
}

function Celebration({ onDone }: { onDone?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDoneRef.current?.()
      return
    }

    let width = 0
    let height = 0
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const small = width < 600
    const balloons: Balloon[] = []
    const rockets: Rocket[] = []
    const sparks: Spark[] = []

    function addBalloon(startBelow = 0) {
      const r = rand(small ? 16 : 20, small ? 26 : 34)
      balloons.push({
        x: rand(r, width - r),
        y: height + r * 1.3 + startBelow,
        r,
        speed: rand(1.4, 2.6), // px за кадр при 60 к/с
        sway: rand(8, 22),
        phase: rand(0, Math.PI * 2),
        color: pick(COLORS),
      })
    }

    function launchRocket() {
      rockets.push({
        x: rand(width * 0.15, width * 0.85),
        y: height,
        vy: -rand(9, 12),
        targetY: rand(height * 0.12, height * 0.4),
        color: pick(COLORS),
      })
    }

    function explode(x: number, y: number, color: string) {
      const count = small ? 45 : 70
      const second = pick(COLORS)
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + rand(-0.05, 0.05)
        const speed = rand(1.5, small ? 4.5 : 6)
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: rand(0.012, 0.022),
          color: Math.random() < 0.7 ? color : second,
        })
      }
    }

    // Первая волна шариков сразу, остальные подлетают в течение праздника
    for (let i = 0; i < (small ? 10 : 18); i++) addBalloon(rand(0, height * 0.6))
    launchRocket()

    const start = performance.now()
    let last = start
    let nextBalloon = start + 250
    let nextRocket = start + 500
    let frame = 0

    function tick(now: number) {
      const k = Math.min((now - last) / (1000 / 60), 3) // одинаковая скорость при любой частоте экрана
      last = now
      const running = now - start < DURATION_MS

      if (running && now >= nextBalloon) {
        addBalloon()
        nextBalloon = now + rand(150, 350)
      }
      if (running && now >= nextRocket) {
        launchRocket()
        if (Math.random() < 0.4) launchRocket()
        nextRocket = now + rand(450, 900)
      }

      ctx!.clearRect(0, 0, width, height)

      // Салют рисуется за шариками. Фон сайта светлый — обычное наложение, а не «сложение» цветов, иначе искры белеют
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]
        r.y += r.vy * k
        r.vy *= 0.985
        ctx!.fillStyle = r.color
        ctx!.beginPath()
        ctx!.arc(r.x, r.y, 2.5, 0, Math.PI * 2)
        ctx!.fill()
        if (r.y <= r.targetY || r.vy > -2) {
          explode(r.x, r.y, r.color)
          rockets.splice(i, 1)
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.vx *= 0.98
        s.vy = s.vy * 0.98 + 0.06 * k // гравитация
        s.x += s.vx * k
        s.y += s.vy * k
        s.life -= s.decay * k
        if (s.life <= 0) {
          sparks.splice(i, 1)
          continue
        }
        ctx!.globalAlpha = s.life
        ctx!.fillStyle = s.color
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, 2.2, 0, Math.PI * 2)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1

      for (let i = balloons.length - 1; i >= 0; i--) {
        const b = balloons[i]
        b.y -= b.speed * k
        if (b.y < -b.r * 4) {
          balloons.splice(i, 1)
          continue
        }
        drawBalloon(ctx!, b, now)
      }

      if (running || balloons.length || rockets.length || sparks.length) {
        frame = requestAnimationFrame(tick)
      } else {
        onDoneRef.current?.()
      }
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
}

export default Celebration
