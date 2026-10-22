# Один раз регистрирует в Планировщике Windows ежедневный бэкап Spirit Code.
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
#
# Если в это время компьютер выключен — бэкап сделается при следующем включении.
# Удалить задачу: Unregister-ScheduledTask -TaskName 'Spirit Code backup'

param(
    [string]$At = '21:00'
)

$script = Join-Path $PSScriptRoot 'backup-from-server.ps1'

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
    -TaskName 'Spirit Code backup' `
    -Description 'Ежедневно скачивает бэкап базы и файлов Spirit Code с сервера в папку backups проекта' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Готово: бэкап будет делаться каждый день в $At (задача 'Spirit Code backup')"
