-- =====================================================
-- Auron Finance — Demo Data (3 years)
-- Запустить: Supabase Studio → SQL Editor
-- =====================================================

DO $$
DECLARE
  v_user_id    UUID;
  v_org_id     UUID;
  v_acc_cash   UUID;
  v_acc_bank   UUID;
  v_acc_card   UUID;
  v_acc_sbp    UUID;
  v_cat_sales  UUID;
  v_cat_salary UUID;
  v_cat_rent   UUID;
  v_cat_purch  UUID;
  v_cat_util   UUID;
  v_cat_misc   UUID;
  v_cat_ads    UUID;
  v_cat_tax    UUID;
  v_emp_1      UUID;
  v_emp_2      UUID;
  v_emp_3      UUID;
  v_cp_1       UUID;
  v_cp_2       UUID;
  v_cp_3       UUID;

  v_date       DATE;
  v_year       INT;
  v_month      INT;
  v_dow        INT;
  v_shift_id   UUID;
  v_shift_num  SMALLINT := 1;
  v_base       BIGINT;
  v_mult       NUMERIC;
  v_z_cash     BIGINT;
  v_z_card     BIGINT;
  v_z_sbp      BIGINT;
  v_z_total    BIGINT;
  v_f_cash     BIGINT;
  v_f_card     BIGINT;
  v_f_sbp      BIGINT;
  v_diff       BIGINT;
  v_emp_cur    UUID;
  v_emps       UUID[];
BEGIN

  -- ── Найти пользователя ───────────────────────────────────────────────
  SELECT id INTO v_user_id
    FROM auth.users
   WHERE LOWER(email) = LOWER('Auron@mail.ru')
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Пользователь Auron@mail.ru не найден. Сначала зарегистрируйтесь.';
  END IF;

  -- ── Организация ──────────────────────────────────────────────────────
  INSERT INTO public.organizations (name)
    VALUES ('Way Market')
    RETURNING id INTO v_org_id;

  -- Убедимся что профиль создан
  INSERT INTO public.users (id, name)
    VALUES (v_user_id, 'Владелец')
    ON CONFLICT (id) DO UPDATE SET name = 'Владелец';

  INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'owner');

  -- ── Счета ────────────────────────────────────────────────────────────
  INSERT INTO public.accounts (org_id, name, icon, color, sort_order)
    VALUES (v_org_id, 'Наличные', '💵', '#30D158', 1)
    RETURNING id INTO v_acc_cash;

  INSERT INTO public.accounts (org_id, name, icon, color, sort_order)
    VALUES (v_org_id, 'Расч. счёт', '🏦', '#5E5CE6', 2)
    RETURNING id INTO v_acc_bank;

  INSERT INTO public.accounts (org_id, name, icon, color, sort_order)
    VALUES (v_org_id, 'Карта', '💳', '#FF9F0A', 3)
    RETURNING id INTO v_acc_card;

  INSERT INTO public.accounts (org_id, name, icon, color, sort_order)
    VALUES (v_org_id, 'СБП', '📱', '#64D2FF', 4)
    RETURNING id INTO v_acc_sbp;

  -- ── Категории ────────────────────────────────────────────────────────
  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Z-отчёт', 'income', '🧾', '#5E5CE6')
    RETURNING id INTO v_cat_sales;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'ЗП', 'expense', '👥', '#8B5CF6')
    RETURNING id INTO v_cat_salary;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Аренда', 'expense', '🏠', '#F59E0B')
    RETURNING id INTO v_cat_rent;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Закупка', 'expense', '🛒', '#0EA5E9')
    RETURNING id INTO v_cat_purch;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Коммуналка', 'expense', '💡', '#EAB308')
    RETURNING id INTO v_cat_util;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Хозрасходы', 'expense', '🔧', '#6B7280')
    RETURNING id INTO v_cat_misc;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Реклама', 'expense', '📢', '#EC4899')
    RETURNING id INTO v_cat_ads;

  INSERT INTO public.categories (org_id, name, type, icon, color)
    VALUES (v_org_id, 'Налоги', 'expense', '🏛', '#DC2626')
    RETURNING id INTO v_cat_tax;

  -- ── Сотрудники ───────────────────────────────────────────────────────
  INSERT INTO public.employees (org_id, full_name, short_name, role, salary, phone)
    VALUES (v_org_id, 'Иванова Анна Сергеевна', 'Иванова А.', 'Продавец', 5500000, '+7 (916) 111-22-33')
    RETURNING id INTO v_emp_1;

  INSERT INTO public.employees (org_id, full_name, short_name, role, salary, phone)
    VALUES (v_org_id, 'Петров Виктор Иванович', 'Петров В.', 'Продавец', 5000000, '+7 (916) 222-33-44')
    RETURNING id INTO v_emp_2;

  INSERT INTO public.employees (org_id, full_name, short_name, role, salary, phone)
    VALUES (v_org_id, 'Сидорова Мария Петровна', 'Сидорова М.', 'Старший продавец', 6000000, '+7 (916) 333-44-55')
    RETURNING id INTO v_emp_3;

  v_emps := ARRAY[v_emp_1, v_emp_2, v_emp_3];

  -- ── Поставщики / торговые представители ─────────────────────────────
  INSERT INTO public.counterparties (org_id, name, type, phone, note)
    VALUES (v_org_id, 'ООО ПродТорг', 'supplier', '+7 (495) 123-45-67', 'Основной поставщик продуктов')
    RETURNING id INTO v_cp_1;

  INSERT INTO public.counterparties (org_id, name, type, phone, note)
    VALUES (v_org_id, 'ИП Смирнов А.В.', 'supplier', '+7 (916) 234-56-78', 'Молочная продукция')
    RETURNING id INTO v_cp_2;

  INSERT INTO public.counterparties (org_id, name, type, phone, note)
    VALUES (v_org_id, 'ООО АгроСнаб', 'supplier', '+7 (499) 345-67-89', 'Овощи и фрукты')
    RETURNING id INTO v_cp_3;

  -- ── Данные по долгам ─────────────────────────────────────────────────
  INSERT INTO public.debt_entries
    (org_id, counterparty_id, type, amount_kopecks, date, account_id, comment, status)
  VALUES
    (v_org_id, v_cp_1, 'initial', 5000000, '2023-01-01', v_acc_cash, 'Начальный долг', 'active'),
    (v_org_id, v_cp_1, 'debt',    32000000, '2025-09-15', v_acc_cash, 'Закупка сентябрь', 'active'),
    (v_org_id, v_cp_1, 'payment', 20000000, '2025-10-01', v_acc_cash, 'Оплата частичная', 'done'),
    (v_org_id, v_cp_1, 'debt',    28000000, '2025-10-20', v_acc_cash, 'Закупка октябрь', 'active'),
    (v_org_id, v_cp_2, 'debt',    15000000, '2025-10-05', v_acc_cash, 'Молочка октябрь', 'active'),
    (v_org_id, v_cp_2, 'payment', 15000000, '2025-10-18', v_acc_cash, 'Оплата полностью', 'done'),
    (v_org_id, v_cp_2, 'debt',    18000000, '2025-11-01', v_acc_cash, 'Молочка ноябрь', 'active'),
    (v_org_id, v_cp_3, 'debt',    22000000, '2025-10-10', v_acc_cash, 'Овощи-фрукты', 'active'),
    (v_org_id, v_cp_3, 'payment', 10000000, '2025-10-25', v_acc_cash, 'Аванс', 'done');

  -- ════════════════════════════════════════════════════════════════════
  -- ГЕНЕРАЦИЯ 3 ЛЕТ ДАННЫХ (2023-01-01 → 2025-12-31)
  -- ════════════════════════════════════════════════════════════════════
  v_date := '2023-01-01'::DATE;

  WHILE v_date <= '2025-12-31'::DATE LOOP
    v_year  := EXTRACT(YEAR  FROM v_date)::INT;
    v_month := EXTRACT(MONTH FROM v_date)::INT;
    v_dow   := EXTRACT(DOW   FROM v_date)::INT; -- 0=вс, 1=пн...6=сб

    -- Сезонный коэффициент выручки
    v_mult := CASE v_month
      WHEN 1  THEN 1.30  -- Январь — после праздников
      WHEN 2  THEN 1.10
      WHEN 3  THEN 1.05
      WHEN 4  THEN 0.95
      WHEN 5  THEN 0.90
      WHEN 6  THEN 0.85  -- Лето — спад
      WHEN 7  THEN 0.82
      WHEN 8  THEN 0.88
      WHEN 9  THEN 1.00
      WHEN 10 THEN 1.10
      WHEN 11 THEN 1.20
      WHEN 12 THEN 1.40  -- Декабрь — пик
      ELSE 1.0
    END;

    -- Рост по годам
    v_mult := v_mult * CASE v_year
      WHEN 2023 THEN 1.00
      WHEN 2024 THEN 1.14
      WHEN 2025 THEN 1.28
      ELSE 1.0
    END;

    -- ── Рабочий день (не воскресенье) ────────────────────────────────
    IF v_dow <> 0 THEN
      v_emp_cur := v_emps[ 1 + (EXTRACT(DAY FROM v_date)::INT % 3) ];

      -- Базовая выручка дня: 45 000 – 80 000 руб
      v_base := ((4500000 + (random() * 3500000)::BIGINT) * v_mult)::BIGINT;

      -- Разбивка по способам оплаты
      v_z_cash := (v_base * (0.32 + random() * 0.08))::BIGINT;
      v_z_card := (v_base * (0.38 + random() * 0.08))::BIGINT;
      v_z_sbp  := v_base - v_z_cash - v_z_card;
      v_z_total := v_z_cash + v_z_card + v_z_sbp;

      -- Фактические суммы с редкими расхождениями
      v_f_cash := v_z_cash + CASE
        WHEN random() < 0.08 THEN ((-300 - random() * 1700) * 100)::BIGINT  -- недостача
        WHEN random() < 0.04 THEN ((100 + random() * 500) * 100)::BIGINT    -- излишек
        ELSE 0
      END;
      v_f_card := v_z_card;
      v_f_sbp  := v_z_sbp;
      v_diff   := (v_f_cash + v_f_card + v_f_sbp) - v_z_total;

      -- Вставить смену
      INSERT INTO public.shifts (
        org_id, date, shift_num, employee_id,
        z_cash_kopecks, z_card_kopecks, z_sbp_kopecks, z_total_kopecks,
        fact_cash_kopecks, fact_card_kopecks, fact_sbp_kopecks,
        diff_kopecks, withdrawals_json, status, created_at
      ) VALUES (
        v_org_id, v_date, v_shift_num, v_emp_cur,
        v_z_cash, v_z_card, v_z_sbp, v_z_total,
        v_f_cash, v_f_card, v_f_sbp,
        v_diff, '[]'::JSONB, 'closed',
        v_date::TIMESTAMPTZ + INTERVAL '20 hours'
      ) RETURNING id INTO v_shift_id;

      -- Транзакции Z-отчёта (доходы)
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, employee_id, shift_id, comment, locked)
      VALUES
        (v_org_id, uuid_generate_v4(), v_date, 'income', v_z_cash, v_cat_sales, v_acc_cash, v_emp_cur, v_shift_id, 'Z-отчёт нал', TRUE),
        (v_org_id, uuid_generate_v4(), v_date, 'income', v_z_card, v_cat_sales, v_acc_card, v_emp_cur, v_shift_id, 'Z-отчёт карта', TRUE),
        (v_org_id, uuid_generate_v4(), v_date, 'income', v_z_sbp,  v_cat_sales, v_acc_sbp,  v_emp_cur, v_shift_id, 'Z-отчёт СБП', TRUE);

      v_shift_num := v_shift_num + 1;
    END IF;

    -- ── 1-е число месяца: аренда + коммуналка ────────────────────────
    IF EXTRACT(DAY FROM v_date) = 1 THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, comment)
      VALUES
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 8500000, v_cat_rent,
         v_acc_bank, 'Аренда ' || TO_CHAR(v_date, 'MM.YYYY')),
        (v_org_id, uuid_generate_v4(), v_date, 'expense',
         (750000 + (random() * 350000)::BIGINT), v_cat_util,
         v_acc_bank, 'Коммуналка ' || TO_CHAR(v_date, 'MM.YYYY'));

      -- Квартальные налоги (март, июнь, сентябрь, декабрь)
      IF v_month IN (3, 6, 9, 12) THEN
        INSERT INTO public.transactions
          (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, comment)
        VALUES
          (v_org_id, uuid_generate_v4(), v_date, 'expense',
           (180000 + (random() * 60000))::BIGINT * 100,
           v_cat_tax, v_acc_bank,
           'Налог УСН за квартал ' || TO_CHAR(v_date, 'Q') || ' кв. ' || v_year);
      END IF;
    END IF;

    -- ── 5-е число: аванс зарплата ────────────────────────────────────
    IF EXTRACT(DAY FROM v_date) = 5 THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, employee_id, comment)
      VALUES
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 2750000, v_cat_salary, v_acc_cash, v_emp_1, 'Аванс Иванова А. ' || TO_CHAR(v_date, 'MM.YYYY')),
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 2500000, v_cat_salary, v_acc_cash, v_emp_2, 'Аванс Петров В. ' || TO_CHAR(v_date, 'MM.YYYY')),
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 3000000, v_cat_salary, v_acc_cash, v_emp_3, 'Аванс Сидорова М. ' || TO_CHAR(v_date, 'MM.YYYY'));
    END IF;

    -- ── 20-е число: остаток зарплата ─────────────────────────────────
    IF EXTRACT(DAY FROM v_date) = 20 THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, employee_id, comment)
      VALUES
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 2750000, v_cat_salary, v_acc_cash, v_emp_1, 'ЗП Иванова А. ' || TO_CHAR(v_date, 'MM.YYYY')),
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 2500000, v_cat_salary, v_acc_cash, v_emp_2, 'ЗП Петров В. ' || TO_CHAR(v_date, 'MM.YYYY')),
        (v_org_id, uuid_generate_v4(), v_date, 'expense', 3000000, v_cat_salary, v_acc_cash, v_emp_3, 'ЗП Сидорова М. ' || TO_CHAR(v_date, 'MM.YYYY'));
    END IF;

    -- ── Закупки товара: понедельник и четверг ────────────────────────
    IF v_dow IN (1, 4) THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, comment)
      VALUES (
        v_org_id, uuid_generate_v4(), v_date, 'expense',
        ((1200000 + (random() * 600000)::BIGINT) * v_mult)::BIGINT,
        v_cat_purch, v_acc_cash,
        'Закупка ' || CASE (random() * 3)::INT
          WHEN 0 THEN 'ООО ПродТорг'
          WHEN 1 THEN 'ИП Смирнов А.В.'
          ELSE 'ООО АгроСнаб'
        END
      );
    END IF;

    -- ── Случайные хозрасходы (~2 раза в неделю) ──────────────────────
    IF random() < 0.29 THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, comment)
      VALUES (
        v_org_id, uuid_generate_v4(), v_date, 'expense',
        (3000 + (random() * 25000))::BIGINT * 100,
        v_cat_misc, v_acc_cash,
        CASE (random() * 5)::INT
          WHEN 0 THEN 'Хоз. материалы'
          WHEN 1 THEN 'Ремонт холодильника'
          WHEN 2 THEN 'Канцтовары'
          WHEN 3 THEN 'Упаковка и пакеты'
          ELSE 'Мелкий ремонт'
        END
      );
    END IF;

    -- ── Реклама (~2 раза в месяц) ────────────────────────────────────
    IF random() < 0.07 THEN
      INSERT INTO public.transactions
        (org_id, client_uuid, date, type, amount_kopecks, category_id, account_id, comment)
      VALUES (
        v_org_id, uuid_generate_v4(), v_date, 'expense',
        (5000 + (random() * 20000))::BIGINT * 100,
        v_cat_ads, v_acc_bank,
        CASE (random() * 3)::INT
          WHEN 0 THEN 'Реклама ВКонтакте'
          WHEN 1 THEN 'Листовки и баннер'
          ELSE 'Яндекс.Реклама'
        END
      );
    END IF;

    v_date := v_date + INTERVAL '1 day';
  END LOOP;

  -- ── Пересчёт балансов счетов ─────────────────────────────────────────
  UPDATE public.accounts a
     SET balance_kopecks = (
           SELECT COALESCE(
             SUM(CASE WHEN t.type = 'income' THEN t.amount_kopecks
                      ELSE -t.amount_kopecks END), 0)
             FROM public.transactions t
            WHERE t.account_id = a.id
              AND t.deleted_at IS NULL
         )
   WHERE a.org_id = v_org_id;

  RAISE NOTICE '✅ Демо-данные созданы! Организация: %, пользователь: %', v_org_id, v_user_id;
END $$;
