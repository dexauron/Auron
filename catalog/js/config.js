// Подключение к базе данных каталога (отдельный проект Supabase, НЕ база Auron).
// Ключ ниже — публичный (anon): он рассчитан на открытые страницы, база защищена правами доступа.
window.CATALOG_CONFIG = {
  SUPABASE_URL: 'https://jjiehcetmdxhsidspeez.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqaWVoY2V0bWR4aHNpZHNwZWV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Nzc4NDIsImV4cCI6MjA5OTI1Mzg0Mn0.QnMqpgvxi9ng7Lgkbe9JFG9cHtJgjv21C32r1saBB74',
  // Служебный email аккаунта кассиров/зала: сотрудник вводит только пароль.
  STAFF_EMAIL: 'staff@waymarket.ru',
  // Служебные аккаунты со своим паролем (кассир и аналитик/зал). При входе
  // программа подбирает подходящий аккаунт по введённому паролю. Роль каждого
  // аккаунта задаётся в базе (setup/ОБНОВЛЕНИЕ-7.sql, таблица catalog_roles).
  // Главный админ входит по своему email. Аккаунты создаёт владелец в
  // Supabase: Authentication → Users.
  SERVICE_EMAILS: ['manager@waymarket.ru', 'staff@waymarket.ru'],
};
