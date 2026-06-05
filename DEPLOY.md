# Деплой Auron Finance на российский VPS

## 1. Выбери хостинг

**Рекомендую TimeWeb** — от 249₽/месяц:
- https://timeweb.cloud → VPS → Ubuntu 22.04 → 1 vCPU / 1 GB RAM / 15 GB SSD

Регистрируйся, создай VPS, получи IP-адрес и root-пароль.

## 2. Подключись к серверу

```bash
ssh root@ВАШ_IP_АДРЕС
```

## 3. Установи Node.js и PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2
```

## 4. Клонируй репозиторий

```bash
cd /opt
git clone https://github.com/dexauron/Auron.git auron
cd auron/server
```

## 5. Установи зависимости и настрой окружение

```bash
npm install

# Создай файл .env
cp .env.example .env
nano .env
```

В `.env` замени значения:
```
PORT=3000
JWT_SECRET=впиши_длинную_случайную_строку_здесь
DB_PATH=/opt/auron/server/auron.db
```

## 6. Запусти через PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # следуй инструкции чтобы автозапуск при перезагрузке
```

Проверь что работает:
```bash
curl http://localhost:3000/api/init
```

## 7. Настрой Nginx (обратный прокси + HTTPS)

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

Создай конфиг `/etc/nginx/sites-available/auron`:
```nginx
server {
    listen 80;
    server_name ВАШ_ДОМЕН.ru;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/auron /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 8. Получи SSL-сертификат (HTTPS, бесплатно)

```bash
certbot --nginx -d ВАШ_ДОМЕН.ru
```

## 9. Добавь домен в Google Cloud Console

Открой https://console.cloud.google.com → APIs & Services → Credentials → твой OAuth 2.0 Client ID

В разделе **Authorized JavaScript origins** добавь:
```
https://ВАШ_ДОМЕН.ru
```

Сохрани.

## 10. Проверь

Открой `https://ВАШ_ДОМЕН.ru` — должна открыться страница Auron Finance.
Нажми «Войти через Google» — теперь Google просто спрашивает разрешение
на email и имя (без страшных предупреждений про Drive/Sheets).

---

## Если нет домена

Можно использовать IP напрямую, но Google OAuth требует домен или localhost.
Самый дешёвый домен: reg.ru → от ~100₽/год за .ru или .рф.

## Обновление приложения

```bash
cd /opt/auron
git pull origin main
pm2 restart auron
```
