import { useEffect, useRef, useState } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import styles from './CallPage.module.css'
import { canPickFolder, ensureWriteAccess, loadFolder, pickFolder, type FolderHandle } from '../../utils/recordFolder'
import { createRecorder } from './recorders'

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
  // Останавливает запись и сохраняет файл; повторный вызов ничего не делает
  stop: () => void
  audio: AudioContext
  output: MediaStreamAudioDestinationNode
  // Звуковые дорожки созвона, подключённые к записи
  sources: Map<MediaStreamTrack, MediaStreamAudioSourceNode>
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

// «Автозапись» запоминается в этом браузере учителя
const AUTO_RECORD_KEY = 'spirit.autoRecord'

function readAutoRecord() {
  try {
    return localStorage.getItem(AUTO_RECORD_KEY) === '1'
  } catch {
    return false // без localStorage просто не запоминаем
  }
}

function saveAutoRecord(value: boolean) {
  try {
    localStorage.setItem(AUTO_RECORD_KEY, value ? '1' : '0')
  } catch {
    // без localStorage просто не запоминаем
  }
}

// Действует ли ещё нажатие, после которого браузер разрешает начать запись экрана
function hasUserGesture() {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return activation?.isActive ?? false
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Запись урока в браузере учителя: видео выбранной вкладки или экрана, а звук — прямо из созвона
// (микрофоны учителя и учеников, звук показа экрана), поэтому не важно, что выбрано в окне браузера. В Chrome и Edge запись пишется в папку,
// которую учитель выбирает при первой записи (кнопка «Папка» — сменить); в остальных браузерах скачивается.
function RecordButton({ fileName, onError }: Props) {
  // Только дорожки, которые учитель реально получает (onlySubscribed по умолчанию)
  const audioRefs = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio])
  const audioTracks = audioRefs
    .map((ref) => ref.publication?.track?.mediaStreamTrack)
    .filter((track): track is MediaStreamTrack => !!track)
  const recordingRef = useRef<Recording | null>(null)
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [folder, setFolder] = useState<FolderHandle | null>(null)
  const [savedTo, setSavedTo] = useState('')
  // Автозапись: при входе в урок запись начинается сама. Браузер разрешает запись экрана только
  // сразу после нажатия — если нажатие «Войти» уже «остыло», показываем крупную кнопку
  const [autoRecord, setAutoRecord] = useState(readAutoRecord)
  const [askToStart, setAskToStart] = useState(() => readAutoRecord() && !hasUserGesture())
  const autoTried = useRef(false)

  useEffect(() => {
    let cancelled = false
    void loadFolder().then((saved) => {
      if (!cancelled) setFolder(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Ученики заходят и выходят, микрофоны выключают и включают заново — подключаем к записи текущие дорожки
  useEffect(() => {
    const rec = recordingRef.current
    if (!rec) return
    const current = new Set(audioTracks)
    for (const [track, source] of rec.sources) {
      if (!current.has(track)) {
        source.disconnect()
        rec.sources.delete(track)
      }
    }
    for (const track of current) {
      if (rec.sources.has(track)) continue
      const source = rec.audio.createMediaStreamSource(new MediaStream([track]))
      source.connect(rec.output)
      rec.sources.set(track, source)
    }
  }, [audioTracks, recording])

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
      recordingRef.current?.stop()
    },
    [],
  )

  // Вошли в урок с включённой автозаписью — начинаем сразу или просим одно нажатие
  useEffect(() => {
    if (!autoRecord || askToStart || autoTried.current) return
    autoTried.current = true
    void start(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при входе в урок
  }, [])

  function toggleAutoRecord() {
    const next = !autoRecord
    setAutoRecord(next)
    saveAutoRecord(next)
    if (!next) setAskToStart(false)
  }

  function stop() {
    recordingRef.current?.stop()
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

  // auto — попытка автозаписи при входе: не вышло (браузер не дал без нажатия) — просим нажать
  async function start(auto = false) {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      onError('Этот браузер не умеет записывать экран — откройте урок в Chrome, Edge или Firefox')
      return
    }
    setStarting(true)
    setAskToStart(false)
    try {
      const started = await startRecording(auto)
      if (auto && !started) setAskToStart(true)
    } finally {
      setStarting(false)
    }
  }

  // true — запись пошла
  async function startRecording(auto: boolean): Promise<boolean> {
    // Сначала папка: разрешение на запись браузер даёт только сразу после нажатия кнопки
    const target = await resolveFolder()
    if (target === undefined) return false
    setSavedTo('')

    let display: MediaStream
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        // Звук берём из созвона, иначе голоса учеников попали бы в запись дважды
        audio: false,
        // Chrome сразу предложит эту вкладку с уроком
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions)
    } catch (err) {
      // «Отмена» в окне выбора — молча; после выбора папки браузер мог не открыть окно без нового нажатия
      if (!auto && err instanceof DOMException && err.name === 'InvalidStateError') {
        onError('Папка выбрана — нажмите «Запись» ещё раз')
      }
      return false
    }

    // На экране текст — браузеру важнее чёткость, чем плавность
    const screenTrack = display.getVideoTracks()[0]
    screenTrack.contentHint = 'detail'

    const audio = new AudioContext()
    const output = audio.createMediaStreamDestination()
    const cleanup = () => {
      display.getTracks().forEach((t) => t.stop())
      void audio.close()
    }

    let finishing = false
    // Запись сломалась посреди урока — сохраняем, что успело записаться
    const fail = (err: unknown) => {
      onError(`Запись прервалась: ${err instanceof Error ? err.message : err}. Записанное до этого сохранено.`)
      finish()
    }
    let finish = () => {}

    let out: Output
    let recorder: Awaited<ReturnType<typeof createRecorder>>
    try {
      recorder = await createRecorder(screenTrack, output.stream.getAudioTracks()[0], (err) => fail(err))
      const name = safeName(`${fileName} ${timestamp()}`) + '.' + recorder.extension
      out = target ? await folderOutput(target, name, onError) : downloadOutput(name, recorder.mimeType)
      if (target) setSavedTo(`Запись сохраняется в папку «${target.name}»: ${name}`)
      await recorder.start((chunk) => out.write(chunk))
    } catch (err) {
      cleanup()
      onError(err instanceof Error ? `Не удалось начать запись: ${err.message}` : 'Не удалось начать запись')
      return false
    }

    const rec: Recording = {
      stop: () => finish(),
      audio,
      output,
      sources: new Map(),
    }
    finish = () => {
      if (finishing) return
      finishing = true
      recordingRef.current = null
      setRecording(false)
      void recorder
        .stop()
        .then(() => {
          rec.sources.forEach((source) => source.disconnect())
          cleanup()
          return out.finish()
        })
        .then((saved) => {
          setSavedTo(target && saved ? `Запись сохранена в папку «${target.name}»` : '')
        })
    }
    // Нажали «Закрыть доступ» на панели браузера — запись тоже заканчивается
    screenTrack.addEventListener('ended', () => finish())

    recordingRef.current = rec
    setSeconds(0)
    setRecording(true)
    return true
  }

  return (
    <>
      <button
        type="button"
        className={`lk-button ${styles.control} ${recording ? styles.recording : ''}`}
        onClick={recording ? stop : () => void start()}
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
      <button
        type="button"
        className={`lk-button ${styles.control}`}
        aria-pressed={autoRecord}
        data-lk-enabled={autoRecord}
        onClick={toggleAutoRecord}
        title="Начинать запись при каждом входе в урок"
      >
        Автозапись: {autoRecord ? 'вкл' : 'выкл'}
      </button>
      {savedTo && <p className={styles.savedTo}>{savedTo}</p>}
      {askToStart && !recording && (
        <div className={styles.autoRecord} role="dialog" aria-label="Автозапись урока">
          <span>Автозапись включена — браузеру нужно одно нажатие, чтобы начать запись</span>
          <button type="button" className={styles.autoRecordStart} onClick={() => void start()} disabled={starting}>
            <span className={styles.recDot} aria-hidden="true" />
            Начать запись урока
          </button>
          <button type="button" className={styles.autoRecordLater} onClick={() => setAskToStart(false)}>
            Не сейчас
          </button>
        </div>
      )}
    </>
  )
}

export default RecordButton
