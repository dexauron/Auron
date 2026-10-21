-- Auron Finance — дополнительные RPC функции
-- Запускать после 001_initial_schema.sql

BEGIN;

-- ── get_org_balance_summary ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_org_balance_summary(
  p_org_id UUID,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE(
  total_income  BIGINT,
  total_expense BIGINT,
  profit        BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_kopecks ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_kopecks ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_kopecks ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_kopecks ELSE 0 END), 0)
  FROM public.transactions
  WHERE org_id     = p_org_id
    AND date      >= p_from
    AND date      <= p_to
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_balance_summary(UUID, DATE, DATE) TO authenticated;

COMMIT;
