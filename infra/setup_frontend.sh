#!/bin/bash
# Auron Finance — настройка nginx для раздачи фронтенда
# Запускать на сервере: bash /root/setup_frontend.sh
set -e

APP_DIR="/var/www/auron"

echo "[1/3] Создаём папку для приложения..."
mkdir -p "$APP_DIR"

echo "[2/3] Скачиваем файлы приложения с GitHub..."
cd /tmp
rm -rf auron_tmp
git clone --depth 1 --branch claude/optimistic-einstein-Afzmv \
    https://github.com/dexauron/Auron.git auron_tmp
cp -r auron_tmp/app/* "$APP_DIR/"
rm -rf auron_tmp

echo "[3/3] Настраиваем nginx..."
cat > /etc/nginx/sites-available/auron << 'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/auron;
    index index.html;
    server_name _;

    # SPA — все пути отдаём index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Отключаем кэш для html и js чтобы обновления сразу применялись
    location ~* \.(html|js)$ {
        add_header Cache-Control "no-cache";
    }

    # Статика кэшируется
    location ~* \.(css|png|svg|ico|woff2)$ {
        expires 30d;
        add_header Cache-Control "public";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/auron /etc/nginx/sites-enabled/auron
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "201.51.6.170")
echo ""
echo "======================================"
echo " ГОТОВО!"
echo " Приложение доступно по адресу:"
echo " http://${SERVER_IP}/"
echo "======================================"
