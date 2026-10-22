# Скачивает бэкап Spirit Code с сервера в папку backups\ этого проекта.
#
# Что делает:
#   1. по SSH просит сервер сделать архив (база + media); на сервере хранится только
#      последний — места там мало, а media весит сотни мегабайт;
#   2. скачивает архив в <проект>\backups\, проверяет, что он открывается,
#      и удаляет его с сервера (там мало места, копия теперь здесь);
#   3. оставляет здесь последние $Keep архивов, старые удаляет.
# Результат каждого запуска пишется в backups\backup.log.
#
# Запуск вручную:   powershell -ExecutionPolicy Bypass -File scripts\backup-from-server.ps1
# Каждый день:      scripts\register-backup-task.ps1 (один раз)
#
# Восстановление из архива: распакуйте его; db.sqlite3 положите на сервер в
# <проект>/data/db/, папку media — в <проект>/data/media/, затем
# docker compose restart backend.

param(
    # Пользователь и адрес сервера (вход должен работать по SSH-ключу, без пароля)
    [string]$Server = 'root@138.16.172.241',
    # Папка проекта на сервере (где лежит docker-compose.yml)
    [string]$RemoteProject = '/opt/spirit',
    # Сколько архивов хранить на этом компьютере
    [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectRoot 'backups'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$LogFile = Join-Path $BackupDir 'backup.log'

# Связь с сервером иногда обрывается по таймауту — пробуем несколько раз
function Invoke-WithRetry([scriptblock]$Action, [string]$What) {
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        $result = & $Action
        if ($LASTEXITCODE -eq 0) { return $result }
        if ($attempt -lt 4) { Start-Sleep -Seconds 30 }
    }
    throw "$What (после 4 попыток, последний код $LASTEXITCODE)"
}

function Write-Log([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

try {
    # BatchMode — не ждать ввода пароля: в Планировщике его некому вводить
    $sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')

    # 1. Архив на сервере
    $remoteCommand = "cd '$RemoteProject' && docker compose exec -T backend python manage.py backup --keep 1"
    $output = Invoke-WithRetry { & ssh @sshOptions $Server $remoteCommand } 'сервер не создал архив'
    $name = ([string]($output | Select-Object -Last 1)).Trim()
    if ($name -notmatch '^spirit-code-[\d_-]+\.zip$') { throw "неожиданный ответ сервера: '$name'" }

    # 2. Скачиваем. На сервере папка контейнера /data — это <проект>/data/db
    $localFile = Join-Path $BackupDir $name
    $remoteFile = "${Server}:$RemoteProject/data/db/backups/$name"
    Invoke-WithRetry { & scp @sshOptions -q $remoteFile $localFile } "не удалось скачать $name" | Out-Null

    # Проверяем, что архив целый и в нём есть база
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($localFile)
    try {
        $hasDb = @($zip.Entries | Where-Object { $_.FullName -eq 'db.sqlite3' }).Count -eq 1
        $files = $zip.Entries.Count
    } finally {
        $zip.Dispose()
    }
    if (-not $hasDb) { throw "в архиве $name нет db.sqlite3" }

    # Архив скачан и проверен — на сервере он больше не нужен.
    # Не получилось удалить — не страшно: бэкап засчитан, а при следующем
    # запуске сервер сам оставит только последний архив
    $cleanup = "rm -f '$RemoteProject/data/db/backups/$name'"
    try {
        Invoke-WithRetry { & ssh @sshOptions $Server $cleanup } 'не удалось удалить архив на сервере' | Out-Null
    } catch {
        Write-Log "ВНИМАНИЕ $($_.Exception.Message)"
    }

    # 3. Оставляем последние $Keep архивов
    Get-ChildItem -Path $BackupDir -Filter 'spirit-code-*.zip' |
        Sort-Object Name -Descending |
        Select-Object -Skip $Keep |
        Remove-Item

    $sizeMb = [math]::Round((Get-Item $localFile).Length / 1MB, 1)
    Write-Log "OK      $name  ($sizeMb МБ, файлов в архиве: $files)"
}
catch {
    Write-Log "ОШИБКА  $($_.Exception.Message)"
    exit 1
}
