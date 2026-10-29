import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import styles from './LatexEditor.module.css'
import LatexDocument, { type DocFile } from '../LatexDocument/LatexDocument'
import { imageKey, parseLatex } from '../../utils/latex'
import { photoToLatex } from '../../services/api'

// Как MAX_LATEX_LENGTH на сервере: больше — сервер всё равно не примет
const MAX_LATEX_LENGTH = 200_000

// Как PHOTO_EXTENSIONS на сервере (api/views.py)
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.bmp,.gif'

function isPhoto(file: File): boolean {
  return /\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name) || /^image\/(jpeg|png|webp|bmp|gif)$/.test(file.type)
}

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  files?: DocFile[] // уже прикреплённые файлы — в них ищутся картинки
  pendingNames?: string[] // файлы, выбранные, но ещё не сохранённые
  showHint?: boolean // подсказка про .tex, фото и картинки под полем
}

// Поле для кода LaTeX с заданиями и предпросмотром того, что увидит ученик
function LatexEditor({ label, value, onChange, files = [], pendingNames = [], showHint = true }: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const [fileError, setFileError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [photoStatus, setPhotoStatus] = useState('') // «Распознаю фото…», пока идёт запрос
  const [photoWarnings, setPhotoWarnings] = useState<string[]>([])

  // Распознавание идёт секунды — к его концу учитель мог поправить текст, берём свежий
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

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

  // Каждое фото — отдельная задача, дописывается в конец со следующим номером
  async function recognizePhotos(photos: File[]) {
    if (photoStatus || photos.length === 0) return
    setFileError('')
    setPhotoWarnings([])
    const warnings: string[] = []
    for (const [i, photo] of photos.entries()) {
      setPhotoStatus(photos.length > 1 ? `Распознаю фото ${i + 1} из ${photos.length}…` : 'Распознаю фото…')
      const current = valueRef.current
      const number = parseLatex(current).tasks + 1
      try {
        const result = await photoToLatex(photo, number)
        const next = current.trim() ? `${current.trimEnd()}\n\n\\razdel\n\n${result.latex}\n` : `${result.latex}\n`
        valueRef.current = next
        onChange(next)
        warnings.push(...result.warnings.map((w) => `Задача ${number}: ${w}`))
      } catch (err) {
        warnings.push(`${photo.name}: ${err instanceof Error ? err.message : 'не получилось распознать'}`)
        break // скорее всего, и следующие не пройдут (нет связи, лимит) — не тратим время
      }
    }
    setPhotoWarnings(warnings)
    setPhotoStatus('')
  }

  function handlePhotoInput(e: ChangeEvent<HTMLInputElement>) {
    const photos = Array.from(e.target.files ?? [])
    e.target.value = ''
    recognizePhotos(photos)
  }

  // Скриншот из буфера (Ctrl+V) тоже распознаётся. Обычный текст вставляется как всегда
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const photos = Array.from(e.clipboardData.files).filter(isPhoto)
    if (photos.length === 0) return
    e.preventDefault()
    recognizePhotos(photos)
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
    const dropped = Array.from(e.dataTransfer.files)
    const photos = dropped.filter(isPhoto)
    if (photos.length > 0) recognizePhotos(photos)
    else if (dropped[0]) loadTexFile(dropped[0])
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
            onPaste={handlePaste}
          />
          {isDragging && <div className={styles.dropOverlay}>Отпустите .tex файл или фото задания</div>}
          {photoStatus && <div className={styles.dropOverlay}>{photoStatus}</div>}
        </div>
      </label>
      <div className={styles.actions}>
        <label className={styles.toggle}>
          📂 Загрузить .tex файл
          <input type="file" accept=".tex,text/x-tex" className={styles.hiddenInput} onChange={handleTexFile} />
        </label>
        <label className={`${styles.toggle} ${photoStatus ? styles.disabled : ''}`} title="Можно и вставить скриншот в поле через Ctrl+V">
          📷 Из фото
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            multiple
            disabled={!!photoStatus}
            className={styles.hiddenInput}
            onChange={handlePhotoInput}
          />
        </label>
      </div>
      {fileError && <p className={styles.warning}>{fileError}</p>}
      {photoWarnings.length > 0 && (
        <ul className={styles.photoWarnings}>
          {photoWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {showHint && (
        <p className={styles.hint}>
          Вставьте код целиком, загрузите или перетащите .tex — преамбулу удалять не нужно. Фото или скриншот задания
          (кнопкой, перетаскиванием или Ctrl+V) превратится в LaTeX — проверьте результат в предпросмотре. Картинки из{' '}
          <code>\includegraphics</code> прикрепите файлами с теми же именами.
        </p>
      )}
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
