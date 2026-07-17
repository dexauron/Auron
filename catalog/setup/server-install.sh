#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Way Market · Каталог — установка своей базы (Supabase) на сервер Timeweb.
# Запускать от root на ЧИСТОМ Ubuntu 22.04/24.04:
#   bash <(curl -sL <RAW-URL этого файла>)
# Ставит Docker, Supabase (Postgres+Auth+PostgREST+Storage), Caddy (бесплатный
# HTTPS), и печатает адрес базы + ключи + вход в Studio.
# HTTPS-домен = <IP-с-дефисами>.sslip.io (бесплатно, без регистрации).
# Схему каталога потом применишь в Studio → SQL Editor (пришлю файл).
# ─────────────────────────────────────────────────────────────
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

IP="$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DOMAIN="${IP//./-}.sslip.io"
DIR=/opt/waymarket-supabase
echo "▶ Сервер $IP → адрес базы будет https://$DOMAIN"

echo "▶ [1/6] Пакеты и Docker…"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git python3 openssl gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
# зеркала Docker Hub (в РФ прямой Hub часто отдаёт 429) — docker сам откатится на Hub, если зеркало недоступно
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DJ'
{ "registry-mirrors": ["https://dockerhub.timeweb.cloud", "https://huecker.io", "https://mirror.gcr.io"] }
DJ
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker || true
sleep 3

echo "▶ [2/6] Caddy (для HTTPS)…"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "▶ [3/6] Загружаем Supabase…"
mkdir -p "$DIR" && cd "$DIR"
[ -d supabase ] || git clone --depth 1 https://github.com/supabase/supabase >/dev/null 2>&1
cd supabase/docker
cp -n .env.example .env

echo "▶ [4/6] Секреты и ключи…"
# при повторном запуске переиспользуем уже созданные ключи (стабильный адрес/ключи)
CUR_JWT="$(grep -E '^JWT_SECRET=' .env | cut -d= -f2- || true)"
if [ -f /root/waymarket-keys.txt ] && [[ "$CUR_JWT" != your-super-secret* ]] && [ -n "$CUR_JWT" ]; then
  echo "  переиспользую существующие ключи из .env"
  JWT_SECRET="$CUR_JWT"
  ANON_KEY="$(grep -E '^ANON_KEY=' .env | cut -d= -f2-)"
  SERVICE_KEY="$(grep -E '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)"
  PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
  DASH_PASS="$(grep -E '^DASHBOARD_PASSWORD=' .env | cut -d= -f2-)"
else
JWT_SECRET="$(openssl rand -hex 40)"
PG_PASS="$(openssl rand -hex 16)"
DASH_PASS="$(openssl rand -hex 10)"
KEYS="$(python3 - "$JWT_SECRET" <<'PY'
import sys,hmac,hashlib,base64,json,time
secret=sys.argv[1].encode()
b64=lambda b: base64.urlsafe_b64encode(b).rstrip(b'=')
def jwt(role):
    h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    iat=int(time.time()); exp=iat+10*365*24*3600
    p=b64(json.dumps({"role":role,"iss":"supabase","iat":iat,"exp":exp},separators=(',',':')).encode())
    s=b64(hmac.new(secret,h+b"."+p,hashlib.sha256).digest())
    return (h+b"."+p+b"."+s).decode()
print(jwt("anon")); print(jwt("service_role"))
PY
)"
ANON_KEY="$(echo "$KEYS" | sed -n 1p)"
SERVICE_KEY="$(echo "$KEYS" | sed -n 2p)"
fi
setenv(){ grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
setenv POSTGRES_PASSWORD "$PG_PASS"
setenv JWT_SECRET "$JWT_SECRET"
setenv ANON_KEY "$ANON_KEY"
setenv SERVICE_ROLE_KEY "$SERVICE_KEY"
setenv DASHBOARD_USERNAME "admin"
setenv DASHBOARD_PASSWORD "$DASH_PASS"
setenv SITE_URL "https://dexauron.github.io"
setenv API_EXTERNAL_URL "https://$DOMAIN"
setenv SUPABASE_PUBLIC_URL "https://$DOMAIN"
setenv ADDITIONAL_REDIRECT_URLS "https://dexauron.github.io/Auron/catalog/"
setenv ENABLE_EMAIL_AUTOCONFIRM "true"

echo "▶ [5/6] Запускаем Supabase (пара минут)…"
# качаем образы с повторами (Docker Hub может отдавать 429)
pulled=0
for try in 1 2 3 4 5 6; do
  if docker compose pull; then pulled=1; break; fi
  echo "  попытка $try не удалась (Docker Hub лимит?) — ждём и пробуем ещё…"
  sleep $((try*15))
done
[ "$pulled" = 1 ] || echo "⚠ Не все образы скачались — docker compose up всё равно попробует докачать."
docker compose up -d
for i in $(seq 1 80); do docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 3; done

echo "▶ [6/6] Включаем HTTPS…"
printf '%s {\n    reverse_proxy localhost:8000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
systemctl restart caddy || true
sleep 5

cat > /root/waymarket-keys.txt <<EOF
URL=https://$DOMAIN
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_KEY
STUDIO=https://$DOMAIN  логин: admin  пароль: $DASH_PASS
POSTGRES_PASSWORD=$PG_PASS
EOF

cat <<EOF

═══════════════════════════════════════════════════════════════
✅ ГОТОВО. Пришли мне в чат ДВЕ строки:

  АДРЕС : https://$DOMAIN
  ANON  : $ANON_KEY

Вход в Studio (панель базы): https://$DOMAIN
  логин: admin   пароль: $DASH_PASS
(всё сохранено в файле /root/waymarket-keys.txt)
═══════════════════════════════════════════════════════════════
EOF
