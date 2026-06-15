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
