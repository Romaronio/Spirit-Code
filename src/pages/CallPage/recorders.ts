// Кодирование записи урока. Два способа с одним интерфейсом:
//
// 1. Программный H.264 через WebCodecs (Chrome/Edge 94+), MP4 собирает mediabunny. Основной способ.
//    MediaRecorder в Chrome кодирует H.264 видеокартой, и на Intel UHD аппаратный кодировщик время от времени
//    выдаёт битый поток: файл открывается, но вместо экрана — вертикальные полосы с первого кадра до последнего
//    (так испортились записи уроков с 2 ноября 2026; ffmpeg на них: «first_mb_in_slice overflow»,
//    «error while decoding MB»). Управлять кодировщиком у MediaRecorder нельзя, у WebCodecs — можно:
//    hardwareAcceleration: 'prefer-software'.
// 2. MediaRecorder — запасной, если браузер не умеет первый (Firefox, старые версии).

// Экран урока — это в основном текст и код: нужен битрейт повыше, иначе буквы мылятся
const VIDEO_BITS_PER_SECOND = 5_000_000
const AUDIO_BITS_PER_SECOND = 128_000
// Опорный кадр каждые 2 с — иначе перемотка показывает серую «размазню»
const KEY_FRAME_INTERVAL_S = 2
// Экран шире — уменьшаем: программному кодировщику 4K не по силам вживую, а текст читается и так
const MAX_WIDTH = 2560
// Сколько дорожки читаются вхолостую перед записью, чтобы свести их часы
const WARM_UP_MS = 300

export interface LessonRecorder {
  extension: 'mp4' | 'webm'
  mimeType: string
  // Чем пишет — для сообщений об ошибках и проверки
  kind: 'software' | 'mediarecorder'
  // Куски файла приходят в write по порядку. position — куда положить кусок; нет — в конец файла.
  // Назад запись возвращается только в самом конце: поправить размер данных в начале MP4
  start: (write: (chunk: Blob, position?: number) => void) => Promise<void>
  // Останавливает запись и отдаёт хвост файла; после этого write больше не вызывается
  stop: () => Promise<void>
}

// Файл в памяти, куда можно писать и поверх уже записанного. Blob не копирует байты при склейке и нарезке
export function memoryFile(type: string) {
  let parts: Blob[] = []
  let size = 0
  return {
    write(chunk: Blob, position = size) {
      if (position === size) {
        parts.push(chunk)
      } else {
        const whole = new Blob(parts)
        const gap = new Blob([new ArrayBuffer(Math.max(0, position - size))])
        parts = [whole.slice(0, position), gap, chunk, whole.slice(position + chunk.size)]
      }
      size = Math.max(size, position + chunk.size)
    },
    get size() {
      return size
    },
    blob: () => new Blob(parts, { type }),
  }
}

// Сначала программный кодировщик, не вышло — MediaRecorder. onFail — запись сломалась посреди урока.
export async function createRecorder(
  video: MediaStreamTrack,
  audio: MediaStreamTrack,
  onFail: (err: unknown) => void,
): Promise<LessonRecorder> {
  try {
    const software = await softwareRecorder(video, audio, onFail)
    if (software) return software
  } catch (err) {
    console.warn('Программная запись недоступна, пишем через MediaRecorder', err)
  }
  return mediaRecorder(video, audio, onFail)
}

// Chrome/Edge; в типах TypeScript пока нет
declare const MediaStreamTrackProcessor: {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame | AudioData> }
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

// Настоящий размер кадров: getSettings() отдаёт его в CSS-пикселях, а при масштабе Windows 125–150 %
// кадры крупнее. Берём размер у <video>, как его видит декодер.
async function capturedSize(video: MediaStreamTrack) {
  const clone = video.clone()
  const el = document.createElement('video')
  el.muted = true
  el.srcObject = new MediaStream([clone])
  try {
    await Promise.race([
      new Promise<void>((resolve) => el.addEventListener('loadedmetadata', () => resolve(), { once: true })),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])
    if (el.videoWidth && el.videoHeight) return { width: el.videoWidth, height: el.videoHeight }
    const settings = video.getSettings()
    return { width: settings.width ?? 1920, height: settings.height ?? 1080 }
  } finally {
    el.srcObject = null
    clone.stop()
  }
}

// Размер кадра в записи: H.264 нужны чётные стороны, а окно браузера бывает любой ширины
async function frameSize(video: MediaStreamTrack) {
  const { width, height } = await capturedSize(video)
  const scale = Math.min(1, MAX_WIDTH / width)
  const target = { width: even(width * scale), height: even(height * scale) }
  return { ...target, resize: target.width !== width || target.height !== height }
}

async function softwareRecorder(
  video: MediaStreamTrack,
  audio: MediaStreamTrack,
  onFail: (err: unknown) => void,
): Promise<LessonRecorder | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null
  if (typeof MediaStreamTrackProcessor === 'undefined') return null
  const mb = await import('mediabunny')
  const size = await frameSize(video)
  const videoOptions = {
    bitrate: VIDEO_BITS_PER_SECOND,
    hardwareAcceleration: 'prefer-software',
    latencyMode: 'realtime',
  } as const
  if (!(await mb.canEncodeVideo('avc', { width: size.width, height: size.height, ...videoOptions }))) return null
  const audioOptions = { numberOfChannels: 2, sampleRate: 48_000, bitrate: AUDIO_BITS_PER_SECOND }
  // AAC «Медиаплеер» Windows играет везде; Opus в MP4 — запасной
  const audioCodec = (await mb.canEncodeAudio('aac', audioOptions))
    ? 'aac'
    : (await mb.canEncodeAudio('opus', audioOptions))
      ? 'opus'
      : null
  if (!audioCodec) return null

  let output: InstanceType<typeof mb.Output> | null = null
  let failed = false
  let stopped = false
  const readers: ReadableStreamDefaultReader<VideoFrame | AudioData>[] = []
  const pumps: Promise<void>[] = []
  // Начало записи в микросекундах часов страницы; пока null — идёт разогрев
  let startUs: number | null = null
  let pendingVideo: Promise<void> = Promise.resolve()

  const fail = (err: unknown) => {
    if (failed || stopped) return
    failed = true
    onFail(err)
  }

  // Читает кадры/звук дорожки и отдаёт их с меткой времени в секундах от начала записи.
  // Метки у Chrome в разных часах: у звука — часы страницы, у кадров экрана — системные. Поэтому для
  // каждой дорожки ищем сдвиг «метка − время прихода» (самый большой = кусок, пришедший без задержки)
  // и переводим всё в часы страницы. По моменту прихода, как делает mediabunny, нельзя: звук начинает
  // поступать с задержкой и пачкой, и тогда весь звук в записи отставал от экрана на 1–2 с.
  function pump<T extends VideoFrame | AudioData>(track: MediaStreamTrack, take: (chunk: T, seconds: number) => Promise<void> | void) {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader() as ReadableStreamDefaultReader<T>
    readers.push(reader as ReadableStreamDefaultReader<VideoFrame | AudioData>)
    let shift = -Infinity
    const run = async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        if (stopped || failed) {
          value.close()
          continue
        }
        shift = Math.max(shift, value.timestamp - performance.now() * 1000)
        if (startUs === null) {
          value.close() // разогрев: только подбираем сдвиг, пока не прошла пачка накопившихся кусков
          continue
        }
        const seconds = (value.timestamp - shift - startUs) / 1e6
        if (seconds < 0) {
          value.close() // снято до нажатия «Запись»
          continue
        }
        await take(value, seconds)
      }
    }
    pumps.push(run().catch(fail))
  }

  return {
    extension: 'mp4',
    mimeType: 'video/mp4',
    kind: 'software',
    start: async (write) => {
      const target = new mb.StreamTarget(
        new WritableStream({
          write(chunk) {
            // Blob копирует байты — mediabunny может переиспользовать свой буфер
            write(new Blob([chunk.data]), chunk.position)
          },
        }),
        // Куски по 2 МБ: меньше мелких записей на диск, а при сбое браузера теряется не больше пары секунд
        { chunked: true, chunkSize: 2 * 1024 * 1024 },
      )
      // Обычный MP4: оглавление кадров пишется в конец файла при остановке. Фрагментированный не годится:
      // оглавления в нём нет, плеер долго открывает файл и не перематывает
      output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false }), target })
      const videoSource = new mb.VideoSampleSource({
        codec: 'avc',
        ...videoOptions,
        keyFrameInterval: KEY_FRAME_INTERVAL_S,
        contentHint: 'detail',
        // Учитель поменял размер окна посреди урока — новый кадр вписываем в прежний размер
        ...(size.resize
          ? { transform: { width: size.width, height: size.height, fit: 'contain' as const }, sizeChangeBehavior: 'passThrough' as const }
          : { sizeChangeBehavior: 'contain' as const }),
      })
      const audioSource = new mb.AudioSampleSource({ codec: audioCodec, bitrate: AUDIO_BITS_PER_SECOND })
      output.addVideoTrack(videoSource)
      output.addAudioTrack(audioSource)
      await output.start()

      // Кадр — когда экран меняется, как у MediaRecorder. Кодировщик не успевает — лишний кадр пропускаем,
      // а не копим очередь: на уроке важнее не отстать, чем каждый кадр
      let busy = false
      let lastVideo = -1
      pump<VideoFrame>(video, (frame, seconds) => {
        if (busy || seconds <= lastVideo) {
          frame.close()
          return
        }
        lastVideo = seconds
        busy = true
        const sample = new mb.VideoSample(frame, { timestamp: seconds })
        pendingVideo = videoSource
          .add(sample)
          .catch(fail)
          .finally(() => {
            sample.close()
            busy = false
          })
      })

      // Звук идёт сплошным потоком: следующий кусок ставим ровно за предыдущим. Вперёд по часам прыгаем,
      // только если отстали больше чем на 0,2 с (браузер притормозил и звук пропал); назад — никогда
      let nextAudio: number | null = null
      pump<AudioData>(audio, async (data, seconds) => {
        const at = nextAudio !== null && seconds < nextAudio + 0.2 ? nextAudio : seconds
        nextAudio = at + data.numberOfFrames / data.sampleRate
        const sample = new mb.AudioSample(data)
        sample.setTimestamp(at)
        try {
          await audioSource.add(sample)
        } finally {
          sample.close()
        }
      })

      await new Promise((resolve) => setTimeout(resolve, WARM_UP_MS))
      startUs = performance.now() * 1000
    },
    stop: async () => {
      if (stopped) return
      stopped = true
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})))
      await Promise.all(pumps)
      await pendingVideo
      if (!output || output.state === 'finalized' || output.state === 'canceled') return
      try {
        await output.finalize()
      } catch (err) {
        // Хвост файла дописать не удалось — что уже записано, остаётся в файле
        console.warn('Не удалось дописать конец записи', err)
        await output.cancel().catch(() => {})
      }
    },
  }
}

// Первый формат, который умеет браузер. MP4 (H.264) — в первую очередь: webm из браузера без длительности,
// и «Медиаплеер» Windows показывает в нём застывшую картинку при живом звуке. Chrome/Edge пишут mp4
// с версии 126, Safari — всегда; Firefox умеет только webm.
const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

function mediaRecorder(video: MediaStreamTrack, audio: MediaStreamTrack, onFail: (err: unknown) => void): LessonRecorder {
  const supported = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  const options: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    // Chrome/Edge; другие браузеры незнакомое поле пропускают
    videoKeyFrameIntervalDuration: KEY_FRAME_INTERVAL_S * 1000,
  }
  if (supported) options.mimeType = supported
  const recorder = new MediaRecorder(new MediaStream([video, audio]), options)
  const mimeType = recorder.mimeType || supported || 'video/webm'
  recorder.onerror = (event) => onFail((event as Event & { error?: unknown }).error ?? new Error('ошибка MediaRecorder'))
  return {
    extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
    mimeType,
    kind: 'mediarecorder',
    start: async (write) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) write(event.data)
      }
      // Куски раз в секунду: в папку они уходят по ходу урока, а не одним файлом в конце
      recorder.start(1000)
    },
    stop: () =>
      new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') return resolve()
        // Последний кусок приходит до onstop
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      }),
  }
}
