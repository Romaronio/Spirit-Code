import styles from './ProgressDonut.module.css'

interface Props {
  done: number // сколько ДЗ сдано (учитель отметил «Сдано»)
  total: number // сколько всего заданий у ученика
}

const SIZE = 64
const STROKE = 8
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 2 // зазор между зелёной и красной частью

// Кольцо прогресса: зелёным — доля сданных ДЗ, красным — остальное
function ProgressDonut({ done, total }: Props) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const doneLength = total > 0 ? (done / total) * CIRCUMFERENCE : 0
  const restLength = CIRCUMFERENCE - doneLength
  // Зазоры рисуем только когда видны обе части
  const gap = doneLength > 0 && restLength > 0 ? GAP : 0
  const label = `Сдано ${done} из ${total} домашних работ (${percent}%)`

  return (
    <div className={styles.wrapper} title={label} role="img" aria-label={label}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.ring}>
        {total === 0 ? (
          <circle className={styles.empty} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        ) : (
          <>
            {restLength > 0 && (
              <circle
                className={styles.rest}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                strokeWidth={STROKE}
                strokeDasharray={`${Math.max(restLength - gap, 0)} ${CIRCUMFERENCE}`}
                strokeDashoffset={-(doneLength + gap / 2)}
              />
            )}
            {doneLength > 0 && (
              <circle
                className={styles.done}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                strokeWidth={STROKE}
                strokeDasharray={`${Math.max(doneLength - gap, 0)} ${CIRCUMFERENCE}`}
                strokeDashoffset={-gap / 2}
              />
            )}
          </>
        )}
      </svg>
      <span className={styles.percent}>{total > 0 ? `${percent}%` : '—'}</span>
      <span className={styles.caption}>
        сдано {done} из {total}
      </span>
    </div>
  )
}

export default ProgressDonut
