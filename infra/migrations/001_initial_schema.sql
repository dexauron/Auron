-- =====================================================
-- Auron Finance — Initial Schema
-- Version: 001  /  Date: 2026-06-13
-- Run in Supabase Studio → SQL Editor
-- =====================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- DOMAIN 1: IDENTITY & ACCESS  (7 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.users (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone             TEXT UNIQUE,
  name              TEXT NOT NULL DEFAULT '',
  avatar_url        TEXT,
  pin_hash          TEXT,
  pin_attempts      SMALLINT NOT NULL DEFAULT 0,
  pin_locked_until  TIMESTAMPTZ,
  biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  preferences       JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   UUID NOT NULL REFERENCES public.users(id),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  settings   JSONB NOT NULL DEFAULT '{
    "savings_method":       "virtual",
    "night_shift_date":     "start",
    "target_margin_percent": 25,
    "timezone":             "Europe/Moscow",
    "iman_category_name":   "Хозрасходы владельца"
  }',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS public.org_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES public.roles(id),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','invited')),
  invited_at TIMESTAMPTZ,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT UNIQUE NOT NULL,
  module      TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.invitations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone       TEXT,
  role_id     UUID NOT NULL REFERENCES public.roles(id),
  token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 2: SECURITY & INTEGRATIONS  (5 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_name  TEXT,
  device_type  TEXT CHECK (device_type IN ('mobile','desktop','tablet')),
  ip           TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  permissions  JSONB NOT NULL DEFAULT '[]',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  events      JSONB NOT NULL DEFAULT '[]',
  secret_hash TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id     UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  attempts        SMALLINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_code   SMALLINT,
  response_body   TEXT
);

CREATE TABLE IF NOT EXISTS public.cloud_backup_connections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('yandex_disk','vk_cloud','sber_disk','gdrive','dropbox','webdav')),
  credentials_enc TEXT,
  folder_path     TEXT,
  schedule        TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily','weekly','manual')),
  last_backup_at  TIMESTAMPTZ,
  last_status     TEXT CHECK (last_status IN ('ok','failed')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 3: BILLING  (5 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  code           TEXT UNIQUE NOT NULL,
  price_kopecks  BIGINT NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'month' CHECK (billing_period IN ('month','year')),
  features       JSONB NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES public.plans(id),
  status               TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','cancelled')),
  trial_ends_at        TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.subscription_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  module_key      TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  price_kopecks   BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id),
  amount_kopecks  BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void')),
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  pdf_url         TEXT
);

CREATE TABLE IF NOT EXISTS public.usage_records (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL
);

-- =====================================================
-- DOMAIN 4: FINANCIAL CORE — DOUBLE ENTRY  (5 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  parent_id  UUID REFERENCES public.chart_of_accounts(id),
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, code)
);

CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year       SMALLINT NOT NULL,
  month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at  TIMESTAMPTZ,
  closed_by  UUID REFERENCES public.users(id),
  UNIQUE(org_id, year, month)
);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entry_date       DATE NOT NULL,
  description      TEXT,
  ref_type         TEXT,
  ref_id           UUID,
  fiscal_period_id UUID REFERENCES public.fiscal_periods(id),
  is_reversal      BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_of      UUID REFERENCES public.journal_entries(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id       UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  debit_kopecks  BIGINT NOT NULL DEFAULT 0 CHECK (debit_kopecks >= 0),
  credit_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (credit_kopecks >= 0),
  memo           TEXT
);

-- =====================================================
-- DOMAIN 5: ACCOUNTS & BANK  (5 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.accounts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('cash','bank','reserve','card')),
  icon       TEXT,
  color      TEXT,
  currency   TEXT NOT NULL DEFAULT 'RUB',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.account_balance_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  balance_kopecks BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.bank_connections (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_name         TEXT NOT NULL,
  access_token_enc  TEXT,
  refresh_token_enc TEXT,
  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','error')),
  connected_at      TIMESTAMPTZ DEFAULT NOW(),
  connected_by      UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id             UUID NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  external_id               TEXT NOT NULL,
  transaction_date          DATE NOT NULL,
  amount_kopecks            BIGINT NOT NULL,
  description               TEXT,
  counterparty              TEXT,
  reconciled_transaction_id UUID,
  UNIQUE(connection_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES public.accounts(id),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  opened_by    UUID REFERENCES public.users(id)
);

-- =====================================================
-- DOMAIN 6: CATEGORIES  (5 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'any' CHECK (type IN ('income','expense','any')),
  icon       TEXT,
  color      TEXT,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id  UUID REFERENCES public.categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.category_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category_id    UUID REFERENCES public.categories(id),
  amount_kopecks BIGINT NOT NULL,
  period_type    TEXT NOT NULL DEFAULT 'month' CHECK (period_type IN ('month','quarter','year')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.budget_allocations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_id       UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  planned_kopecks BIGINT NOT NULL,
  actual_kopecks  BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.goals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'goal' CHECK (type IN ('goal','reserve_item')),
  target_kopecks  BIGINT NOT NULL DEFAULT 0,
  current_kopecks BIGINT NOT NULL DEFAULT 0,
  deadline        DATE,
  account_id      UUID REFERENCES public.accounts(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 9: STAFF  (employees needed before shifts)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,
  schedule_type   TEXT NOT NULL DEFAULT '5/2' CHECK (schedule_type IN ('5/2','2/2','3/3','custom')),
  schedule_config JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fired')),
  hire_date       DATE,
  fire_date       DATE,
  user_id         UUID REFERENCES public.users(id),
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 7: RETAIL — KASSA  (shifts before transactions)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.shifts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_date         DATE NOT NULL,
  shift_number       SMALLINT NOT NULL DEFAULT 1 CHECK (shift_number IN (1,2)),
  cashier_id         UUID REFERENCES public.employees(id),
  z_cash_kopecks     BIGINT NOT NULL DEFAULT 0,
  z_card_kopecks     BIGINT NOT NULL DEFAULT 0,
  z_sbp_kopecks      BIGINT NOT NULL DEFAULT 0,
  z_total_kopecks    BIGINT NOT NULL DEFAULT 0,
  fact_cash_kopecks  BIGINT NOT NULL DEFAULT 0,
  fact_card_kopecks  BIGINT NOT NULL DEFAULT 0,
  fact_sbp_kopecks   BIGINT NOT NULL DEFAULT 0,
  fact_total_kopecks BIGINT NOT NULL DEFAULT 0,
  discrepancy_kopecks BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES public.users(id)
);

-- =====================================================
-- DOMAIN 4 (cont.): TRANSACTIONS  (references accounts/categories/employees/shifts)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_uuid      UUID UNIQUE NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('income','expense','transfer','adjustment')),
  amount_kopecks   BIGINT NOT NULL CHECK (amount_kopecks > 0),
  from_account_id  UUID REFERENCES public.accounts(id),
  to_account_id    UUID REFERENCES public.accounts(id),
  category_id      UUID REFERENCES public.categories(id),
  employee_id      UUID REFERENCES public.employees(id),
  shift_id         UUID REFERENCES public.shifts(id),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  comment          TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transaction_time TIME,
  is_locked        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES public.users(id),
  custom_fields    JSONB NOT NULL DEFAULT '{}'
);

-- =====================================================
-- DOMAIN 7 (cont.): SUPPLIERS & SHIFT WITHDRAWALS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.shift_withdrawals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id       UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('supplier_payment','salary','iman','collection','other')),
  category_id    UUID REFERENCES public.categories(id),
  account_id     UUID REFERENCES public.accounts(id),
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  transaction_id UUID REFERENCES public.transactions(id)
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  reliability_score    SMALLINT DEFAULT 100 CHECK (reliability_score BETWEEN 0 AND 100),
  credit_limit_kopecks BIGINT,
  payment_schedule_days INTEGER,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes                TEXT,
  custom_fields        JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  whatsapp    TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.debt_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id      UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('initial','purchase','payment','return','adjustment')),
  amount_kopecks   BIGINT NOT NULL,
  account_id       UUID REFERENCES public.accounts(id),
  invoice_url      TEXT,
  operation_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  deleted_at       TIMESTAMPTZ,
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  expected_date DATE,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','received','cancelled')),
  total_kopecks BIGINT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES public.users(id)
);

-- =====================================================
-- DOMAIN 8: PRODUCTS  (4 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.product_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  parent_id  UUID REFERENCES public.product_categories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sku           TEXT,
  barcode       TEXT,
  category_id   UUID REFERENCES public.product_categories(id),
  cost_kopecks  BIGINT,
  price_kopecks BIGINT,
  unit          TEXT DEFAULT 'шт',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('receipt','sale','write_off','adjustment')),
  quantity      NUMERIC(12,3) NOT NULL,
  cost_kopecks  BIGINT,
  ref_type      TEXT,
  ref_id        UUID,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL,
  cost_kopecks  BIGINT,
  UNIQUE(product_id, snapshot_date)
);

-- =====================================================
-- DOMAIN 9 (cont.): STAFF
-- =====================================================

CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  salary_type  TEXT NOT NULL CHECK (salary_type IN ('fixed','hourly','percent')),
  rate_kopecks BIGINT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS public.timesheet_entries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date    DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'worked' CHECK (status IN ('worked','half_day','day_off','sick','absent','vacation')),
  coefficient  NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (coefficient BETWEEN 0 AND 1),
  confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by UUID REFERENCES public.users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS public.salary_calculations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id        UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  gross_kopecks      BIGINT NOT NULL DEFAULT 0,
  advances_kopecks   BIGINT NOT NULL DEFAULT 0,
  deductions_kopecks BIGINT NOT NULL DEFAULT 0,
  net_kopecks        BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  paid_at            TIMESTAMPTZ,
  transaction_id     UUID REFERENCES public.transactions(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES public.users(id)
);

-- =====================================================
-- DOMAIN 10: NOTIFICATIONS, TASKS & FILES  (8 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.files (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  size_bytes  BIGINT,
  mime_type   TEXT,
  storage_url TEXT NOT NULL,
  hash        TEXT,
  uploaded_by UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.file_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id     UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key            TEXT UNIQUE NOT NULL,
  module         TEXT NOT NULL,
  title_template TEXT NOT NULL,
  body_template  TEXT NOT NULL,
  variables      JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.notification_templates(id),
  data        JSONB NOT NULL DEFAULT '{}',
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('push','telegram','whatsapp','sms','email')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  sent_at         TIMESTAMPTZ,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  channels         JSONB NOT NULL DEFAULT '["push"]',
  preferred_time   TIME,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, org_id, notification_key)
);

CREATE TABLE IF NOT EXISTS public.generated_reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('daily','monthly','custom')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  file_id      UUID REFERENCES public.files(id),
  sent_via     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  assignee_id UUID REFERENCES public.users(id),
  created_by  UUID REFERENCES public.users(id),
  due_at      TIMESTAMPTZ,
  remind_at   TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  done_at     TIMESTAMPTZ,
  ref_type    TEXT,
  ref_id      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 11: AI, PLATFORM & AUDIT  (9 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key           TEXT UNIQUE NOT NULL,
  description   TEXT,
  default_value BOOLEAN NOT NULL DEFAULT FALSE,
  module        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_feature_flags (
  user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  org_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  value    BOOLEAN NOT NULL,
  set_by   UUID REFERENCES public.users(id),
  set_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id, flag_key)
);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  screen     TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_insights (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('anomaly','trend','prediction','advice')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  insight_id UUID NOT NULL REFERENCES public.ai_insights(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating     TEXT NOT NULL CHECK (rating IN ('useful','not_useful')),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pulse_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('green','yellow','red')),
  score         SMALLINT CHECK (score BETWEEN 0 AND 100),
  components    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  field_key   TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  field_type  TEXT NOT NULL CHECK (field_type IN ('text','number','date','select')),
  options     JSONB,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, entity_type, field_key)
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES public.users(id),
  table_name TEXT NOT NULL,
  entity_id  UUID,
  action     TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  old_data   JSONB,
  new_data   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.data_exports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(id),
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  file_url     TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 12: HUMAN FACTOR  (6 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.correction_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  reason           TEXT NOT NULL,
  requested_by     UUID REFERENCES public.users(id),
  approved_by      UUID REFERENCES public.users(id),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.disputes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  description TEXT NOT NULL,
  opened_by   UUID REFERENCES public.users(id),
  resolution  TEXT,
  resolved_by UUID REFERENCES public.users(id),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  author_id   UUID REFERENCES public.users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.acknowledgments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES public.users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.substitute_assignments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES public.users(id),
  to_user_id   UUID NOT NULL REFERENCES public.users(id),
  permissions  JSONB NOT NULL DEFAULT '[]',
  valid_from   TIMESTAMPTZ NOT NULL,
  valid_until  TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.emergency_access_grants (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES public.users(id),
  granted_by         UUID REFERENCES public.users(id),
  reason             TEXT,
  valid_until        TIMESTAMPTZ NOT NULL,
  device_fingerprint TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at            TIMESTAMPTZ
);

-- =====================================================
-- DOMAIN 13: ANTI-FRAUD  (2 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.fraud_rules (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  rule_type  TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',
  action     TEXT NOT NULL DEFAULT 'flag' CHECK (action IN ('flag','block','notify')),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fraud_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id     UUID REFERENCES public.fraud_rules(id),
  entity_type TEXT,
  entity_id   UUID,
  description TEXT,
  severity    TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  reviewed_by UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 14: FORCE MAJEURE  (3 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.incidents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  description       TEXT,
  impact_kopecks    BIGINT,
  affected_accounts JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing','resolved')),
  created_by        UUID REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.exclusion_periods (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  reason                 TEXT,
  start_date             DATE NOT NULL,
  end_date               DATE NOT NULL,
  exclude_from_analytics BOOLEAN NOT NULL DEFAULT TRUE,
  exclude_from_targets   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by             UUID REFERENCES public.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.store_closures (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('planned','emergency','holiday','renovation')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  reason           TEXT,
  notify_suppliers BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- DOMAIN 15: SYNC RELIABILITY  (2 tables)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.offline_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES public.users(id) ON DELETE CASCADE,
  device_id        TEXT,
  operation_type   TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  client_uuid      UUID UNIQUE NOT NULL,
  created_at_local TIMESTAMPTZ NOT NULL,
  synced_at        TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','conflict'))
);

CREATE TABLE IF NOT EXISTS public.sync_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES public.users(id),
  device_id        TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  records_sent     INTEGER NOT NULL DEFAULT 0,
  records_received INTEGER NOT NULL DEFAULT 0,
  last_event_id    UUID,
  status           TEXT NOT NULL CHECK (status IN ('ok','partial','conflict'))
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_org_members_user       ON public.org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org        ON public.org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_transactions_org       ON public.transactions(org_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type      ON public.transactions(org_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted   ON public.transactions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_shift     ON public.transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_org_date        ON public.shifts(org_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_debt_entries_supplier  ON public.debt_entries(supplier_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS idx_debt_entries_deleted   ON public.debt_entries(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_ref    ON public.journal_entries(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry    ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user     ON public.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_org   ON public.analytics_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org          ON public.audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timesheet_employee     ON public.timesheet_entries(employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_employees_org          ON public.employees(org_id, status);
CREATE INDEX IF NOT EXISTS idx_suppliers_org          ON public.suppliers(org_id, status);

-- =====================================================
-- ROW-LEVEL SECURITY
-- =====================================================

ALTER TABLE public.users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_backup_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_balance_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_connections           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_allocations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_withdrawals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_entries               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_snapshots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_calculations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_links                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_reports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feature_flags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_feedback                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_snapshots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_definitions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_exports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acknowledgments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitute_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_access_grants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_rules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exclusion_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_closures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_queue              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log                   ENABLE ROW LEVEL SECURITY;

-- Users: see only own profile
CREATE POLICY "users_self" ON public.users
  FOR ALL USING (id = auth.uid());

-- Organizations: owner or member
CREATE POLICY "orgs_member" ON public.organizations
  FOR ALL USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Org members: see members of own orgs
CREATE POLICY "org_members_policy" ON public.org_members
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Roles: see roles of own orgs
CREATE POLICY "roles_policy" ON public.roles
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Generic org isolation policy for all other tables
-- (applied to each table individually for clarity)
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'accounts','categories','chart_of_accounts','fiscal_periods',
    'journal_entries','transactions','shifts','shift_withdrawals',
    'suppliers','debt_entries','purchase_orders',
    'employees','timesheet_entries','salary_calculations','employee_contracts',
    'goals','budgets','notifications','tasks','files','ai_insights',
    'pulse_snapshots','fraud_rules','audit_log',
    'analytics_events','custom_field_definitions','invitations',
    'api_keys','webhook_endpoints','subscriptions','invoices',
    'cloud_backup_connections','products','product_categories',
    'inventory_movements','generated_reports','correction_requests',
    'disputes','comments','data_exports','sync_log','offline_queue',
    'incidents','store_closures','exclusion_periods',
    'substitute_assignments','emergency_access_grants',
    'account_balance_snapshots','bank_connections','reconciliation_sessions',
    'category_rules','budget_allocations','file_links',
    'notification_deliveries','user_notification_preferences',
    'ai_feedback','usage_records','subscription_items',
    'webhook_deliveries','bank_statement_lines',
    'inventory_snapshots','user_feature_flags',
    'acknowledgments','fraud_alerts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "org_isolation" ON public.%I FOR ALL USING (
          org_id IN (
            SELECT org_id FROM public.org_members
            WHERE user_id = auth.uid() AND status = ''active''
          )
        )', tbl
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;

-- supplier_contacts: нет org_id, доступ через suppliers
CREATE POLICY "supplier_contacts_policy" ON public.supplier_contacts
  FOR ALL USING (
    supplier_id IN (
      SELECT id FROM public.suppliers
      WHERE org_id IN (
        SELECT org_id FROM public.org_members
        WHERE user_id = auth.uid() AND status = 'active'
      )
    )
  );

-- Sessions: own sessions only
CREATE POLICY "sessions_self" ON public.sessions
  FOR ALL USING (user_id = auth.uid());

-- User notification preferences: own only
CREATE POLICY "notif_prefs_self" ON public.user_notification_preferences
  FOR ALL USING (user_id = auth.uid());

-- =====================================================
-- TRIGGER: create user profile on signup
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, phone, name)
  VALUES (
    NEW.id,
    NEW.phone,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Plans
INSERT INTO public.plans (name, code, price_kopecks, features) VALUES
  ('Личный',  'personal', 0,      '{"core":true,"retail":false,"ai":false}'),
  ('ИП',      'ip',       29900,  '{"core":true,"retail":false,"ai":false}'),
  ('Бизнес',  'business', 59000,  '{"core":true,"retail":false,"ai":false}'),
  ('Ритейл',  'retail',   89000,  '{"core":true,"retail":true,"ai":false}'),
  ('Сеть',    'network',  69000,  '{"core":true,"retail":true,"ai":false,"multi_org":true}')
ON CONFLICT (code) DO NOTHING;

-- System permissions
INSERT INTO public.permissions (key, module, description) VALUES
  ('shift.view',    'kassa',     'Просмотр смен'),
  ('shift.create',  'kassa',     'Создание Z-отчёта'),
  ('shift.close',   'kassa',     'Закрытие смены'),
  ('shift.cancel',  'kassa',     'Отмена Z-отчёта'),
  ('debt.view',     'suppliers', 'Просмотр долгов'),
  ('debt.edit',     'suppliers', 'Редактирование долгов'),
  ('staff.view',    'staff',     'Просмотр персонала'),
  ('staff.edit',    'staff',     'Редактирование персонала'),
  ('finance.view',  'finance',   'Просмотр финансов'),
  ('finance.edit',  'finance',   'Редактирование транзакций'),
  ('settings.view', 'settings',  'Просмотр настроек'),
  ('settings.edit', 'settings',  'Редактирование настроек'),
  ('reports.view',  'reports',   'Просмотр отчётов'),
  ('access.manage', 'admin',     'Управление доступом')
ON CONFLICT (key) DO NOTHING;

-- Notification templates
INSERT INTO public.notification_templates (key, module, title_template, body_template) VALUES
  ('z_report_reminder', 'kassa',     'Напоминание о Z-отчёте',   'Не забудьте закрыть смену за {{date}}'),
  ('daily_brief',       'analytics', 'Итог дня',                  'Выручка: {{revenue}} · Расходы: {{expenses}}'),
  ('debt_overdue',      'suppliers', 'Просроченный долг',         '{{supplier}} — долг {{amount}} просрочен'),
  ('low_cash',          'accounts',  'Низкий остаток',            'На счёте {{account}} осталось {{balance}}'),
  ('shift_discrepancy', 'kassa',     'Расхождение в кассе',       'Расхождение {{amount}} в смене {{shift_date}}')
ON CONFLICT (key) DO NOTHING;

-- Feature flags
INSERT INTO public.feature_flags (key, description, default_value, module) VALUES
  ('ai_insights',    'ИИ-инсайты',            FALSE, 'ai'),
  ('ai_chat',        'Чат с ИИ',               FALSE, 'ai'),
  ('bank_sync',      'Синхронизация с банком', FALSE, 'finance'),
  ('inventory',      'Модуль Товары',           TRUE,  'products'),
  ('staff_module',   'Модуль Персонал',         TRUE,  'staff'),
  ('pulse_widget',   'Финансовый пульс',        TRUE,  'analytics'),
  ('calendar_money', 'Календарь денег',         FALSE, 'analytics'),
  ('compact_mode',   'Компактный режим',        FALSE, 'ui'),
  ('dark_mode_auto', 'Авто тёмная тема',        TRUE,  'ui')
ON CONFLICT (key) DO NOTHING;

COMMIT;
