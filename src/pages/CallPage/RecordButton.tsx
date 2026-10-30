import { useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import styles from './CallPage.module.css'
import { canPickFolder, ensureWriteAccess, loadFolder, pickFolder, type FolderHandle } from '../../utils/recordFolder'

interface Props {
  // Начало имени файла записи, например «Урок · Биология»
  fileName: string
  onError: (message: string) => void
}

// Куда идут куски записи: сразу в файл в выбранной папке или в память, а в конце — скачивание
interface Output {
  write: (chunk: Blob) => void
  // false — сохранить не удалось (ошибку уже показали)
  finish: () => Promise<boolean>
}

interface Recording {
  recorder: MediaRecorder
  audio: AudioContext
  output: MediaStreamAudioDestinationNode
  mic: { track: MediaStreamTrack; source: MediaStreamAudioSourceNode } | null
}

// Первый формат, который умеет браузер (Chrome/Edge/Firefox пишут webm, Safari — mp4)
const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']

function pickMimeType() {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

function timestamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`
}

// В имени файла нельзя \ / : * ? " < > |
function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function downloadOutput(name: string, type: string): Output {
  const chunks: Blob[] = []
  return {
    write: (chunk) => chunks.push(chunk),
    finish: async () => {
      if (chunks.length > 0) download(new Blob(chunks, { type }), name)
      return true
    },
  }
}

// Пишем куски по очереди прямо в файл — длинный урок не держится целиком в памяти
async function folderOutput(folder: FolderHandle, name: string, onError: Props['onError']): Promise<Output> {
  const file = await folder.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  let queue = Promise.resolve()
  let failed = false
  const fail = (err: unknown) => {
    if (failed) return
    failed = true
    onError(`Не удалось сохранить запись в папку «${folder.name}»: ${err instanceof Error ? err.message : err}`)
  }
  return {
    write: (chunk) => {
      queue = queue.then(() => writable.write(chunk)).catch(fail)
    },
    finish: async () => {
      await queue
      await writable.close().catch(fail)
      return !failed
    },
  }
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Запись урока в браузере учителя: видео выбранной вкладки или экрана, звук вкладки
// (голоса учеников) смешивается с микрофоном учителя. В Chrome и Edge запись пишется в папку,
// которую учитель выбирает при первой записи (кнопка «Папка» — сменить); в остальных браузерах скачивается.
function RecordButton({ fileName, onError }: Props) {
  const { microphoneTrack } = useLocalParticipant()
  const micTrack = microphoneTrack?.track?.mediaStreamTrack ?? null
  const recordingRef = useRef<Recording | null>(null)
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [folder, setFolder] = useState<FolderHandle | null>(null)
  const [savedTo, setSavedTo] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadFolder().then((saved) => {
      if (!cancelled) setFolder(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Микрофон могут выключить и включить заново — подключаем к записи текущую дорожку
  useEffect(() => {
    const rec = recordingRef.current
    if (!rec || rec.mic?.track === micTrack) return
    rec.mic?.source.disconnect()
    rec.mic = null
    if (micTrack) {
      const source = rec.audio.createMediaStreamSource(new MediaStream([micTrack]))
      source.connect(rec.output)
      rec.mic = { track: micTrack, source }
    }
  }, [micTrack, recording])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  // Закрыли вкладку во время записи — браузер переспросит, иначе запись пропадёт
  useEffect(() => {
    if (!recording) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [recording])

  // Вышли из урока во время записи — останавливаем и сохраняем
  useEffect(
    () => () => {
      const rec = recordingRef.current
      if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop()
    },
    [],
  )

  function stop() {
    const rec = recordingRef.current
    if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop()
  }

  async function changeFolder() {
    const picked = await pickFolder()
    if (picked) setFolder(picked)
  }

  // Папка, в которую можно писать: при первой записи — окно выбора, потом — сохранённая.
  // undefined — учитель отказался, записи не будет.
  async function resolveFolder(): Promise<FolderHandle | null | undefined> {
    if (!canPickFolder()) return null
    const current = folder ?? (await pickFolder())
    if (!current) return undefined
    setFolder(current)
    if (await ensureWriteAccess(current)) return current
    onError(`Нет доступа к папке «${current.name}» — разрешите его или выберите другую кнопкой «Папка»`)
    return undefined
  }

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      onError('Этот браузер не умеет записывать экран — откройте урок в Chrome, Edge или Firefox')
      return
    }
    setStarting(true)
    try {
      await startRecording()
    } finally {
      setStarting(false)
    }
  }

  async function startRecording() {
    // Сначала папка: разрешение на запись браузер даёт только сразу после нажатия кнопки
    const target = await resolveFolder()
    if (target === undefined) return
    setSavedTo('')

    let display: MediaStream
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
        // Chrome сразу предложит эту вкладку — в ней слышны ученики
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions)
    } catch (err) {
      // «Отмена» в окне выбора — молча; после выбора папки браузер мог не открыть окно без нового нажатия
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        onError('Папка выбрана — нажмите «Запись» ещё раз')
      }
      return
    }

    const audio = new AudioContext()
    const output = audio.createMediaStreamDestination()
    if (display.getAudioTracks().length > 0) {
      audio.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(output)
    }
    const stream = new MediaStream([...display.getVideoTracks(), ...output.stream.getAudioTracks()])
    const cleanup = () => {
      display.getTracks().forEach((t) => t.stop())
      void audio.close()
    }

    const mimeType = pickMimeType()
    let recorder: MediaRecorder
    let out: Output
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const type = recorder.mimeType || mimeType || 'video/webm'
      const name = safeName(`${fileName} ${timestamp()}`) + (type.startsWith('video/mp4') ? '.mp4' : '.webm')
      out = target ? await folderOutput(target, name, onError) : downloadOutput(name, type)
      if (target) setSavedTo(`Запись сохраняется в папку «${target.name}»: ${name}`)
    } catch (err) {
      cleanup()
      onError(err instanceof Error ? `Не удалось начать запись: ${err.message}` : 'Не удалось начать запись')
      return
    }

    const rec: Recording = { recorder, audio, output, mic: null }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) out.write(event.data)
    }
    recorder.onstop = () => {
      rec.mic?.source.disconnect()
      cleanup()
      recordingRef.current = null
      setRecording(false)
      void out.finish().then((saved) => {
        setSavedTo(target && saved ? `Запись сохранена в папку «${target.name}»` : '')
      })
    }
    // Нажали «Закрыть доступ» на панели браузера — запись тоже заканчивается
    display.getVideoTracks()[0]?.addEventListener('ended', stop)

    recordingRef.current = rec
    // Куски раз в секунду: в папку они уходят по ходу урока, а не одним файлом в конце
    recorder.start(1000)
    setSeconds(0)
    setRecording(true)
  }

  return (
    <>
      <button
        type="button"
        className={`lk-button ${styles.control} ${recording ? styles.recording : ''}`}
        onClick={recording ? stop : start}
        disabled={starting}
        title={recording ? 'Остановить запись' : 'Записать урок в видеофайл'}
      >
        {recording ? (
          <>
            <span className={styles.recDot} aria-hidden="true" />
            Стоп · {formatTime(seconds)}
          </>
        ) : (
          'Запись'
        )}
      </button>
      {canPickFolder() && (
        <button
          type="button"
          className={`lk-button ${styles.control} ${styles.folder}`}
          onClick={changeFolder}
          disabled={recording || starting}
          title={recording ? 'Папку можно сменить после записи' : 'Выбрать папку для записей'}
        >
          {folder ? `Папка: ${folder.name}` : 'Папка для записей'}
        </button>
      )}
      {savedTo && <p className={styles.savedTo}>{savedTo}</p>}
    </>
  )
}

export default RecordButton
