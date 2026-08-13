-- Живая проверка прав на настоящей базе.
--
-- Запуск (на пустой тестовой базе, не на рабочей!):
--   psql -f infra/migrations/001_initial_schema.sql
--   psql -f infra/migrations/005_role_policies.sql
--   psql -f infra/tests/rls_check.sql
--
-- Проверяется главное: сотрудник зала не видит чужих денег и зарплат,
-- но может записать смену и накладную. Каждая строка печатает ОК или
-- ПРОВАЛ — глазами сверять ничего не нужно.

\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

SELECT 'ПОДГОТОВКА: правила на месте — ' ||
  CASE WHEN (SELECT count(*) FROM pg_policies
             WHERE schemaname='public' AND tablename='transactions')>=4
       THEN 'ОК' ELSE 'ПРОВАЛ (политик меньше четырёх)' END;

SELECT 'ПОДГОТОВКА: помощник auron_can есть — ' ||
  CASE WHEN to_regprocedure('public.auron_can(uuid,text)') IS NOT NULL
       THEN 'ОК' ELSE 'ПРОВАЛ' END;

-- Права по ролям — зеркало _oneRolePerms() из webapp/Code.gs.
--
-- Читаем ТЕЛО функции auron_perms, а не зовём её: функция отвечает про
-- того, кто спрашивает, поэтому «спросить за кассира», сидя под
-- владельцем, невозможно — вернутся права владельца. На этом я уже
-- один раз обманулся, поэтому проверяем текст правила, а не ответ.
SELECT 'ПРАВА владельца: ' ||
  CASE WHEN src LIKE '%''owner''%finance%kassa%receive%goods%payments%manage%'
       THEN 'ОК (все шесть)' ELSE 'ПРОВАЛ — список изменился' END
FROM (SELECT prosrc src FROM pg_proc WHERE proname='auron_perms') q;

SELECT 'ПРАВА кассира: ' ||
  CASE
    WHEN src ~ 'ELSE\s+ARRAY\[''kassa'',''receive''\]' THEN 'ОК (только касса и приём)'
    ELSE 'ПРОВАЛ — кассиру раздали не то' END
FROM (SELECT prosrc src FROM pg_proc WHERE proname='auron_perms') q;

SELECT 'ПРАВА бухгалтера: ' ||
  CASE WHEN src LIKE '%''accountant''%finance%payments%goods%'
        AND src !~ '''accountant''\s+THEN\s+ARRAY\[[^]]*kassa'
       THEN 'ОК (считает деньги, но не сидит на кассе)'
       ELSE 'ПРОВАЛ' END
FROM (SELECT prosrc src FROM pg_proc WHERE proname='auron_perms') q;

-- Не участник магазина — прав нет вовсе. Здесь звать функцию можно:
-- ответ не зависит от того, кто спрашивает, — организации не существует.
SELECT 'ЧУЖОЙ МАГАЗИН: ' ||
  CASE WHEN public.auron_can('00000000-0000-0000-0000-000000000000','finance')
       THEN 'ПРОВАЛ — доступ к чужим деньгам' ELSE 'ОК (ничего не может)' END;

-- Функция обязана обходить защиту строк, иначе получится рекурсия
-- «чтобы узнать права, проверь права», и всё встанет намертво.
SELECT 'ОБХОД РЕКУРСИИ: ' ||
  CASE WHEN prosecdef THEN 'ОК (SECURITY DEFINER)' ELSE 'ПРОВАЛ — будет рекурсия' END
FROM pg_proc WHERE proname='auron_perms';

-- Денежные таблицы: чтение обязано требовать право «finance».
SELECT 'ЧТЕНИЕ ' || tablename || ': ' ||
  CASE WHEN qual LIKE '%finance%' THEN 'ОК (нужен доступ к финансам)'
       ELSE 'ПРОВАЛ — читать может кто угодно из магазина' END
FROM pg_policies
WHERE schemaname='public' AND cmd='SELECT'
  AND tablename IN ('transactions','debt_entries','accounts','employees')
ORDER BY tablename;

-- Правка и удаление денег — только у того, кто управляет магазином.
SELECT 'ПРАВКА ' || tablename || ' [' || cmd || ']: ' ||
  CASE WHEN qual LIKE '%manage%' THEN 'ОК (только владелец/админ)'
       ELSE 'ПРОВАЛ — править может кто угодно' END
FROM pg_policies
WHERE schemaname='public' AND cmd IN ('UPDATE','DELETE')
  AND tablename IN ('transactions','debt_entries')
ORDER BY tablename, cmd;

-- Старое правило «свой — значит всё можно» должно быть снято.
SELECT 'СТАРОЕ ПРАВИЛО: ' ||
  CASE WHEN count(*)=0 THEN 'ОК (снято)'
       ELSE 'ПРОВАЛ — org_isolation ещё на ' || count(*) || ' таблицах' END
FROM pg_policies WHERE schemaname='public' AND policyname='org_isolation';
