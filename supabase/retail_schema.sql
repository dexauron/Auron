-- ═══════════════════════════════════════════════════════════════════════════
-- AURON — RETAIL / POS / MANAGERIAL ACCOUNTING SCHEMA (PostgreSQL / Supabase)
-- Нормализация 3NF. Цепочка точной маржи:
--   receipts → receipt_items → products → batches  (через cogs_allocations)
-- Деньги: BIGINT в копейках. Количество: NUMERIC(14,3).
-- Идемпотентно (IF NOT EXISTS). Запуск: SQL Editor → New Query → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Номенклатура (справочник SKU)
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  barcode      TEXT,
  name         TEXT NOT NULL,
  category     TEXT DEFAULT '',
  unit         TEXT DEFAULT 'шт',
  retail_price BIGINT DEFAULT 0,                       -- текущая розничная цена, коп
  cost_method  TEXT NOT NULL DEFAULT 'fifo' CHECK (cost_method IN ('fifo','avg')),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(org_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(org_id, category);

-- 2. Контрагенты (поставщики / покупатели)
CREATE TABLE IF NOT EXISTS counterparties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'supplier' CHECK (kind IN ('supplier','customer','other')),
  phone      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, name, kind)
);

-- 3. Партии (закупочная стоимость для FIFO / средней; замороженный капитал)
CREATE TABLE IF NOT EXISTS batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id   UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qty_received  NUMERIC(14,3) NOT NULL CHECK (qty_received > 0),
  qty_remaining NUMERIC(14,3) NOT NULL CHECK (qty_remaining >= 0),
  unit_cost     BIGINT NOT NULL CHECK (unit_cost >= 0),    -- закупка за единицу, коп
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- ключевой индекс для FIFO-выборки «самая старая партия с остатком»
CREATE INDEX IF NOT EXISTS idx_batches_fifo
  ON batches(org_id, product_id, received_at) WHERE qty_remaining > 0;

-- 4. Справочник статей ДДС (ЖЁСТКИЙ — без «Разное/Прочее»)
CREATE TABLE IF NOT EXISTS cf_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  section   TEXT NOT NULL CHECK (section   IN ('operating','investing','financing')),
  direction TEXT NOT NULL CHECK (direction IN ('income','expense')),
  UNIQUE (org_id, code)
);

-- 5. Чеки (операции кассы)
CREATE TABLE IF NOT EXISTS receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id    TEXT,                                 -- ID чека из источника (идемпотентность)
  ts             TIMESTAMPTZ NOT NULL,
  register_id    TEXT DEFAULT '',                      -- ID кассы
  cashier        TEXT DEFAULT '',
  op_type        TEXT NOT NULL CHECK (op_type IN ('sale','refund','void','storno')),
  discount_total BIGINT DEFAULT 0,
  total          BIGINT DEFAULT 0,
  manual_discount BIGINT DEFAULT 0,                    -- ручная скидка кассира (контроль потерь)
  is_flagged     BOOLEAN DEFAULT FALSE,                -- авто-метка модуля контроля потерь
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_ts      ON receipts(org_id, ts);
CREATE INDEX IF NOT EXISTS idx_receipts_flagged ON receipts(org_id, is_flagged) WHERE is_flagged;

-- 6. Позиции чека (детализация)
CREATE TABLE IF NOT EXISTS receipt_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty        NUMERIC(14,3) NOT NULL,
  unit_price BIGINT NOT NULL,                          -- розничная цена НА МОМЕНТ продажи, коп
  discount   BIGINT DEFAULT 0,
  line_total BIGINT NOT NULL                           -- qty*unit_price - discount
);
CREATE INDEX IF NOT EXISTS idx_ritems_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_ritems_product ON receipt_items(product_id);

-- 7. Списание себестоимости по партиям (FIFO allocation) — ИСТОЧНИК ТОЧНОЙ МАРЖИ
--    Одна позиция чека может списываться из НЕСКОЛЬКИХ партий (разные закупки).
CREATE TABLE IF NOT EXISTS cogs_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id UUID NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  qty             NUMERIC(14,3) NOT NULL,
  unit_cost       BIGINT NOT NULL,                     -- ЗАФИКСИРОВАННАЯ себестоимость партии
  cost_total      BIGINT NOT NULL                      -- qty*unit_cost (исторический факт)
);
CREATE INDEX IF NOT EXISTS idx_cogs_item  ON cogs_allocations(receipt_item_id);
CREATE INDEX IF NOT EXISTS idx_cogs_batch ON cogs_allocations(batch_id);

-- 8. Движение денежных средств (ДДС / Cash Flow)
CREATE TABLE IF NOT EXISTS cash_flow (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount >= 0),  -- знак берётся из cf_items.direction
  cf_item_id      UUID NOT NULL REFERENCES cf_items(id) ON DELETE RESTRICT,
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  tag             TEXT DEFAULT '',                      -- параллельный/проектный учёт
  receipt_id      UUID REFERENCES receipts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_date ON cash_flow(org_id, date);
CREATE INDEX IF NOT EXISTS idx_cf_item ON cash_flow(org_id, cf_item_id);

-- 9. Обязательства (кредиторская/дебиторская задолженность, отсрочки)
CREATE TABLE IF NOT EXISTS obligations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  counterparty_id  UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('payable','receivable')),
  amount           BIGINT NOT NULL,
  paid             BIGINT DEFAULT 0,
  due_date         DATE,
  status           TEXT DEFAULT 'open' CHECK (status IN ('open','partial','closed','overdue')),
  source_receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obl_due ON obligations(org_id, due_date) WHERE status <> 'closed';

-- 10. Бюджеты (плановые лимиты по статьям ДДС)
CREATE TABLE IF NOT EXISTS budgets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,                            -- 'YYYY-MM'
  cf_item_id UUID NOT NULL REFERENCES cf_items(id) ON DELETE CASCADE,
  planned    BIGINT NOT NULL DEFAULT 0,
  UNIQUE (org_id, period, cf_item_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FIFO-движок на стороне БД: атомарное списание себестоимости при продаже.
-- Гарантирует корректную маржу даже при N сменах закупочной цены.
-- Возврат: суммарная себестоимость позиции (коп). Помечает отрицательный остаток.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fifo_issue(p_receipt_item_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item    receipt_items%ROWTYPE;
  v_method  TEXT;
  v_org     UUID;
  v_left    NUMERIC(14,3);
  v_take    NUMERIC(14,3);
  v_cogs    BIGINT := 0;
  v_avg     BIGINT;
  b         RECORD;
BEGIN
  SELECT * INTO v_item FROM receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_item % not found', p_receipt_item_id; END IF;

  SELECT p.cost_method, p.org_id INTO v_method, v_org FROM products p WHERE p.id = v_item.product_id;
  v_left := v_item.qty;

  IF v_method = 'avg' THEN
    -- скользящая средняя по текущим остаткам партий
    SELECT CASE WHEN SUM(qty_remaining) > 0
                THEN ROUND(SUM(qty_remaining*unit_cost)/SUM(qty_remaining))
                ELSE 0 END
      INTO v_avg
      FROM batches WHERE product_id = v_item.product_id AND qty_remaining > 0;
    v_cogs := ROUND(v_left * COALESCE(v_avg,0));
    -- пропорционально гасим остатки партий (FIFO-порядок)
    FOR b IN SELECT * FROM batches
             WHERE product_id = v_item.product_id AND qty_remaining > 0
             ORDER BY received_at LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(b.qty_remaining, v_left);
      UPDATE batches SET qty_remaining = qty_remaining - v_take WHERE id = b.id;
      INSERT INTO cogs_allocations(receipt_item_id, batch_id, qty, unit_cost, cost_total)
        VALUES (p_receipt_item_id, b.id, v_take, v_avg, ROUND(v_take*v_avg));
      v_left := v_left - v_take;
    END LOOP;
    -- переоценка остатков по средней: валюация склада остаётся согласованной
    UPDATE batches SET unit_cost = v_avg
      WHERE product_id = v_item.product_id AND qty_remaining > 0;
    RETURN v_cogs;
  END IF;

  -- FIFO: списываем из самых старых партий
  FOR b IN SELECT * FROM batches
           WHERE product_id = v_item.product_id AND qty_remaining > 0
           ORDER BY received_at, id LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(b.qty_remaining, v_left);
    UPDATE batches SET qty_remaining = qty_remaining - v_take WHERE id = b.id;
    INSERT INTO cogs_allocations(receipt_item_id, batch_id, qty, unit_cost, cost_total)
      VALUES (p_receipt_item_id, b.id, v_take, b.unit_cost, ROUND(v_take*b.unit_cost));
    v_cogs := v_cogs + ROUND(v_take*b.unit_cost);
    v_left := v_left - v_take;
  END LOOP;

  -- отрицательный остаток (продали больше, чем на складе) — fallback на последнюю цену
  IF v_left > 0 THEN
    SELECT unit_cost INTO v_avg FROM batches
      WHERE product_id = v_item.product_id ORDER BY received_at DESC, id DESC LIMIT 1;
    v_avg := COALESCE(v_avg, 0);
    v_cogs := v_cogs + ROUND(v_left * v_avg);
    UPDATE receipts SET is_flagged = TRUE WHERE id = v_item.receipt_id; -- сигнал: отрицательный сток
  END IF;

  RETURN v_cogs;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- АНАЛИТИЧЕСКИЕ ПРЕДСТАВЛЕНИЯ
-- ═══════════════════════════════════════════════════════════════════════════

-- Валовая прибыль по позициям (выручка − себестоимость из cogs_allocations)
CREATE OR REPLACE VIEW v_gross_margin AS
SELECT
  r.org_id,
  r.ts::date            AS date,
  ri.product_id,
  p.sku, p.name, p.category,
  r.op_type,
  ri.qty,
  ri.line_total                                                AS revenue,        -- коп
  COALESCE(SUM(ca.cost_total), 0)                              AS cogs,           -- коп
  ri.line_total - COALESCE(SUM(ca.cost_total), 0)             AS gross_profit,    -- коп
  CASE WHEN ri.line_total > 0
       THEN ROUND(100.0*(ri.line_total - COALESCE(SUM(ca.cost_total),0))/ri.line_total, 2)
       ELSE 0 END                                              AS margin_pct
FROM receipt_items ri
JOIN receipts r       ON r.id = ri.receipt_id
JOIN products p       ON p.id = ri.product_id
LEFT JOIN cogs_allocations ca ON ca.receipt_item_id = ri.id
GROUP BY r.org_id, r.ts, ri.id, p.sku, p.name, p.category, r.op_type, ri.qty, ri.line_total;

-- Оборачиваемость запасов / замороженный капитал (по текущим остаткам партий)
CREATE OR REPLACE VIEW v_inventory_value AS
SELECT
  b.org_id, b.product_id, p.sku, p.name, p.category,
  SUM(b.qty_remaining)                       AS qty_on_hand,
  SUM(b.qty_remaining * b.unit_cost)         AS stock_value_cost   -- замороженный капитал, коп
FROM batches b JOIN products p ON p.id = b.product_id
WHERE b.qty_remaining > 0
GROUP BY b.org_id, b.product_id, p.sku, p.name, p.category;

-- P&L: выручка / себестоимость / валовая прибыль (продажи минус возвраты)
CREATE OR REPLACE VIEW v_pnl_gross AS
SELECT
  r.org_id,
  date_trunc('month', r.ts)::date AS period,
  SUM(CASE WHEN r.op_type='sale'   THEN ri.line_total
           WHEN r.op_type='refund' THEN -ri.line_total ELSE 0 END)                       AS revenue,
  SUM(CASE WHEN r.op_type='sale'   THEN COALESCE(ca.cost_total,0)
           WHEN r.op_type='refund' THEN -COALESCE(ca.cost_total,0) ELSE 0 END)           AS cogs,
  SUM(CASE WHEN r.op_type='sale'   THEN ri.line_total - COALESCE(ca.cost_total,0)
           WHEN r.op_type='refund' THEN -(ri.line_total - COALESCE(ca.cost_total,0)) ELSE 0 END) AS gross_profit
FROM receipts r
JOIN receipt_items ri ON ri.receipt_id = r.id
LEFT JOIN cogs_allocations ca ON ca.receipt_item_id = ri.id
GROUP BY r.org_id, date_trunc('month', r.ts);

-- Контроль потерь: чеки с отменами/возвратами/ручными скидками
CREATE OR REPLACE VIEW v_loss_control AS
SELECT r.org_id, r.ts::date AS date, r.cashier, r.register_id, r.op_type,
       r.manual_discount, r.total, r.external_id
FROM receipts r
WHERE r.op_type IN ('refund','void','storno') OR r.manual_discount > 0
ORDER BY r.ts DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cogs_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow       ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_products       ON products;
DROP POLICY IF EXISTS own_counterparties ON counterparties;
DROP POLICY IF EXISTS own_batches        ON batches;
DROP POLICY IF EXISTS own_cf_items       ON cf_items;
DROP POLICY IF EXISTS own_receipts       ON receipts;
DROP POLICY IF EXISTS own_receipt_items  ON receipt_items;
DROP POLICY IF EXISTS own_cogs           ON cogs_allocations;
DROP POLICY IF EXISTS own_cash_flow      ON cash_flow;
DROP POLICY IF EXISTS own_obligations    ON obligations;
DROP POLICY IF EXISTS own_budgets        ON budgets;

CREATE POLICY own_products       ON products       FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=products.org_id       AND o.user_id=auth.uid()));
CREATE POLICY own_counterparties ON counterparties FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=counterparties.org_id AND o.user_id=auth.uid()));
CREATE POLICY own_batches        ON batches        FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=batches.org_id        AND o.user_id=auth.uid()));
CREATE POLICY own_cf_items       ON cf_items       FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=cf_items.org_id        AND o.user_id=auth.uid()));
CREATE POLICY own_receipts       ON receipts       FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=receipts.org_id        AND o.user_id=auth.uid()));
CREATE POLICY own_cash_flow      ON cash_flow      FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=cash_flow.org_id       AND o.user_id=auth.uid()));
CREATE POLICY own_obligations    ON obligations    FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=obligations.org_id     AND o.user_id=auth.uid()));
CREATE POLICY own_budgets        ON budgets        FOR ALL USING (EXISTS (SELECT 1 FROM orgs o WHERE o.id=budgets.org_id         AND o.user_id=auth.uid()));
-- дочерние таблицы (без org_id) — RLS через JOIN к владельцу
CREATE POLICY own_receipt_items  ON receipt_items  FOR ALL USING (EXISTS (
  SELECT 1 FROM receipts r JOIN orgs o ON o.id=r.org_id WHERE r.id=receipt_items.receipt_id AND o.user_id=auth.uid()));
CREATE POLICY own_cogs           ON cogs_allocations FOR ALL USING (EXISTS (
  SELECT 1 FROM receipt_items ri JOIN receipts r ON r.id=ri.receipt_id JOIN orgs o ON o.id=r.org_id
  WHERE ri.id=cogs_allocations.receipt_item_id AND o.user_id=auth.uid()));
