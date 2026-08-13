#!/usr/bin/env bash
# Auron backend — включить бесплатный HTTPS (Caddy + sslip.io).
# Тот же проверенный приём, что уже работает в каталоге Way Market.
#
# Запускать НА СЕРВЕРЕ Auron (где крутится Supabase на порту 8000), от root:
#   curl -sL <адрес-этого-файла> | bash      — или скопировать и запустить.
#
# Что делает (безопасно, не трогает вашу базу и контейнеры):
#   1. Ставит Caddy — он сам берёт бесплатный сертификат Let's Encrypt.
#   2. Caddy принимает HTTPS на домене <IP-с-дефисами>.sslip.io и проксирует
#      запросы на локальный Supabase (localhost:8000).
#   3. Открывает порты 80 и 443 (нужны для сертификата и доступа).
set -e

IP="$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${IP//./-}.sslip.io"
echo "▶ Сервер $IP → HTTPS-адрес будет: https://$DOMAIN"

# 1. Caddy (бесплатный HTTPS, авто-сертификат)
if ! command -v caddy >/dev/null; then
  echo "▶ Ставлю Caddy…"
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

# 2. Caddy: HTTPS-фасад → локальный Supabase на 8000
printf '%s {\n    reverse_proxy localhost:8000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
systemctl restart caddy

# 3. Открыть порты (если есть ufw)
if command -v ufw >/dev/null; then ufw allow 80/tcp || true; ufw allow 443/tcp || true; fi

echo
echo "✅ Готово. Проверьте в браузере:  https://$DOMAIN"
echo "   Открывается → сообщите ассистенту адрес https://$DOMAIN —"
echo "   он поменяет адрес в приложении (app/js/config.js) и задеплоит."
echo
echo "⚠ Рекомендация (для корректных ссылок в письмах/редиректах авторизации):"
echo "   в .env вашего Supabase (папка docker) задайте"
echo "     API_EXTERNAL_URL=https://$DOMAIN"
echo "     SUPABASE_PUBLIC_URL=https://$DOMAIN"
echo "   и выполните:  docker compose up -d"
