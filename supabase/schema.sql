-- ═══════════════════════════════════════════════════════════════
-- AURON FINANCE — Supabase Schema
-- Запусти этот файл в Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- Организации
CREATE TABLE IF NOT EXISTS orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Счета
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  balance     BIGINT DEFAULT 0,
  status      TEXT DEFAULT 'active',
  icon        TEXT DEFAULT '💵',
  color       TEXT DEFAULT '#10B981',
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Транзакции (БАЗА)
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid        TEXT UNIQUE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  type        TEXT NOT NULL,
  category    TEXT DEFAULT '',
  amount      BIGINT NOT NULL DEFAULT 0,
  account_id  UUID,
  employee    TEXT DEFAULT '',
  comment     TEXT DEFAULT '',
  receipt_url TEXT DEFAULT '',
  shift_id    TEXT DEFAULT '',
  locked      BOOLEAN DEFAULT FALSE,
  shift_num   INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Смены (Z-отчёты)
CREATE TABLE IF NOT EXISTS shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  shift_num   INT DEFAULT 1,
  cashier     TEXT DEFAULT '',
  z_cash      BIGINT DEFAULT 0,
  z_card      BIGINT DEFAULT 0,
  z_sbp       BIGINT DEFAULT 0,
  z_total     BIGINT DEFAULT 0,
  fact_cash   BIGINT DEFAULT 0,
  fact_card   BIGINT DEFAULT 0,
  fact_sbp    BIGINT DEFAULT 0,
  withdrawals JSONB DEFAULT '[]',
  discrepancy BIGINT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Долги (ТП)
CREATE TABLE IF NOT EXISTS debts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rep_name    TEXT NOT NULL,
  type        TEXT NOT NULL,
  amount      BIGINT NOT NULL DEFAULT 0,
  date        TEXT NOT NULL,
  status      TEXT DEFAULT 'active',
  account_id  UUID,
  comment     TEXT DEFAULT '',
  invoice     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Корзина
CREATE TABLE IF NOT EXISTS trash (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  original_data JSONB NOT NULL,
  deleted_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Категории
CREATE TABLE IF NOT EXISTS categories (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  type    TEXT DEFAULT 'expense',
  UNIQUE(org_id, name, type)
);

-- Сотрудники
CREATE TABLE IF NOT EXISTS employees (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  rate    BIGINT DEFAULT 0,
  status  TEXT DEFAULT 'active',
  UNIQUE(org_id, name)
);

-- Рекуррентные платежи
CREATE TABLE IF NOT EXISTS recurring (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT DEFAULT '',
  amount        BIGINT DEFAULT 0,
  account_id    UUID,
  day_of_month  INT DEFAULT 1,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════
-- Row Level Security (каждый видит только свои данные)
-- ══════════════════════════════════════

ALTER TABLE orgs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trash       ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring   ENABLE ROW LEVEL SECURITY;

-- Orgs: только свои (USING для SELECT/UPDATE/DELETE, WITH CHECK для INSERT/UPDATE)
CREATE POLICY "own_orgs" ON orgs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Остальные таблицы: через принадлежность к org
CREATE POLICY "own_accounts"     ON accounts     FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = accounts.org_id    AND orgs.user_id = auth.uid()));
CREATE POLICY "own_transactions" ON transactions FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = transactions.org_id AND orgs.user_id = auth.uid()));
CREATE POLICY "own_shifts"       ON shifts       FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = shifts.org_id       AND orgs.user_id = auth.uid()));
CREATE POLICY "own_debts"        ON debts        FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = debts.org_id        AND orgs.user_id = auth.uid()));
CREATE POLICY "own_trash"        ON trash        FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = trash.org_id        AND orgs.user_id = auth.uid()));
CREATE POLICY "own_categories"   ON categories   FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = categories.org_id  AND orgs.user_id = auth.uid()));
CREATE POLICY "own_employees"    ON employees    FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = employees.org_id   AND orgs.user_id = auth.uid()));
CREATE POLICY "own_recurring"    ON recurring    FOR ALL USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = recurring.org_id   AND orgs.user_id = auth.uid()));

-- ══════════════════════════════════════
-- Вспомогательная функция: атомарное обновление баланса
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION update_account_balance(p_account_id UUID, p_delta BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE accounts
  SET balance = balance + p_delta
  WHERE id = p_account_id
    AND EXISTS (
      SELECT 1 FROM orgs
      WHERE orgs.id = accounts.org_id
        AND orgs.user_id = auth.uid()
    );
END;
$$;

-- ══════════════════════════════════════
-- FIX: Если уже существует — пересоздай политику orgs с WITH CHECK
-- Запусти в Supabase Dashboard → SQL Editor если видишь ошибку
-- "The caller does not have permission" при регистрации
-- ══════════════════════════════════════
DROP POLICY IF EXISTS "own_orgs" ON orgs;
CREATE POLICY "own_orgs" ON orgs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
