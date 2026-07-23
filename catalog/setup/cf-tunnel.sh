#!/usr/bin/env bash
# Way Market · Каталог — поднять Cloudflare-туннель для Supabase через прокси v2rayA.
# Домашний сервер за блокирующим провайдером: cloudflared ходит наружу через
# локальный HTTP-прокси v2rayA (обход блокировок LE/Cloudflare).
# Предпосылка: уже выполнен `cloudflared tunnel login` (есть ~/.cloudflared/cert.pem).
# Запуск (от пользователя, НЕ через sudo — sudo вызывается внутри):
#   curl -sL <raw-url этого файла> | bash
set -e

PROXY="http://127.0.0.1:20171"     # HTTP-прокси v2rayA (проверено: обходит блок)
HOST="api.auronfinance.ru"         # поддомен для базы (фронтенд — на GitHub Pages)
export HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY"

echo "▶ Создаю туннель waymarket…"
cloudflared tunnel create waymarket 2>/dev/null || true
TID=$(cloudflared tunnel list | grep -w waymarket | awk '{print $1}' | head -1)
echo "TUNNEL_ID=$TID"
[ -n "$TID" ] || { echo "❌ Не удалось получить ID туннеля (нет cert.pem? прокси выключен?)"; exit 1; }

echo "▶ Привязываю $HOST к туннелю…"
cloudflared tunnel route dns waymarket "$HOST" || true

echo "▶ Пишу конфиг и службу (с прокси)…"
sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/$TID.json" /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: $TID
credentials-file: /etc/cloudflared/$TID.json
protocol: http2
ingress:
  - hostname: $HOST
    service: http://localhost:8000
  - service: http_status:404
EOF

CF=$(command -v cloudflared)
sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<EOF
[Unit]
Description=cloudflared tunnel (Way Market)
After=network.target

[Service]
Environment=HTTPS_PROXY=$PROXY
Environment=HTTP_PROXY=$PROXY
ExecStart=$CF --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

echo "▶ Запускаю службу…"
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sleep 8

echo
echo "STATUS: $(sudo systemctl is-active cloudflared)"
echo "--- последние строки лога cloudflared ---"
sudo journalctl -u cloudflared --no-pager | tail -15
