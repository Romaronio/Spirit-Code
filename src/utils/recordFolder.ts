// Папка для записей уроков (File System Access API — есть только в Chrome и Edge).
// Ссылку на папку браузер разрешает хранить в IndexedDB, поэтому выбор запоминается между уроками.

// Этих методов пока нет в типах TypeScript
interface FolderHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FolderHandle>
}

const DB_NAME = 'spirit'
const STORE = 'settings'
const KEY = 'recordFolder'

export function canPickFolder() {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

// Сохранённая папка или null (не выбирали, браузер не умеет или хранилище недоступно)
export async function loadFolder(): Promise<FolderHandle | null> {
  if (!canPickFolder()) return null
  try {
    return ((await withStore('readonly', (store) => store.get(KEY))) as FolderHandle | undefined) ?? null
  } catch {
    return null
  }
}

// Окно выбора папки; null — учитель нажал «Отмена»
export async function pickFolder(): Promise<FolderHandle | null> {
  let folder: FolderHandle
  try {
    folder = await (window as PickerWindow).showDirectoryPicker!({ id: 'spirit-recordings', mode: 'readwrite', startIn: 'videos' })
  } catch {
    return null
  }
  try {
    await withStore('readwrite', (store) => store.put(folder, KEY))
  } catch {
    // не запомнили — в этот раз запись всё равно пойдёт в выбранную папку
  }
  return folder
}

// Разрешение писать в папку. Браузер спрашивает его заново после перезапуска,
// поэтому вызывать сразу по нажатию кнопки, пока действует жест пользователя.
export async function ensureWriteAccess(folder: FolderHandle) {
  try {
    if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export type { FolderHandle }
