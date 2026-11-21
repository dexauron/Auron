#!/bin/bash
# Auron Finance — установка backend на сервере Timeweb Cloud
# Запускать: bash setup.sh
set -e

echo "======================================"
echo " Auron Finance — Setup Backend"
echo "======================================"

# --- 1. Обновление системы ---
echo "[1/7] Обновление системы..."
apt-get update -qq
apt-get install -y -qq curl git wget unzip openssl nginx certbot python3-certbot-nginx ufw

# --- 2. Docker ---
echo "[2/7] Установка Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker
# Docker Compose Plugin
apt-get install -y -qq docker-compose-plugin
echo "Docker: $(docker --version)"

# --- 3. Генерация секретов ---
echo "[3/7] Генерация секретов..."
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYyMTQxOTIwMCwiZXhwIjo0Nzc0OTkxMjAwfQ.$(echo -n "{\"role\":\"anon\"}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 | tr -d '\n=')"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjIxNDE5MjAwLCJleHAiOjQ3NzQ5OTEyMDB9.$(echo -n "{\"role\":\"service_role\"}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 | tr -d '\n=')"
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '\n/+=')
DASHBOARD_PASSWORD=$(openssl rand -base64 16 | tr -d '\n/+=')
SMTP_PASSWORD=$(openssl rand -base64 16 | tr -d '\n/+=')

# --- 4. Скачать Supabase ---
echo "[4/7] Скачивание Supabase..."
cd /opt
if [ -d "supabase" ]; then
    rm -rf supabase
fi
git clone --depth 1 https://github.com/supabase/supabase.git
cd /opt/supabase/docker

# Копируем .env
cp .env.example .env

# --- 5. Настройка .env ---
echo "[5/7] Настройка конфигурации..."
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")

# Записываем реальные секреты
sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
sed -i "s|ANON_KEY=.*|ANON_KEY=${ANON_KEY}|" .env
sed -i "s|SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|" .env
sed -i "s|SITE_URL=.*|SITE_URL=http://${SERVER_IP}|" .env
sed -i "s|API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://${SERVER_IP}:8000|" .env
sed -i "s|SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://${SERVER_IP}:8000|" .env
sed -i "s|DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}|" .env

# Отключаем email подтверждение для старта
sed -i "s|ENABLE_EMAIL_AUTOCONFIRM=.*|ENABLE_EMAIL_AUTOCONFIRM=true|" .env 2>/dev/null || true

# --- 6. Запуск Supabase ---
echo "[6/7] Запуск Supabase (3–5 минут)..."
docker compose pull
docker compose up -d

# Ждём пока поднимется
echo "Ожидание запуска сервисов..."
sleep 30

# Проверяем статус
docker compose ps

# --- 7. Настройка firewall ---
echo "[7/7] Настройка firewall..."
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 8000/tcp  # Supabase API
ufw allow 3000/tcp  # Supabase Studio (панель)
ufw status

# --- Итог ---
echo ""
echo "======================================"
echo " ГОТОВО! Сохрани эти данные:"
echo "======================================"
echo ""
echo "  Supabase Studio (панель управления БД):"
echo "  http://${SERVER_IP}:3000"
echo "  Логин: supabase"
echo "  Пароль: ${DASHBOARD_PASSWORD}"
echo ""
echo "  Supabase API URL:"
echo "  http://${SERVER_IP}:8000"
echo ""
echo "  ANON KEY (для фронтенда):"
echo "  ${ANON_KEY}"
echo ""
echo "  SERVICE ROLE KEY (только для бэкенда!):"
echo "  ${SERVICE_ROLE_KEY}"
echo ""
echo "  PostgreSQL пароль:"
echo "  ${POSTGRES_PASSWORD}"
echo ""
echo "  JWT Secret:"
echo "  ${JWT_SECRET}"
echo ""
echo "  ⚠️  СКОПИРУЙ ЭТИ ДАННЫЕ — они показываются один раз!"
echo "======================================"

# Сохраняем в файл на сервере
cat > /root/auron-credentials.txt << EOF
Auron Finance — Backend Credentials
Создано: $(date)

Supabase Studio: http://${SERVER_IP}:3000
  Логин: supabase
  Пароль: ${DASHBOARD_PASSWORD}

API URL: http://${SERVER_IP}:8000
ANON KEY: ${ANON_KEY}
SERVICE ROLE KEY: ${SERVICE_ROLE_KEY}
POSTGRES PASSWORD: ${POSTGRES_PASSWORD}
JWT SECRET: ${JWT_SECRET}
EOF

chmod 600 /root/auron-credentials.txt
echo "Данные также сохранены в /root/auron-credentials.txt"
