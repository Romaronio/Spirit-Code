import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  CarouselLayout,
  ConnectionStateToast,
  DisconnectButton,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  isTrackReference,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useTracks,
  type TrackReference,
} from '@livekit/components-react'
import { DisconnectReason, Track } from 'livekit-client'
import '@livekit/components-styles'
import styles from './CallPage.module.css'
import * as api from '../../services/api'
import { callName } from '../../utils/calls'
import RecordButton from './RecordButton'
import type { CallJoin, User } from '../../types'

interface Props {
  user: User | null
}

// Адрес livekit-server: из настроек сервера или этот же сайт по пути /livekit
function serverUrl(join: CallJoin) {
  if (join.url) return join.url
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/livekit`
}

// Страница онлайн-урока: видео участников, микрофон, камера, показ экрана
function CallPage({ user }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [join, setJoin] = useState<CallJoin | null>(null)
  const [error, setError] = useState('')
  const [deviceError, setDeviceError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .joinCall(Number(id))
      .then((data) => {
        if (!cancelled) setJoin(data)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : ''
        // 404 — созвона нет в списке идущих: закончился или не для этого ученика
        setError(/not found|404/i.test(message) ? 'Урок уже закончился' : message || 'Не удалось подключиться')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (!join) {
    return (
      <div className={styles.message}>
        <p>{error || 'Подключаемся к уроку…'}</p>
        {error && (
          <Link to="/home" className={styles.homeLink}>
            На главную
          </Link>
        )}
      </div>
    )
  }

  const isTeacher = user.role === 'teacher'
  const callId = join.call.id

  async function handleEndForAll() {
    if (!window.confirm('Завершить урок для всех участников?')) return
    try {
      await api.endCall(callId)
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Не удалось завершить урок')
      return
    }
    navigate('/home')
  }

  return (
    <div className={styles.page}>
      <LiveKitRoom
        serverUrl={serverUrl(join)}
        token={join.token}
        connect
        audio
        video
        data-lk-theme="default"
        className={styles.room}
        onDisconnected={(reason) => {
          if (reason === DisconnectReason.ROOM_DELETED && !isTeacher) {
            window.alert('Учитель завершил урок')
          }
          navigate('/home')
        }}
        onError={(err) => setDeviceError(err.message)}
        onMediaDeviceFailure={() =>
          setDeviceError('Нет доступа к камере или микрофону — разрешите их в настройках браузера')
        }
      >
        <header className={styles.header}>
          <span className={styles.live} aria-hidden="true" />
          <h1 className={styles.title}>{callName(join.call)}</h1>
          {isTeacher && (
            <button type="button" className={styles.endAll} onClick={handleEndForAll}>
              Завершить для всех
            </button>
          )}
        </header>

        <LayoutContextProvider>
          <Stage />
        </LayoutContextProvider>

        {deviceError && <p className={styles.deviceError}>{deviceError}</p>}

        <div className={styles.controls}>
          <TrackToggle source={Track.Source.Microphone} className={styles.control}>
            Микрофон
          </TrackToggle>
          <TrackToggle source={Track.Source.Camera} className={styles.control}>
            Камера
          </TrackToggle>
          <TrackToggle
            source={Track.Source.ScreenShare}
            captureOptions={{ audio: true }}
            className={styles.control}
          >
            Показать экран
          </TrackToggle>
          {isTeacher && <RecordButton fileName={`Урок · ${callName(join.call)}`} onError={setDeviceError} />}
          <DisconnectButton className={styles.leave}>Выйти</DisconnectButton>
        </div>

        <RoomAudioRenderer />
        <StartAudio label="Включить звук" className={styles.startAudio} />
        <ConnectionStateToast />
      </LiveKitRoom>
    </div>
  )
}

// Видео: если кто-то показывает экран — экран крупно, камеры лентой сбоку; иначе сетка камер
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const screen = tracks
    .filter(isTrackReference)
    .find((t) => t.publication.source === Track.Source.ScreenShare)
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera)

  return (
    <div className={styles.stage}>
      {screen ? (
        <FocusLayoutContainer className={styles.fill}>
          <CarouselLayout tracks={cameras}>
            <ParticipantTile />
          </CarouselLayout>
          <ScreenView trackRef={screen} />
        </FocusLayoutContainer>
      ) : (
        <GridLayout tracks={cameras} className={styles.fill}>
          <ParticipantTile />
        </GridLayout>
      )}
    </div>
  )
}

// Демонстрация экрана с кнопкой «Во весь экран»: разворачивается только сам экран,
// без шапки, кнопок и камер. Выйти — Esc, кнопка «Свернуть» или двойной клик.
function ScreenView({ trackRef }: { trackRef: TrackReference }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    const update = () => setFull(!!boxRef.current && document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  function toggle() {
    const box = boxRef.current
    if (!box) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else if (box.requestFullscreen) {
      void box.requestFullscreen().catch(() => {})
    } else {
      // iPhone не умеет разворачивать блоки, только само видео
      const video = box.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      video?.webkitEnterFullscreen?.()
    }
  }

  return (
    <div ref={boxRef} className={`${styles.screenView} ${full ? styles.screenFull : ''}`} onDoubleClick={toggle}>
      <FocusLayout trackRef={trackRef} />
      <button type="button" className={`lk-button ${styles.fullButton}`} onClick={toggle}>
        {full ? 'Свернуть' : 'Во весь экран'}
      </button>
    </div>
  )
}

export default CallPage
