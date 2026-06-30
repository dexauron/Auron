#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Эталон логики «понимания» отчётов 1С (Продажи / Остатки / Цены поставщиков).
Эта же логика портируется в webapp (Apps Script): определить тип отчёта,
найти строку «Итого» и шапку, извлечь сводку.

Запуск:  python3 tools/parse_1c_reports.py файл.xls
Зависимость: xlrd (для .xls). Для .xlsx — openpyxl.
"""
import re, sys


def num(v):
    try:
        return float(v)
    except Exception:
        s = re.sub(r'[^\d.\-]', '', str(v).replace(' ', '').replace(',', '.'))
        return float(s) if s not in ('', '-', '.') else 0.0


def detect(rows):
    head = ' '.join(str(c) for r in rows[:4] for c in r).lower()
    if 'продажи' in head: return 'Продажи'
    if 'остатки' in head: return 'Остатки'
    if 'цены' in head:    return 'Цены'
    return '?'


def find_col(rows, label, exact=False, upto=12):
    """Ищет столбец по тексту шапки. exact=True — точное совпадение (важно,
    чтобы 'Сумма продажи' не схватила 'Приходная сумма продажи')."""
    lab = label.lower().strip()
    # сначала точное совпадение
    for r in range(min(upto, len(rows))):
        for c, v in enumerate(rows[r]):
            if str(v).lower().strip() == lab:
                return c
    if exact:
        return None
    for r in range(min(upto, len(rows))):
        for c, v in enumerate(rows[r]):
            if lab in str(v).lower():
                return c
    return None


def find_total(rows):
    for i, r in enumerate(rows):
        if str(r[0]).strip().lower() == 'итого':
            return i
    return None


def period(rows):
    for r in rows[:8]:
        for v in r:
            m = re.search(r'(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})', str(v))
            if m: return m.group(1) + ' – ' + m.group(2)
            m = re.search(r'(\d{2}\.\d{2}\.\d{4})', str(v))
            if m: return m.group(1)
    return '—'


def extract(rows):
    typ = detect(rows); tot = find_total(rows); per = period(rows)
    out = {'тип': typ, 'период': per, 'строк': len(rows)}
    T = rows[tot] if tot is not None else None
    if typ == 'Продажи':
        cR = find_col(rows, 'Сумма продажи', exact=True)   # выручка (точное!)
        cC = find_col(rows, 'Себестоимость продажи')        # COGS
        cP = find_col(rows, 'Прибыль', exact=True)
        cM = find_col(rows, 'Процент наценки')
        cQ = find_col(rows, 'Количество', exact=True)
        if T:
            rev = round(num(T[cR])) if cR is not None else 0
            cost = round(num(T[cC])) if cC is not None else 0
            out['выручка'] = rev
            out['себестоимость'] = cost
            out['валовая_прибыль'] = round(num(T[cP])) if cP is not None else rev - cost
            out['наценка_%'] = round(num(T[cM]), 1) if cM is not None else 0
            out['маржа_%'] = round(out['валовая_прибыль'] / rev * 100, 1) if rev else 0
            out['кол-во'] = round(num(T[cQ]), 1) if cQ is not None else 0
        hdr = next((i for i, r in enumerate(rows) if any('сумма продажи' in str(x).lower() for x in r)), 0)
        items = []
        for r in rows[hdr + 1: tot if tot else len(rows)]:
            nm = str(r[0]).strip()
            if nm and nm.lower() != 'итого' and cP is not None:
                items.append((nm, num(r[cP]), num(r[cR]) if cR is not None else 0))
        items.sort(key=lambda x: -x[1])
        out['топ_по_прибыли'] = [(n[:32], round(p), round(s)) for n, p, s in items[:5]]
    elif typ == 'Остатки':
        cQ = find_col(rows, 'Количество', exact=True)
        cZ = find_col(rows, 'Приходная сумма')
        cRoz = find_col(rows, 'Розничная сумма')
        if T:
            out['кол-во_на_складе'] = round(num(T[cQ]), 1) if cQ is not None else 0
            out['стоимость_закуп'] = round(num(T[cZ])) if cZ is not None else 0
            out['стоимость_розница'] = round(num(T[cRoz])) if cRoz is not None else 0
            out['потенц_наценка'] = out['стоимость_розница'] - out['стоимость_закуп']
    elif typ == 'Цены':
        cN = find_col(rows, 'Номенклатура'); cK = find_col(rows, 'Контрагент'); cP = find_col(rows, 'Цена')
        data = [r for r in rows[5:] if str(r[0]).strip()]
        out['позиций'] = len(data)
        if cP is not None:
            out['пример'] = [(str(r[cN])[:24], str(r[cK])[:20], round(num(r[cP]), 2)) for r in data[:3]]
    return out


def _load_xls(path):
    import xlrd
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    return [[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]


if __name__ == '__main__':
    for f in sys.argv[1:]:
        print('\n###', f, '###')
        for k, v in extract(_load_xls(f)).items():
            print(f'  {k}: {v}')
