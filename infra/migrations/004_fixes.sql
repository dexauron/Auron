-- ============================================================
-- 004_fixes.sql — критические исправления
-- Запустить в Supabase Studio → SQL Editor
-- ============================================================

-- 1. Исправление бесконечной рекурсии в политике org_members
-- Старая политика проверяла org_members → org_members (цикл).
-- Новая: пользователь видит только свои строки.
DROP POLICY IF EXISTS "org_members_policy" ON public.org_members;
CREATE POLICY "org_members_policy" ON public.org_members
  FOR ALL USING (user_id = auth.uid());

-- 2. Исправление функции increment_account_balance
-- Старая функция содержала SET updated_at = now(), но колонки updated_at
-- в таблице accounts нет — из-за этого каждая транзакция падала с ошибкой.
CREATE OR REPLACE FUNCTION public.increment_account_balance(
  p_account_id UUID,
  p_delta      BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.accounts
  SET    balance_kopecks = balance_kopecks + p_delta
  WHERE  id = p_account_id;
END;
$$;

-- 3. Выдача прав на все таблицы роли authenticated
-- В self-hosted Supabase при ручном запуске миграций GRANT не выдаётся
-- автоматически → "permission denied for table ...".
-- RLS-политики при этом остаются в силе и ограничивают доступ к строкам.
GRANT USAGE ON SCHEMA public TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.users           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparties  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debt_entries    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_settings    TO authenticated;

-- Права на последовательности (если есть SERIAL/BIGSERIAL колонки)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Функции
GRANT EXECUTE ON FUNCTION public.increment_account_balance(UUID, BIGINT) TO authenticated;
