-- ═══════════════════════════════════════════════════════════════════════════
-- AURON — ПОЛНЫЕ ДЕМО-ДАННЫЕ для продуктового магазина (аккаунт auron@mail.ru)
-- Заполняет ВСЁ: доходы/расходы (2 года), смены, долги поставщикам
-- (закупки+оплаты), обязательства для платёжного календаря, План-Факт (бюджет),
-- товары + партии + чеки с расчётом себестоимости (COGS), ДДС.
--
-- ЕДИНИЦЫ: базовая модель (transactions/shifts/debts/budget) — РУБЛИ.
--          розница (products/batches/receipts/cogs/obligations/cash_flow) — КОПЕЙКИ.
--
-- Запуск: Supabase → SQL Editor → New query → вставить → Run.
-- Повторный запуск безопасен (демо-метки удаляются).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_uid    uuid;
  v_org    uuid;
  acc_cash uuid; acc_card uuid; acc_bank uuid;
  d        date;
  d_start  date := (CURRENT_DATE - INTERVAL '730 days')::date;
  m int; dow int;
  season numeric; wk numeric; growth numeric;
  rev bigint; cash_p bigint; card_p bigint; sbp_p bigint; cogs bigint; big bigint;
  cashier text;
  cashiers text[] := ARRAY['Иванова А.','Петров В.','Сидорова М.'];
  -- товары продуктового магазина
  g_name  text[] := ARRAY['Молоко 1л','Хлеб белый','Яйца С1 10шт','Сыр Российский кг','Колбаса варёная',
                          'Масло слив. 180г','Сахар 1кг','Мука 2кг','Гречка 900г','Рис 900г',
                          'Чай 100 пак','Кофе 95г','Вода 5л','Сок 1л','Кола 1.5л',
                          'Чипсы 150г','Шоколад 90г','Печенье 300г','Бананы кг','Курица кг',
                          'Сметана 300г','Яблоки кг'];
  g_cat   text[] := ARRAY['Молочное','Хлеб','Бакалея','Молочное','Мясное',
                          'Молочное','Бакалея','Бакалея','Бакалея','Бакалея',
                          'Напитки','Напитки','Напитки','Напитки','Напитки',
                          'Снеки','Снеки','Снеки','Фрукты','Мясное',
                          'Молочное','Фрукты'];
  g_price int[]  := ARRAY[89,45,110,650,420, 180,75,120,95,110, 230,320,60,95,110, 130,95,120,95,240, 95,120];
  g_cost  int[]  := ARRAY[62,28,78,470,300, 130,55,85,65,75, 150,210,35,60,70, 80,55,75,60,175, 65,70];
  prod_ids  uuid[] := '{}';
  batch_ids uuid[] := '{}';
  pid uuid; bid uuid;
  i int; np int;
  n_rec int; n_items int; rcnt int; icnt int;
  rid uuid; riid uuid;
  idx int; qty numeric; price bigint; cost bigint; line bigint; rec_total bigint;
  op text; ts timestamptz; mdisc bigint;
  cf_rev uuid; cf_buy uuid; cf_rent uuid; cf_sal uuid; cf_tax uuid; cf_equip uuid;
BEGIN
  -- 1) Пользователь и организация
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower('auron@mail.ru');
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Пользователь auron@mail.ru не найден. Войдите в приложение и повторите.'; END IF;
  SELECT id INTO v_org FROM orgs WHERE user_id = v_uid ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN INSERT INTO orgs(user_id,name) VALUES(v_uid,'Продуктовый магазин') RETURNING id INTO v_org; END IF;

  -- 2) Счета
  SELECT id INTO acc_cash FROM accounts WHERE org_id=v_org AND name='Наличные' LIMIT 1;
  IF acc_cash IS NULL THEN INSERT INTO accounts(org_id,name,icon,color) VALUES(v_org,'Наличные','💵','#30D158') RETURNING id INTO acc_cash; END IF;
  SELECT id INTO acc_card FROM accounts WHERE org_id=v_org AND name='Карта' LIMIT 1;
  IF acc_card IS NULL THEN INSERT INTO accounts(org_id,name,icon,color) VALUES(v_org,'Карта','💳','#0A84FF') RETURNING id INTO acc_card; END IF;
  SELECT id INTO acc_bank FROM accounts WHERE org_id=v_org AND name='Расчётный счёт' LIMIT 1;
  IF acc_bank IS NULL THEN INSERT INTO accounts(org_id,name,icon,color) VALUES(v_org,'Расчётный счёт','🏦','#5E5CE6') RETURNING id INTO acc_bank; END IF;

  -- 3) Очистка прошлых демо
  DELETE FROM transactions WHERE org_id=v_org AND comment LIKE 'DEMO%';
  DELETE FROM shifts       WHERE org_id=v_org AND date >= d_start::text;
  DELETE FROM debts        WHERE org_id=v_org AND comment LIKE 'DEMO%';
  DELETE FROM obligations  WHERE org_id=v_org;
  DELETE FROM cash_flow    WHERE org_id=v_org;
  DELETE FROM receipts     WHERE org_id=v_org AND external_id LIKE 'DEMO%';   -- каскадом items+cogs
  DELETE FROM products     WHERE org_id=v_org AND sku LIKE 'DEMO-%';          -- каскадом batches

  -- ════════════════════════════════════════════════════════════════════════
  -- 4) ДОХОДЫ/РАСХОДЫ + СМЕНЫ за 2 года (РУБЛИ)
  -- ════════════════════════════════════════════════════════════════════════
  FOR d IN SELECT generate_series(d_start, CURRENT_DATE, INTERVAL '1 day')::date LOOP
    m := EXTRACT(MONTH FROM d); dow := EXTRACT(DOW FROM d);
    season := CASE m WHEN 12 THEN 1.45 WHEN 11 THEN 1.12 WHEN 1 THEN 0.90 WHEN 2 THEN 0.85
                     WHEN 6 THEN 0.78 WHEN 7 THEN 0.70 WHEN 8 THEN 0.74 ELSE 1.00 END;
    wk := CASE WHEN dow IN (5,6) THEN 1.25 WHEN dow=0 THEN 1.10 ELSE 0.95 END;
    growth := 1 + 0.30*(d - d_start)::numeric/730;
    rev := round(60000*season*wk*growth*(0.85+random()*0.30));
    cash_p := round(rev*0.45); card_p := round(rev*0.40); sbp_p := rev-cash_p-card_p;
    cashier := cashiers[1+floor(random()*3)::int];

    INSERT INTO shifts(org_id,date,shift_num,cashier,z_cash,z_card,z_sbp,z_total,fact_cash,fact_card,fact_sbp,discrepancy)
      VALUES(v_org,d::text,1,cashier,cash_p,card_p,sbp_p,rev,cash_p,card_p,sbp_p,round((random()-0.5)*400));

    INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,employee,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Доход','Z-отчёт',rev,acc_cash,cashier,'DEMO выручка');
    cogs := round(rev*0.58);
    INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Закупка',cogs,acc_cash,'DEMO закупка');

    IF EXTRACT(DAY FROM d)=5  THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Аренда',90000,acc_cash,'DEMO аренда'); END IF;
    IF EXTRACT(DAY FROM d)=10 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','ЗП',150000,acc_cash,'DEMO зарплата'); END IF;
    IF EXTRACT(DAY FROM d)=15 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Коммуналка',round(15000+random()*8000),acc_cash,'DEMO коммуналка'); END IF;
    IF EXTRACT(DAY FROM d)=20 AND random()<0.6 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Реклама',round(15000+random()*30000),acc_cash,'DEMO реклама'); END IF;
    IF m IN (3,6,9,12) AND EXTRACT(DAY FROM d)=25 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Налоги',80000,acc_cash,'DEMO налоги'); END IF;
    IF EXTRACT(DAY FROM d)=12 AND random()<0.07 THEN
      big := round(150000+random()*250000);
      INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
        VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Хозрасходы',big,acc_cash,'DEMO ремонт/оборудование'); END IF;
    -- УБЫТОЧНЫЕ ПЕРИОДЫ (как в реальном бизнесе):
    -- открытие/ремонт в первый месяц
    IF d = (d_start + 25) THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Хозрасходы',1000000,acc_cash,'DEMO открытие/ремонт магазина'); END IF;
    -- ежегодное летнее списание/обновление оборудования (июль)
    IF m=7 AND EXTRACT(DAY FROM d)=18 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Списание товаров',750000,acc_cash,'DEMO летнее списание/оборудование'); END IF;
    -- послепраздничный спад + крупный налог (февраль)
    IF m=2 AND EXTRACT(DAY FROM d)=14 THEN INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment)
      VALUES(gen_random_uuid()::text,v_org,d::text,'Расход','Налоги',500000,acc_cash,'DEMO годовой налог'); END IF;
  END LOOP;

  -- Инкассация: распределяем накопленную в кассе прибыль на счёт и карту (Перевод)
  SELECT COALESCE(SUM(CASE WHEN type='Доход' THEN amount WHEN type='Расход' THEN -amount ELSE 0 END),0)
    INTO big FROM transactions WHERE org_id=v_org AND account_id=acc_cash;
  IF big > 0 THEN
    INSERT INTO transactions(uuid,org_id,date,type,category,amount,account_id,comment) VALUES
      (gen_random_uuid()::text,v_org,CURRENT_DATE::text,'Расход','Перевод',round(big*0.60),acc_cash,'DEMO инкассация на счёт'),
      (gen_random_uuid()::text,v_org,CURRENT_DATE::text,'Доход','Перевод',round(big*0.60),acc_bank,'DEMO инкассация на счёт'),
      (gen_random_uuid()::text,v_org,CURRENT_DATE::text,'Расход','Перевод',round(big*0.15),acc_cash,'DEMO перевод на карту'),
      (gen_random_uuid()::text,v_org,CURRENT_DATE::text,'Доход','Перевод',round(big*0.15),acc_card,'DEMO перевод на карту');
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 5) ДОЛГИ ПОСТАВЩИКАМ — закупки и оплаты (РУБЛИ, таблица debts)
  -- ════════════════════════════════════════════════════════════════════════
  INSERT INTO debts(org_id,rep_name,type,amount,date,status,comment) VALUES
    (v_org,'ООО Молокозавод','Закупка', 180000,(CURRENT_DATE-55)::text,'active','DEMO'),
    (v_org,'ООО Молокозавод','Оплата', -120000,(CURRENT_DATE-40)::text,'active','DEMO'),
    (v_org,'ООО Молокозавод','Закупка', 160000,(CURRENT_DATE-20)::text,'active','DEMO'),
    (v_org,'ООО Молокозавод','Оплата',  -90000,(CURRENT_DATE-7)::text, 'active','DEMO'),
    (v_org,'Хлебокомбинат №3','Закупка', 95000,(CURRENT_DATE-30)::text,'active','DEMO'),
    (v_org,'Хлебокомбинат №3','Оплата',  -95000,(CURRENT_DATE-25)::text,'active','DEMO'),
    (v_org,'ТД Бакалея-Опт','Закупка', 240000,(CURRENT_DATE-18)::text,'active','DEMO'),
    (v_org,'ТД Бакалея-Опт','Оплата', -100000,(CURRENT_DATE-9)::text, 'active','DEMO'),
    (v_org,'Мясокомбинат','Закупка',   210000,(CURRENT_DATE-12)::text,'active','DEMO'),
    (v_org,'Мясокомбинат','Оплата',   -150000,(CURRENT_DATE-4)::text, 'active','DEMO'),
    (v_org,'Фрукты-Логистик','Закупка', 130000,(CURRENT_DATE-6)::text, 'active','DEMO');

  -- ════════════════════════════════════════════════════════════════════════
  -- 6) ОБЯЗАТЕЛЬСТВА — платёжный календарь (КОПЕЙКИ, таблица obligations)
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM 1;
  INSERT INTO counterparties(org_id,name,kind) VALUES
    (v_org,'ООО Молокозавод','supplier'),(v_org,'ТД Бакалея-Опт','supplier'),
    (v_org,'Мясокомбинат','supplier'),(v_org,'Кафе "Уют"','customer'),(v_org,'Столовая №5','customer')
  ON CONFLICT (org_id,name,kind) DO NOTHING;

  INSERT INTO obligations(org_id,counterparty_id,kind,amount,paid,due_date,status)
  SELECT v_org, c.id, 'payable', x.amount, x.paid, x.due, x.st
  FROM (VALUES
    ('ООО Молокозавод', 90000*100,      0, (CURRENT_DATE+3)::date,  'open'),
    ('ТД Бакалея-Опт',  140000*100, 40000*100, (CURRENT_DATE-2)::date,  'partial'),
    ('Мясокомбинат',     60000*100,      0, (CURRENT_DATE-6)::date,  'open'),
    ('ТД Бакалея-Опт',  120000*100,      0, (CURRENT_DATE+12)::date, 'open')
  ) AS x(nm,amount,paid,due,st)
  JOIN counterparties c ON c.org_id=v_org AND c.name=x.nm AND c.kind='supplier';

  INSERT INTO obligations(org_id,counterparty_id,kind,amount,paid,due_date,status)
  SELECT v_org, c.id, 'receivable', x.amount, 0, x.due, 'open'
  FROM (VALUES
    ('Кафе "Уют"',   45000*100, (CURRENT_DATE+5)::date),
    ('Столовая №5',  80000*100, (CURRENT_DATE-1)::date)
  ) AS x(nm,amount,due)
  JOIN counterparties c ON c.org_id=v_org AND c.name=x.nm AND c.kind='customer';

  -- ════════════════════════════════════════════════════════════════════════
  -- 7) ПЛАН-ФАКТ (бюджет по категориям, РУБЛИ в месяц, хранится в app_kv)
  -- ════════════════════════════════════════════════════════════════════════
  INSERT INTO app_kv(org_id,key,value) VALUES (v_org,'budget',
    '{"Закупка":1100000,"Аренда":90000,"ЗП":150000,"Коммуналка":25000,"Реклама":35000,"Налоги":80000,"Хозрасходы":50000}'::jsonb)
  ON CONFLICT (org_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();

  -- ════════════════════════════════════════════════════════════════════════
  -- 8) ТОВАРЫ + ПАРТИИ (КОПЕЙКИ)
  -- ════════════════════════════════════════════════════════════════════════
  np := array_length(g_name,1);
  FOR i IN 1..np LOOP
    INSERT INTO products(org_id,sku,barcode,name,category,unit,retail_price,cost_method)
      VALUES(v_org,'DEMO-'||lpad(i::text,3,'0'),'460'||lpad((1000000+i*137)::text,10,'0'),
             g_name[i],g_cat[i],'шт',g_price[i]*100,'fifo')
      RETURNING id INTO pid;
    INSERT INTO batches(org_id,product_id,received_at,qty_received,qty_remaining,unit_cost)
      VALUES(v_org,pid,(CURRENT_DATE-120)::timestamp,600,600,g_cost[i]*100)
      RETURNING id INTO bid;
    prod_ids  := array_append(prod_ids, pid);
    batch_ids := array_append(batch_ids, bid);
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════
  -- 9) ЧЕКИ + ПОЗИЦИИ + COGS за 90 дней (КОПЕЙКИ)
  -- ════════════════════════════════════════════════════════════════════════
  FOR d IN SELECT generate_series((CURRENT_DATE-90)::date, CURRENT_DATE, INTERVAL '1 day')::date LOOP
    dow := EXTRACT(DOW FROM d);
    n_rec := (CASE WHEN dow IN (5,6) THEN 14 ELSE 9 END) + floor(random()*6)::int;
    FOR rcnt IN 1..n_rec LOOP
      cashier := cashiers[1+floor(random()*3)::int];
      op := CASE WHEN random()<0.03 THEN 'refund' WHEN random()<0.01 THEN 'void' ELSE 'sale' END;
      ts := d::timestamp + make_interval(hours => (8+floor(random()*14))::int, mins => floor(random()*60)::int);
      mdisc := CASE WHEN op='sale' AND random()<0.05 THEN round(50+random()*300)*100 ELSE 0 END;
      INSERT INTO receipts(org_id,external_id,ts,register_id,cashier,op_type,total,manual_discount,is_flagged)
        VALUES(v_org,'DEMO-'||gen_random_uuid()::text,ts,'Касса 1',cashier,op,0,mdisc,(mdisc>0))
        RETURNING id INTO rid;
      rec_total := 0;
      IF op <> 'void' THEN          -- отменённый чек идёт без позиций
        n_items := 1+floor(random()*4)::int;
        FOR icnt IN 1..n_items LOOP
          idx := 1+floor(random()*np)::int;
          qty := 1+floor(random()*3)::int;
          price := g_price[idx]*100; cost := g_cost[idx]*100;
          line := round(qty*price);
          INSERT INTO receipt_items(receipt_id,product_id,qty,unit_price,discount,line_total)
            VALUES(rid,prod_ids[idx],qty,price,0,line) RETURNING id INTO riid;
          INSERT INTO cogs_allocations(receipt_item_id,batch_id,qty,unit_cost,cost_total)
            VALUES(riid,batch_ids[idx],qty,cost,round(qty*cost));
          IF op='refund' THEN
            UPDATE batches SET qty_remaining=qty_remaining+qty WHERE id=batch_ids[idx];   -- возврат на склад
          ELSE
            UPDATE batches SET qty_remaining=GREATEST(qty_remaining-qty,0) WHERE id=batch_ids[idx];
          END IF;
          rec_total := rec_total + line;
        END LOOP;
      END IF;
      UPDATE receipts SET total=(CASE WHEN op='refund' THEN -rec_total ELSE rec_total END) WHERE id=rid;
    END LOOP;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════
  -- 10) ДДС (Cash Flow) — статьи + помесячные движения за 12 мес (КОПЕЙКИ)
  -- ════════════════════════════════════════════════════════════════════════
  INSERT INTO cf_items(org_id,code,name,section,direction) VALUES
    (v_org,'выручка','Выручка от продаж','operating','income'),
    (v_org,'закупка','Закупка товара','operating','expense'),
    (v_org,'аренда','Аренда','operating','expense'),
    (v_org,'зарплата','Зарплата','operating','expense'),
    (v_org,'налоги','Налоги','operating','expense'),
    (v_org,'оборудование','Покупка оборудования','investing','expense')
  ON CONFLICT (org_id,code) DO NOTHING;
  SELECT id INTO cf_rev   FROM cf_items WHERE org_id=v_org AND code='выручка';
  SELECT id INTO cf_buy   FROM cf_items WHERE org_id=v_org AND code='закупка';
  SELECT id INTO cf_rent  FROM cf_items WHERE org_id=v_org AND code='аренда';
  SELECT id INTO cf_sal   FROM cf_items WHERE org_id=v_org AND code='зарплата';
  SELECT id INTO cf_tax   FROM cf_items WHERE org_id=v_org AND code='налоги';
  SELECT id INTO cf_equip FROM cf_items WHERE org_id=v_org AND code='оборудование';

  FOR i IN 0..11 LOOP
    d := (date_trunc('month', CURRENT_DATE) - make_interval(months => i))::date;
    INSERT INTO cash_flow(org_id,date,amount,cf_item_id) VALUES
      (v_org,(d+4),  round((1500000+random()*600000))*100, cf_rev),
      (v_org,(d+6),  round((900000+random()*300000))*100,  cf_buy),
      (v_org,(d+5),  90000*100,  cf_rent),
      (v_org,(d+10), 150000*100, cf_sal);
    IF EXTRACT(MONTH FROM d) IN (3,6,9,12) THEN
      INSERT INTO cash_flow(org_id,date,amount,cf_item_id) VALUES (v_org,(d+25), 80000*100, cf_tax);
    END IF;
    IF random()<0.2 THEN
      INSERT INTO cash_flow(org_id,date,amount,cf_item_id) VALUES (v_org,(d+12), round((150000+random()*200000))*100, cf_equip);
    END IF;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════
  -- 11) Пересчёт балансов счетов из транзакций (РУБЛИ)
  -- ════════════════════════════════════════════════════════════════════════
  UPDATE accounts a SET balance = COALESCE((
    SELECT SUM(CASE WHEN t.type='Доход' THEN t.amount WHEN t.type='Расход' THEN -t.amount ELSE 0 END)
    FROM transactions t WHERE t.account_id=a.id), 0)
  WHERE a.org_id=v_org;

  RAISE NOTICE 'Готово: демо-данные (2 года) для организации %', v_org;
END $$;
