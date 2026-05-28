#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
#  Финансовый контроль — автодеплой через clasp
#  Запуск: bash deploy.sh
# ────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[..] $*${NC}"; }
error() { echo -e "${RED}[ERR] $*${NC}"; exit 1; }

# 1. Check clasp
command -v clasp &>/dev/null || error "clasp not installed: npm install -g @google/clasp"

# 2. Login if needed
if [ ! -f "$HOME/.clasprc.json" ]; then
  warn "Требуется авторизация Google. Открывается браузер..."
  clasp login --no-localhost
fi

# 3. Create or reuse project
if [ ! -f ".clasp.json" ]; then
  warn "Создание нового Google Apps Script проекта..."
  clasp create --title "Финансовый контроль" --type webapp --rootDir .
  info "Проект создан"
else
  info "Используем существующий проект: $(cat .clasp.json)"
fi

# 4. Push files
warn "Отправка файлов..."
clasp push --force
info "Файлы отправлены"

# 5. Deploy as web app
warn "Развёртывание веб-приложения..."
DEPLOY_URL=$(clasp deploy --description "prod" 2>&1 | grep -o 'https://[^ ]*' | head -1 || true)

if [ -z "$DEPLOY_URL" ]; then
  # get existing deployment URL
  SCRIPT_ID=$(cat .clasp.json | grep -o '"scriptId":"[^"]*"' | cut -d'"' -f4)
  DEPLOY_URL="https://script.google.com/macros/s/${SCRIPT_ID}/exec"
  warn "URL развёртывания (может быть неточным): $DEPLOY_URL"
else
  info "Развёрнуто: $DEPLOY_URL"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN} Готово! Откройте ссылку в Safari на iPhone:${NC}"
echo -e "${GREEN} $DEPLOY_URL${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Для установки на экран Домой:"
echo "  Safari → Поделиться → На экран «Домой»"
