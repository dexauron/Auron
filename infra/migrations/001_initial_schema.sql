-- =====================================================
-- Auron Finance — Initial Schema v2
-- Колонки точно совпадают с api.js
-- Run in Supabase Studio → SQL Editor
-- =====================================================
BEGIN;

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users (public profile, зеркало auth.users) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      TEXT UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Автоматически создаём профиль при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, phone)
  VALUES (NEW.id, NEW.phone)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Organizations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'retail',
  logo_url   TEXT,
  settings   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Org members ───────────────────────────────────────────────────────────────
-- role: 'owner' | 'admin' | 'accountant' | 'cashier'
CREATE TABLE IF NOT EXISTS public.org_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'cashier',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- ── Accounts (счета) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT '💰',
  color           TEXT NOT NULL DEFAULT '#5E5CE6',
  balance_kopecks BIGINT NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Categories ────────────────────────────────────────────────────────────────
-- type: 'income' | 'expense' | 'both'
CREATE TABLE IF NOT EXISTS public.categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'both',
  icon       TEXT NOT NULL DEFAULT '📋',
  color      TEXT NOT NULL DEFAULT '#64748B',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Employees (сотрудники) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  short_name TEXT,
  role       TEXT NOT NULL DEFAULT 'cashier',
  phone      TEXT,
  salary     BIGINT,          -- в копейках
  status     TEXT NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Shifts (Z-отчёты, смены) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shifts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_num        SMALLINT NOT NULL DEFAULT 1,
  employee_id      UUID REFERENCES public.employees(id),
  z_cash_kopecks   BIGINT NOT NULL DEFAULT 0,
  z_card_kopecks   BIGINT NOT NULL DEFAULT 0,
  z_sbp_kopecks    BIGINT NOT NULL DEFAULT 0,
  z_total_kopecks  BIGINT NOT NULL DEFAULT 0,
  fact_cash_kopecks  BIGINT NOT NULL DEFAULT 0,
  fact_card_kopecks  BIGINT NOT NULL DEFAULT 0,
  fact_sbp_kopecks   BIGINT NOT NULL DEFAULT 0,
  diff_kopecks     BIGINT NOT NULL DEFAULT 0,
  withdrawals_json JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'closed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Transactions (операции) ───────────────────────────────────────────────────
-- type: 'income' | 'expense'
-- Переводы = две строки: расход из одного счёта + доход в другой
CREATE TABLE IF NOT EXISTS public.transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_uuid    UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  type           TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  category_id    UUID REFERENCES public.categories(id),
  account_id     UUID REFERENCES public.accounts(id),
  employee_id    UUID REFERENCES public.employees(id),
  shift_id       UUID REFERENCES public.shifts(id),
  comment        TEXT,
  receipt_url    TEXT,
  locked         BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Counterparties (торговые представители / поставщики) ─────────────────────
CREATE TABLE IF NOT EXISTS public.counterparties (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'supplier',
  phone      TEXT,
  note       TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Debt entries (долги ТП) ───────────────────────────────────────────────────
-- type: 'debt' | 'payment' | 'initial'
CREATE TABLE IF NOT EXISTS public.debt_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id  UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  amount_kopecks   BIGINT NOT NULL CHECK (amount_kopecks > 0),
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id       UUID REFERENCES public.accounts(id),
  comment          TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Org settings (настройки организации) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_settings (
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_org_members_user    ON public.org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org     ON public.org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_accounts_org        ON public.accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_categories_org      ON public.categories(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_org       ON public.employees(org_id);
CREATE INDEX IF NOT EXISTS idx_shifts_org_date     ON public.shifts(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_org    ON public.transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date   ON public.transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_acc    ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_shift  ON public.transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_transactions_del    ON public.transactions(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_counterparties_org  ON public.counterparties(org_id);
CREATE INDEX IF NOT EXISTS idx_debt_entries_org    ON public.debt_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_debt_entries_cp     ON public.debt_entries(counterparty_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings   ENABLE ROW LEVEL SECURITY;

-- users: только своя строка
CREATE POLICY "users_self" ON public.users
  FOR ALL USING (id = auth.uid());

-- organizations: если ты участник
CREATE POLICY "orgs_member" ON public.organizations
  FOR ALL USING (
    id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
  );

-- org_members: видишь участников своих организаций
CREATE POLICY "org_members_policy" ON public.org_members
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.org_members m2
      WHERE m2.user_id = auth.uid() AND m2.deleted_at IS NULL
    )
  );

-- Общая политика для всех таблиц с org_id
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'accounts','categories','employees','shifts','transactions',
    'counterparties','debt_entries','org_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "org_isolation" ON public.%I FOR ALL USING (
          org_id IN (
            SELECT org_id FROM public.org_members
            WHERE user_id = auth.uid() AND deleted_at IS NULL
          )
        )', tbl
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- RPC: increment_account_balance
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_account_balance(
  p_account_id UUID,
  p_delta      BIGINT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.accounts
  SET    balance_kopecks = balance_kopecks + p_delta,
         updated_at      = now()
  WHERE  id = p_account_id;
END;
$$;

-- updated_at нет в схеме accounts — добавим колонку если нужно
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

GRANT EXECUTE ON FUNCTION public.increment_account_balance(UUID, BIGINT) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- STORAGE: бакет для фото чеков
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_insert" ON storage.objects;
CREATE POLICY "receipts_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_select" ON storage.objects;
CREATE POLICY "receipts_select" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'receipts');

COMMIT;
