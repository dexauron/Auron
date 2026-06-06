-- ═══════════════════════════════════════════════════════════════════════════
-- AURON — ДЕМО-ДАННЫЕ ЗА 2 ГОДА (реалистичные: доходы и убытки, сезонность)
-- Запусти в Supabase → SQL Editor → New query → Run.
-- Генерирует данные для аккаунта auron@mail.ru:
--   • ежедневные смены (Z-отчёты) с сезонностью и ростом
--   • выручку, закупки (себестоимость), аренду, ЗП, коммуналку, рекламу, налоги
--   • разовые крупные траты → убыточные месяцы (лето + ремонт/оборудование)
--   • долги поставщикам
-- Повторный запуск безопасен: старые демо-данные (метка DEMO) удаляются.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_uid     uuid;
  v_org     uuid;
  acc_cash  uuid;
  acc_card  uuid;
  acc_bank  uuid;
  d         date;
  d_start   date := (CURRENT_DATE - INTERVAL '730 days')::date;
  m         int;
  dow       int;
  season    numeric;
  wk        numeric;
  growth    numeric;
  rev       bigint;     -- дневная выручка, руб
  cash_p    bigint;
  card_p    bigint;
  sbp_p     bigint;
  cogs      bigint;
  big       bigint;
  cashier   text;
  cashiers  text[] := ARRAY['Иванова А.','Петров В.','Сидорова М.'];
BEGIN
  -- 1) Пользователь и организация
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower('auron@mail.ru');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Пользователь auron@mail.ru не найден. Сначала войдите в приложение, затем повторите.';
  END IF;

  SELECT id INTO v_org FROM orgs WHERE user_id = v_uid ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO orgs(user_id, name) VALUES (v_uid, 'Демо магазин') RETURNING id INTO v_org;
  END IF;

  -- 2) Счета
  SELECT id INTO acc_cash FROM accounts WHERE org_id = v_org AND name = 'Наличные' LIMIT 1;
  IF acc_cash IS NULL THEN
    INSERT INTO accounts(org_id, name, icon, color) VALUES (v_org,'Наличные','💵','#30D158') RETURNING id INTO acc_cash;
  END IF;
  SELECT id INTO acc_card FROM accounts WHERE org_id = v_org AND name = 'Карта' LIMIT 1;
  IF acc_card IS NULL THEN
    INSERT INTO accounts(org_id, name, icon, color) VALUES (v_org,'Карта','💳','#0A84FF') RETURNING id INTO acc_card;
  END IF;
  SELECT id INTO acc_bank FROM accounts WHERE org_id = v_org AND name = 'Расчётный счёт' LIMIT 1;
  IF acc_bank IS NULL THEN
    INSERT INTO accounts(org_id, name, icon, color) VALUES (v_org,'Расчётный счёт','🏦','#5E5CE6') RETURNING id INTO acc_bank;
  END IF;

  -- 3) Очистка прошлых демо-данных
  DELETE FROM transactions WHERE org_id = v_org AND comment LIKE 'DEMO%';
  DELETE FROM shifts       WHERE org_id = v_org AND date >= d_start::text;
  DELETE FROM debts        WHERE org_id = v_org AND comment LIKE 'DEMO%';

  -- 4) Генерация по дням за 2 года
  FOR d IN SELECT generate_series(d_start, CURRENT_DATE, INTERVAL '1 day')::date LOOP
    m   := EXTRACT(MONTH FROM d);
    dow := EXTRACT(DOW   FROM d);

    -- сезонность: декабрь пик, лето провал
    season := CASE m
                WHEN 12 THEN 1.45 WHEN 11 THEN 1.12
                WHEN 1  THEN 0.90 WHEN 2  THEN 0.85
                WHEN 6  THEN 0.78 WHEN 7  THEN 0.70 WHEN 8 THEN 0.74
                ELSE 1.00 END;
    -- день недели: выходные выше
    wk := CASE WHEN dow IN (5,6) THEN 1.25 WHEN dow = 0 THEN 1.10 ELSE 0.95 END;
    -- рост бизнеса за 2 года (+30%)
    growth := 1 + 0.30 * (d - d_start)::numeric / 730;

    rev := round(60000 * season * wk * growth * (0.85 + random()*0.30));

    cash_p := round(rev * 0.45);
    card_p := round(rev * 0.40);
    sbp_p  := rev - cash_p - card_p;
    cashier := cashiers[1 + floor(random()*3)::int];

    -- смена (Z-отчёт)
    INSERT INTO shifts(org_id, date, shift_num, cashier, z_cash, z_card, z_sbp, z_total,
                       fact_cash, fact_card, fact_sbp, discrepancy)
      VALUES (v_org, d::text, 1, cashier, cash_p*100, card_p*100, sbp_p*100, rev*100,
              cash_p*100, card_p*100, sbp_p*100, (round((random()-0.5)*400))*100);

    -- выручка (доход)
    INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, employee, comment)
      VALUES (gen_random_uuid()::text, v_org, d::text, 'Доход', 'Z-отчёт', rev*100, acc_cash, cashier, 'DEMO выручка');

    -- закупка (себестоимость ~58%)
    cogs := round(rev * 0.58);
    INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
      VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Закупка', cogs*100, acc_card, 'DEMO закупка');

    -- аренда (5-е число)
    IF EXTRACT(DAY FROM d) = 5 THEN
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Аренда', 90000*100, acc_bank, 'DEMO аренда');
    END IF;
    -- зарплата (10-е)
    IF EXTRACT(DAY FROM d) = 10 THEN
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'ЗП', 150000*100, acc_bank, 'DEMO зарплата');
    END IF;
    -- коммуналка (15-е)
    IF EXTRACT(DAY FROM d) = 15 THEN
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Коммуналка', round(15000+random()*8000)*100, acc_bank, 'DEMO коммуналка');
    END IF;
    -- реклама (20-е, не каждый месяц)
    IF EXTRACT(DAY FROM d) = 20 AND random() < 0.6 THEN
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Реклама', round(15000+random()*30000)*100, acc_card, 'DEMO реклама');
    END IF;
    -- налоги (квартал, 25-е)
    IF m IN (3,6,9,12) AND EXTRACT(DAY FROM d) = 25 THEN
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Налоги', 80000*100, acc_bank, 'DEMO налоги');
    END IF;
    -- разовые крупные траты → убыточные месяцы (ремонт/оборудование)
    IF EXTRACT(DAY FROM d) = 12 AND random() < 0.07 THEN
      big := round(150000 + random()*250000);
      INSERT INTO transactions(uuid, org_id, date, type, category, amount, account_id, comment)
        VALUES (gen_random_uuid()::text, v_org, d::text, 'Расход', 'Хозрасходы', big*100, acc_bank, 'DEMO ремонт/оборудование');
    END IF;
  END LOOP;

  -- 5) Долги поставщикам (примеры)
  INSERT INTO debts(org_id, rep_name, type, amount, date, status, comment) VALUES
    (v_org, 'ООО Поставщик А', 'Закупка',  250000*100, (CURRENT_DATE-20)::text, 'active', 'DEMO'),
    (v_org, 'ООО Поставщик А', 'Оплата',  -100000*100, (CURRENT_DATE-10)::text, 'active', 'DEMO'),
    (v_org, 'ИП Сидоров',      'Закупка',  120000*100, (CURRENT_DATE-15)::text, 'active', 'DEMO'),
    (v_org, 'ТД Оптовик',      'Закупка',  340000*100, (CURRENT_DATE-8)::text,  'active', 'DEMO'),
    (v_org, 'ТД Оптовик',      'Оплата',  -200000*100, (CURRENT_DATE-3)::text,  'active', 'DEMO');

  -- 6) Пересчёт балансов счетов из транзакций
  UPDATE accounts a SET balance = COALESCE((
    SELECT SUM(CASE WHEN t.type = 'Доход' THEN t.amount
                    WHEN t.type = 'Расход' THEN -t.amount ELSE 0 END)
    FROM transactions t WHERE t.account_id = a.id), 0)
  WHERE a.org_id = v_org;

  RAISE NOTICE 'Демо-данные за 2 года созданы для организации %', v_org;
END $$;
