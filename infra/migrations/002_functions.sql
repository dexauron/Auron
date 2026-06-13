-- Auron Finance — вспомогательные функции и RPC
-- Запускать после 001_initial_schema.sql

BEGIN;

-- ── increment_account_balance ──────────────────────────────────────────────
-- Атомарное обновление баланса счёта (вызывается из api.js через RPC).
-- p_delta: положительное = зачисление, отрицательное = списание (в копейках).
CREATE OR REPLACE FUNCTION public.increment_account_balance(
  p_account_id UUID,
  p_delta      BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.accounts
  SET    balance_kopecks = balance_kopecks + p_delta,
         updated_at      = now()
  WHERE  id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found', p_account_id;
  END IF;
END;
$$;

-- Разрешаем вызов аутентифицированным пользователям
GRANT EXECUTE ON FUNCTION public.increment_account_balance(UUID, BIGINT)
  TO authenticated;

-- ── get_org_balance_summary ────────────────────────────────────────────────
-- Суммарные балансы по организации за период.
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
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_kopecks ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_kopecks ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_kopecks ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_kopecks ELSE 0 END), 0) AS profit
  FROM public.transactions
  WHERE org_id    = p_org_id
    AND date     >= p_from
    AND date     <= p_to
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_balance_summary(UUID, DATE, DATE)
  TO authenticated;

-- ── Receipts storage bucket ────────────────────────────────────────────────
-- Создаём бакет для чеков (если не существует).
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Политика: загрузка только своих файлов (путь начинается с org_id пользователя)
DROP POLICY IF EXISTS "receipts_upload" ON storage.objects;
CREATE POLICY "receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_read" ON storage.objects;
CREATE POLICY "receipts_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'receipts');

-- ── org_settings table (key-value per org) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_settings (
  org_id     UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_settings_member" ON public.org_settings
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE  user_id = auth.uid() AND deleted_at IS NULL
    )
  );

-- ── counterparties table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.counterparties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'supplier',   -- 'supplier' | 'rep'
  phone      TEXT,
  note       TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "counterparties_member" ON public.counterparties
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE  user_id = auth.uid() AND deleted_at IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_counterparties_org ON public.counterparties(org_id);

-- ── debt_entries table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.debt_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id   UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,   -- 'debt' | 'payment' | 'initial'
  amount_kopecks    BIGINT NOT NULL CHECK (amount_kopecks > 0),
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id        UUID REFERENCES public.accounts(id),
  comment           TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'cancelled'
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.debt_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "debt_entries_member" ON public.debt_entries
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE  user_id = auth.uid() AND deleted_at IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_debt_entries_org             ON public.debt_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_debt_entries_counterparty    ON public.debt_entries(counterparty_id);

COMMIT;
