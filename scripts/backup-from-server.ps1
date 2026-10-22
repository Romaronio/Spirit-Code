# Скачивает бэкап Spirit Code с сервера в папку backups\ этого проекта.
#
# Что делает:
#   1. по SSH просит сервер сделать архив (база + media), на сервере хранится 5 последних;
#   2. скачивает архив в <проект>\backups\ и проверяет, что он открывается;
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
    [string]$Server = 'ПОЛЬЗОВАТЕЛЬ@138.16.172.241',
    # Папка проекта на сервере (где лежит docker-compose.yml)
    [string]$RemoteProject = '/ПУТЬ/К/ПРОЕКТУ',
    # Сколько архивов хранить на этом компьютере
    [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectRoot 'backups'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$LogFile = Join-Path $BackupDir 'backup.log'

function Write-Log([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

try {
    if ($Server -like 'ПОЛЬЗОВАТЕЛЬ@*' -or $RemoteProject -like '/ПУТЬ/*') {
        throw 'не настроено: укажите $Server и $RemoteProject в начале скрипта'
    }

    # BatchMode — не ждать ввода пароля: в Планировщике его некому вводить
    $sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')

    # 1. Архив на сервере
    $output = & ssh @sshOptions $Server "cd '$RemoteProject' && docker compose exec -T backend python manage.py backup --keep 5"
    if ($LASTEXITCODE -ne 0) { throw "сервер не создал архив (ssh вернул код $LASTEXITCODE)" }
    $name = ([string]($output | Select-Object -Last 1)).Trim()
    if ($name -notmatch '^spirit-code-[\d_-]+\.zip$') { throw "неожиданный ответ сервера: '$name'" }

    # 2. Скачиваем. На сервере папка контейнера /data — это <проект>/data/db
    $localFile = Join-Path $BackupDir $name
    & scp @sshOptions -q "${Server}:$RemoteProject/data/db/backups/$name" $localFile
    if ($LASTEXITCODE -ne 0) { throw "не удалось скачать $name (scp вернул код $LASTEXITCODE)" }

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
