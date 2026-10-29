# Локальный сервер созвонов для разработки (ключи dev-режима: devkey / secret —
# их же по умолчанию берёт Django при DJANGO_DEBUG=1). Сайт ходит к нему через
# прокси Vite по пути /livekit. Бинарник: https://github.com/livekit/livekit/releases
param([string]$Exe = "$env:USERPROFILE\Desktop\claude\tools\livekit\livekit-server.exe")
& $Exe --dev --bind 127.0.0.1 --node-ip 127.0.0.1
