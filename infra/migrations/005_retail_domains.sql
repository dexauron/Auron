-- 005: домены Модуля Розница, которых не хватало
--
-- Добавляет таблицы под экраны из docs/03-SCREENS.md:
--   Касса        → shift_withdrawals   (выплаты с кассы отдельными строками)
--   Поставщики   → purchase_orders, supplier_contacts
--   Финансы      → goals               (накопления и цели)
--   Персонал     → timesheet_entries, salary_calculations
--
-- Ничего не переименовывает и не удаляет: существующие таблицы и данные
-- не трогаются. Поставщики по-прежнему живут в counterparties — в
-- docs/05-ARCHITECTURE.md они названы suppliers, расхождение осознанное
-- и описано в docs/DECISIONS.md.
--
-- Суммы везде в копейках (BIGINT), как в остальной схеме.

-- ─────────────────────────────────────────────────────────────────────
-- Касса: выплаты с кассы
-- ─────────────────────────────────────────────────────────────────────
-- Раньше лежали в shifts.withdrawals_json. Отдельная таблица нужна,
-- чтобы каждая выплата попадала в свою статью расходов и в аналитику.
-- Старое поле не удаляем — данные из него переносятся отдельно.
CREATE TABLE IF NOT EXISTS public.shift_withdrawals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id       UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- iman — расход владельца, статью пользователь называет сам при настройке
  type           TEXT NOT NULL DEFAULT 'other'
                 CHECK (type IN ('supplier_payment','salary','iman','collection','other')),
  category_id    UUID REFERENCES public.categories(id),
  account_id     UUID REFERENCES public.accounts(id),
  amount_kopecks BIGINT NOT NULL DEFAULT 0,
  transaction_id UUID REFERENCES public.transactions(id),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_withdrawals_shift ON public.shift_withdrawals(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_withdrawals_org   ON public.shift_withdrawals(org_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- Поставщики: контакты и заказы
-- ─────────────────────────────────────────────────────────────────────
-- У одного торгового представителя бывает несколько контактных лиц
CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  role            TEXT,
  phone           TEXT,
  whatsapp        TEXT,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_cp ON public.supplier_contacts(counterparty_id);

-- Заявки на поставку: вкладка «Заказы» на экране Поставщики
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL REFERENCES public.counterparties(id),
  department      TEXT,
  expected_date   DATE,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','received','cancelled')),
  total_kopecks   BIGINT NOT NULL DEFAULT 0,
  -- фактическая сумма проставляется при приёме товара
  actual_kopecks  BIGINT,
  received_at     TIMESTAMPTZ,
  notes           TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org ON public.purchase_orders(org_id, expected_date);

-- ─────────────────────────────────────────────────────────────────────
-- Финансы: накопления и цели
-- ─────────────────────────────────────────────────────────────────────
-- Одна таблица на две сущности:
--   reserve_item — статья накоплений (Аренда, ЗП, Налоги)
--   goal         — цель, которую ставит Владелец
CREATE TABLE IF NOT EXISTS public.goals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'reserve_item'
                  CHECK (type IN ('goal','reserve_item')),
  target_kopecks  BIGINT NOT NULL DEFAULT 0,
  current_kopecks BIGINT NOT NULL DEFAULT 0,
  deadline        DATE,
  account_id      UUID REFERENCES public.accounts(id),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','achieved','cancelled')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goals_org ON public.goals(org_id, type, status);

-- ─────────────────────────────────────────────────────────────────────
-- Персонал: табель и зарплата
-- ─────────────────────────────────────────────────────────────────────
-- Один сотрудник — одна строка в день. Пара (employee_id, work_date)
-- уникальна, чтобы повторное сохранение не плодило дубликаты.
CREATE TABLE IF NOT EXISTS public.timesheet_entries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date    DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'worked'
               CHECK (status IN ('worked','half_day','day_off','sick','absent','vacation')),
  -- коэффициент для нестандартной частичной оплаты: 0.75, 0.3 и т.п.
  coefficient  NUMERIC(3,2) NOT NULL DEFAULT 1.00
               CHECK (coefficient >= 0 AND coefficient <= 1),
  confirmed    BOOLEAN NOT NULL DEFAULT false,
  confirmed_by UUID REFERENCES public.users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_org_date ON public.timesheet_entries(org_id, work_date);

-- Расчёт зарплаты — документ, а не просто запись:
-- у него есть статус и он связан с проведённой транзакцией
CREATE TABLE IF NOT EXISTS public.salary_calculations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id        UUID NOT NULL REFERENCES public.employees(id),
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  gross_kopecks      BIGINT NOT NULL DEFAULT 0,
  -- авансы за период собираются автоматически из транзакций
  advances_kopecks   BIGINT NOT NULL DEFAULT 0,
  deductions_kopecks BIGINT NOT NULL DEFAULT 0,
  net_kopecks        BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','paid')),
  paid_at            TIMESTAMPTZ,
  transaction_id     UUID REFERENCES public.transactions(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES public.users(id),
  UNIQUE (employee_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_salary_org_period ON public.salary_calculations(org_id, period_start);

-- ─────────────────────────────────────────────────────────────────────
-- Изоляция по организациям
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.shift_withdrawals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_calculations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'shift_withdrawals','supplier_contacts','purchase_orders',
    'goals','timesheet_entries','salary_calculations'
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
