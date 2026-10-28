import { useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
import styles from './LatexEditor.module.css'
import LatexDocument, { type DocFile } from '../LatexDocument/LatexDocument'
import { imageKey, parseLatex } from '../../utils/latex'

// Как MAX_LATEX_LENGTH на сервере: больше — сервер всё равно не примет
const MAX_LATEX_LENGTH = 200_000

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  files?: DocFile[] // уже прикреплённые файлы — в них ищутся картинки
  pendingNames?: string[] // файлы, выбранные, но ещё не сохранённые
}

// Поле для кода LaTeX с заданиями и предпросмотром того, что увидит ученик
function LatexEditor({ label, value, onChange, files = [], pendingNames = [] }: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const [fileError, setFileError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const doc = useMemo(() => parseLatex(value), [value])
  const known = new Set([...files.map((f) => f.name), ...pendingNames].map(imageKey))
  const missing = doc.images.filter((name) => !known.has(imageKey(name)))

  // Код из .tex-файла подставляется в поле — дальше его можно править как обычно
  async function loadTexFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.tex')) {
      setFileError(`${file.name} — не .tex файл`)
      return
    }
    const text = await file.text()
    if (text.length > MAX_LATEX_LENGTH) {
      setFileError(`Файл ${file.name} слишком большой — больше ${MAX_LATEX_LENGTH} знаков`)
      return
    }
    if (value.trim() && !window.confirm('Заменить текущий код содержимым файла?')) return
    setFileError('')
    onChange(text)
  }

  function handleTexFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) loadTexFile(file)
  }

  // Перетаскивание .tex-файла на поле. Обычный текст браузер вставляет сам
  function isFileDrag(e: DragEvent) {
    return e.dataTransfer.types.includes('Files')
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // dragleave приходит и при переходе на дочерний элемент — его пропускаем
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadTexFile(file)
  }

  return (
    <div className={styles.editor}>
      <label className={styles.label}>
        {label}
        <div
          className={styles.dropZone}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <textarea
            className={styles.textarea}
            rows={10}
            spellCheck={false}
            placeholder={'\\zadacha{1}\nНайдите $x$, если $x^2 = 16$.\n\\razdel\n\\zadacha{2}\n...'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {isDragging && <div className={styles.dropOverlay}>Отпустите .tex файл здесь</div>}
        </div>
      </label>
      <label className={styles.toggle}>
        📂 Загрузить .tex файл
        <input type="file" accept=".tex,text/x-tex" className={styles.hiddenInput} onChange={handleTexFile} />
      </label>
      {fileError && <p className={styles.warning}>{fileError}</p>}
      <p className={styles.hint}>
        Вставьте код целиком, загрузите или перетащите .tex — преамбулу удалять не нужно. Картинки из{' '}
        <code>\includegraphics</code> прикрепите файлами с теми же именами.
      </p>
      {value.trim() && (
        <p className={styles.summary}>
          {doc.tasks > 0 ? `Заданий: ${doc.tasks}` : 'Плашек \\zadacha не найдено — будет показан просто текст'}
          {missing.length > 0 && <span className={styles.warning}> · Нет картинок: {missing.join(', ')}</span>}
        </p>
      )}
      {value.trim() && (
        <button type="button" className={styles.toggle} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Скрыть предпросмотр' : '👁 Как увидит ученик'}
        </button>
      )}
      {showPreview && value.trim() && (
        <div className={styles.preview}>
          <LatexDocument source={value} files={files} />
        </div>
      )}
    </div>
  )
}

export default LatexEditor
