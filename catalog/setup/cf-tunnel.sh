#!/usr/bin/env bash
# Way Market · Каталог — поднять Cloudflare-туннель для Supabase.
# Домашний сервер за блокирующим провайдером. api.cloudflare.com доступен
# напрямую, поэтому туннель создаём БЕЗ прокси; сам туннель сначала пробуем
# поднять напрямую, и только если край Cloudflare недоступен — включаем прокси
# v2rayA автоматически.
# Предпосылка: уже выполнен `cloudflared tunnel login` (~/.cloudflared/cert.pem).
# Запуск (от пользователя, НЕ sudo — sudo внутри):
#   curl -sL <raw-url> | bash
set -e

PROXY="http://127.0.0.1:20171"     # HTTP-прокси v2rayA (на случай, если край заблокирован)
HOST="api.auronfinance.ru"         # поддомен для базы
CF="$(command -v cloudflared)"

echo "▶ Создаю туннель waymarket (напрямую)…"
cloudflared tunnel create waymarket 2>/dev/null || true
TID="$(cloudflared tunnel list 2>/dev/null | grep -w waymarket | awk '{print $1}' | head -1)"
echo "TUNNEL_ID=$TID"
[ -n "$TID" ] || { echo "❌ Нет ID туннеля (нет cert.pem или Cloudflare недоступен)."; exit 1; }

echo "▶ Привязываю $HOST к туннелю…"
cloudflared tunnel route dns waymarket "$HOST" 2>/dev/null || true

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

write_service() {   # $1 = "proxy" чтобы добавить прокси-окружение
  local envlines=""
  [ "$1" = "proxy" ] && envlines=$'Environment=HTTPS_PROXY='"$PROXY"$'\nEnvironment=HTTP_PROXY='"$PROXY"
  sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<EOF
[Unit]
Description=cloudflared tunnel (Way Market)
After=network.target

[Service]
$envlines
ExecStart=$CF --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable cloudflared >/dev/null 2>&1 || true
  sudo systemctl restart cloudflared
}

connected() { sudo journalctl -u cloudflared --no-pager 2>/dev/null | tail -25 | grep -q "Registered tunnel connection"; }

echo "▶ Поднимаю туннель БЕЗ прокси (напрямую)…"
write_service direct
sleep 12
if connected; then
  echo "✅ Туннель подключился НАПРЯМУЮ (прокси не нужен)."
else
  echo "… напрямую край Cloudflare недоступен — включаю прокси v2rayA…"
  write_service proxy
  sleep 12
  connected && echo "✅ Туннель подключился ЧЕРЕЗ ПРОКСИ." || echo "⚠ Пока не подключился — смотри лог ниже (пришли его Клоду)."
fi

echo
echo "STATUS: $(sudo systemctl is-active cloudflared)"
echo "--- лог cloudflared ---"
sudo journalctl -u cloudflared --no-pager | tail -18
