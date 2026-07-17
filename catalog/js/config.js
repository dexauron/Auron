// Подключение к базе данных каталога (отдельный проект Supabase, НЕ база Auron).
// Ключ ниже — публичный (anon): он рассчитан на открытые страницы, база защищена правами доступа.
window.CATALOG_CONFIG = {
  // СВОЙ сервер Timeweb (СПб) — работает без VPN
  SUPABASE_URL: 'https://104-171-136-141.sslip.io',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0MjcxNjQ3LCJleHAiOjIwOTk2MzE2NDd9.8yt1JZPknWVyZNQ4yJ3-5eA3wWOwkbgPtOCcP7L3mZs',
  // Служебный email аккаунта кассиров/зала: сотрудник вводит только пароль.
  STAFF_EMAIL: 'staff@waymarket.ru',
  // Служебные аккаунты со своим паролем (кассир и аналитик/зал). При входе
  // программа подбирает подходящий аккаунт по введённому паролю. Роль каждого
  // аккаунта задаётся в базе (setup/ОБНОВЛЕНИЕ-7.sql, таблица catalog_roles).
  // Главный админ входит по своему email. Аккаунты создаёт владелец в
  // Supabase: Authentication → Users.
  SERVICE_EMAILS: ['manager@waymarket.ru', 'staff@waymarket.ru'],
};
