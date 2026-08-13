-- ═══════════════════════════════════════════════════════════════════════
-- 005 — Права по ролям на уровне базы
--
-- ЗАЧЕМ. До этой миграции защита строк отвечала только на один вопрос:
-- «ты состоишь в этой организации?». Если да — тебе разрешалось всё:
-- читать выручку, менять чужие операции, смотреть зарплаты сотрудников
-- и списывать долги. Роль не проверялась вообще.
--
-- Для приложения про деньги это дыра: сотрудник зала, у которого в
-- интерфейсе нет и кнопки «Аналитика», мог бы обратиться к базе напрямую
-- и прочитать всё. Скрытая кнопка — это удобство, а не защита; проверять
-- обязан сервер. В версии на Google Apps Script такая проверка есть
-- (_permGuard/_finGuard), и эта миграция переносит те же правила в базу
-- один в один.
--
-- ПРАВА ПО РОЛЯМ — зеркало _oneRolePerms() из webapp/Code.gs:
--   owner      (Владелец)        finance kassa receive goods payments manage
--   admin      (Администратор)   finance kassa receive goods payments
--   accountant (Бухгалтер)       finance payments goods
--   cashier    (Сотрудник зала)  kassa receive
--
-- ВАЖНО ПРО ЗАПИСЬ БЕЗ ЧТЕНИЯ. Сотрудник зала записывает смену и
-- накладные, но читать чужие деньги ему нельзя. В Postgres это законно:
-- INSERT разрешён, SELECT нет. Но тогда запрос «вставь и верни строку»
-- (INSERT ... RETURNING, а Supabase так делает по умолчанию) упадёт.
-- Клиент обязан вставлять с returning:'minimal' — иначе у кассира
-- запись смены будет падать с непонятной ошибкой доступа.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Помощники ─────────────────────────────────────────────────────────
-- SECURITY DEFINER здесь обязателен: функция сама читает org_members, на
-- которой тоже включена защита строк. Без него получилась бы рекурсия
-- «чтобы узнать права, проверь права». search_path прибит гвоздями,
-- чтобы никто не подсунул свою таблицу с тем же именем.

CREATE OR REPLACE FUNCTION public.auron_perms(p_org UUID)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE m.role
    WHEN 'owner'      THEN ARRAY['finance','kassa','receive','goods','payments','manage']
    WHEN 'admin'      THEN ARRAY['finance','kassa','receive','goods','payments']
    WHEN 'accountant' THEN ARRAY['finance','payments','goods']
    ELSE                   ARRAY['kassa','receive']
  END
  FROM public.org_members m
  WHERE m.org_id = p_org
    AND m.user_id = auth.uid()
    AND m.deleted_at IS NULL
  LIMIT 1
$$;

-- Не состоишь в организации — прав нет. COALESCE превращает «строки не
-- нашлось» в честное «нельзя», а не в NULL, который проверка пропустила бы.
CREATE OR REPLACE FUNCTION public.auron_can(p_org UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_perm = ANY(public.auron_perms(p_org)), false)
$$;

REVOKE ALL ON FUNCTION public.auron_perms(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auron_perms(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auron_can(UUID, TEXT) TO authenticated;

-- ── Убираем старое правило «свой — значит всё можно» ──────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['accounts','categories','employees','shifts',
                             'transactions','counterparties','debt_entries','org_settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON public.%I', tbl);
  END LOOP;
END $$;

-- ── Деньги: читают только те, у кого есть доступ к финансам ───────────
-- transactions, debt_entries, accounts.

DROP POLICY IF EXISTS "tx_read"   ON public.transactions;
DROP POLICY IF EXISTS "tx_write"  ON public.transactions;
DROP POLICY IF EXISTS "tx_change" ON public.transactions;
DROP POLICY IF EXISTS "tx_del"    ON public.transactions;

CREATE POLICY "tx_read" ON public.transactions
  FOR SELECT USING (public.auron_can(org_id,'finance'));

-- Кассир записывает смену — значит вставлять он обязан уметь, хотя
-- читать чужие операции ему нельзя.
CREATE POLICY "tx_write" ON public.transactions
  FOR INSERT WITH CHECK (
    public.auron_can(org_id,'finance') OR public.auron_can(org_id,'kassa')
  );

-- Правка и удаление денег — дело владельца и администратора. Бухгалтер
-- читает и считает, но не переписывает историю задним числом.
CREATE POLICY "tx_change" ON public.transactions
  FOR UPDATE USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));
CREATE POLICY "tx_del" ON public.transactions
  FOR DELETE USING (public.auron_can(org_id,'manage'));

DROP POLICY IF EXISTS "debt_read"   ON public.debt_entries;
DROP POLICY IF EXISTS "debt_write"  ON public.debt_entries;
DROP POLICY IF EXISTS "debt_change" ON public.debt_entries;

CREATE POLICY "debt_read" ON public.debt_entries
  FOR SELECT USING (public.auron_can(org_id,'finance'));
-- Приём товара порождает долг поставщику — это право «receive».
CREATE POLICY "debt_write" ON public.debt_entries
  FOR INSERT WITH CHECK (
    public.auron_can(org_id,'finance') OR public.auron_can(org_id,'receive')
  );
CREATE POLICY "debt_change" ON public.debt_entries
  FOR UPDATE USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));

DROP POLICY IF EXISTS "acc_read"   ON public.accounts;
DROP POLICY IF EXISTS "acc_manage" ON public.accounts;

CREATE POLICY "acc_read" ON public.accounts
  FOR SELECT USING (public.auron_can(org_id,'finance'));
CREATE POLICY "acc_manage" ON public.accounts
  FOR ALL USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));

-- ── Зарплаты ──────────────────────────────────────────────────────────
-- Самая чувствительная таблица в базе. Сотрудник зала не должен видеть,
-- кто сколько получает: это ссорит людей быстрее, чем любая недостача.
DROP POLICY IF EXISTS "emp_read"   ON public.employees;
DROP POLICY IF EXISTS "emp_manage" ON public.employees;

CREATE POLICY "emp_read" ON public.employees
  FOR SELECT USING (public.auron_can(org_id,'finance'));
CREATE POLICY "emp_manage" ON public.employees
  FOR ALL USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));

-- ── Смены ─────────────────────────────────────────────────────────────
-- Кассир пишет свою смену и видит смены магазина: без этого он не сможет
-- свести кассу. Изменить записанное может только владелец.
DROP POLICY IF EXISTS "shift_read"   ON public.shifts;
DROP POLICY IF EXISTS "shift_write"  ON public.shifts;
DROP POLICY IF EXISTS "shift_manage" ON public.shifts;

CREATE POLICY "shift_read" ON public.shifts
  FOR SELECT USING (
    public.auron_can(org_id,'finance') OR public.auron_can(org_id,'kassa')
  );
CREATE POLICY "shift_write" ON public.shifts
  FOR INSERT WITH CHECK (public.auron_can(org_id,'kassa'));
CREATE POLICY "shift_manage" ON public.shifts
  FOR ALL USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));

-- ── Справочники ───────────────────────────────────────────────────────
-- Поставщиков и категории видят все: без списка поставщиков кассир не
-- запишет накладную. Менять справочник — право «goods».
DROP POLICY IF EXISTS "cp_read"   ON public.counterparties;
DROP POLICY IF EXISTS "cp_manage" ON public.counterparties;
DROP POLICY IF EXISTS "cat_read"   ON public.categories;
DROP POLICY IF EXISTS "cat_manage" ON public.categories;

CREATE POLICY "cp_read" ON public.counterparties
  FOR SELECT USING (public.auron_perms(org_id) IS NOT NULL);
CREATE POLICY "cp_manage" ON public.counterparties
  FOR ALL USING (public.auron_can(org_id,'goods'))
  WITH CHECK (public.auron_can(org_id,'goods'));

CREATE POLICY "cat_read" ON public.categories
  FOR SELECT USING (public.auron_perms(org_id) IS NOT NULL);
CREATE POLICY "cat_manage" ON public.categories
  FOR ALL USING (public.auron_can(org_id,'goods'))
  WITH CHECK (public.auron_can(org_id,'goods'));

-- ── Настройки магазина ────────────────────────────────────────────────
-- Читают все (там валюта, названия смен, режим работы), меняет владелец.
-- Среди настроек есть замок периода: дай к нему доступ кассиру — и
-- закрытый месяц перестанет быть закрытым.
DROP POLICY IF EXISTS "settings_read"   ON public.org_settings;
DROP POLICY IF EXISTS "settings_manage" ON public.org_settings;

CREATE POLICY "settings_read" ON public.org_settings
  FOR SELECT USING (public.auron_perms(org_id) IS NOT NULL);
CREATE POLICY "settings_manage" ON public.org_settings
  FOR ALL USING (public.auron_can(org_id,'manage'))
  WITH CHECK (public.auron_can(org_id,'manage'));

COMMIT;
