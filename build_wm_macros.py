#!/usr/bin/env python3
"""
build_wm_macros.py — WAY MARKET cash book builder
Block 1 of 5: Foundation + БАЗА_ДДС

Outputs:
  WAY_MARKET.xlsx       — full workbook (rename to .xlsm after VBA import)
  WAY_MARKET_VBA.bas    — VBA code to import (created in Block 5)
"""

import os
import random
from datetime import date, timedelta

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.datavalidation import DataValidation

random.seed(42)

# ═══════════════════════════════════════════════════════════════
#  CONSTANTS
# ═══════════════════════════════════════════════════════════════

YEAR = 2025
SHOP = "WAY MARKET"
FONT = "Calibri"

TEAL   = "FF0B4F54"
TEAL_M = "FF0D9488"
TEAL_L = "FFE6FFFA"
GOLD   = "FFB45309"
GREEN  = "FF059669"
RED    = "FFDC2626"
AMBER  = "FFD97706"
PURPLE = "FF7C3AED"
NAVY   = "FF111827"
WHITE  = "FFFFFFFF"
GRAY_L = "FFF9FAFB"
GRAY_M = "FFE5E7EB"
GRAY_D = "FF6B7280"
BLUE   = "FF1D4ED8"

FMT_RUB  = '#,##0\\ ₽'
FMT_DATE = 'DD.MM.YYYY'

CASHIERS     = ["Айгуль", "Зарина", "Данияр"]
SHIFTS       = ["Утро", "Вечер"]
PAY_METHODS  = ["Наличные", "Карта", "Перевод"]
SUPPLIERS    = ["ТД Метро", "Лента", "Вкусвилл", "Магнит", "Х5 Ритейл", "Юнилевер"]
CATS_EXPENSE = ["ЗП", "Аренда", "Налоги", "Интернет", "Закуп товара",
                "Оплата ТП", "Коммуналка", "Реклама", "Другое"]
TYPES_ALL    = ["Приход", "Расход", "Долг"]
MONTHS_RU    = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

MONTH_FACTOR = {
    1: 1.15, 2: 1.05, 3: 1.10, 4: 0.90, 5: 0.88, 6: 0.85,
    7: 0.90, 8: 0.92, 9: 0.95, 10: 1.00, 11: 1.05, 12: 1.25,
}

TYPE_COLORS = {"Приход": GREEN, "Расход": RED, "Долг": AMBER}

# ═══════════════════════════════════════════════════════════════
#  STYLE FACTORIES
# ═══════════════════════════════════════════════════════════════

def mkfill(color):
    return PatternFill("solid", fgColor=color)


def mkfont(color=NAVY, size=10, bold=False):
    return Font(name=FONT, size=size, bold=bold, color=color)


def mkalign(h="left", v="center", wrap=False):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap)


def mkborder(style="thin", color="FFD1D5DB"):
    s = Side(style=style, color=color)
    return Border(left=s, right=s, top=s, bottom=s)


# ═══════════════════════════════════════════════════════════════
#  SHEET HELPERS
# ═══════════════════════════════════════════════════════════════

def set_widths(ws, pairs):
    for col, w in pairs:
        ws.column_dimensions[col].width = w


def sheet_title(ws, text, subtitle="", ncols=9):
    cl = get_column_letter(ncols)
    ws.merge_cells(f"A1:{cl}1")
    c = ws.cell(1, 1, text)
    c.fill = mkfill(TEAL)
    c.font = mkfont(WHITE, 16, True)
    c.alignment = mkalign("left", "center")
    ws.row_dimensions[1].height = 38
    if subtitle:
        ws.merge_cells(f"A2:{cl}2")
        c = ws.cell(2, 1, subtitle)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 10)
        c.alignment = mkalign("left", "center")
        ws.row_dimensions[2].height = 20


def sec_hdr(ws, row, text, size=11, bg=TEAL, fg=WHITE,
            ncols=9, height=22, bold=True):
    ws.merge_cells(start_row=row, start_column=1,
                   end_row=row, end_column=ncols)
    c = ws.cell(row, 1, text)
    c.fill = mkfill(bg)
    c.font = mkfont(fg, size, bold)
    c.alignment = mkalign("left", "center")
    ws.row_dimensions[row].height = height


def tbl_hdr(ws, row, headers, bg=TEAL_M, fg=WHITE, height=20, start_col=1):
    for i, h in enumerate(headers, start_col):
        c = ws.cell(row, i, h)
        c.fill = mkfill(bg)
        c.font = mkfont(fg, 10, True)
        c.alignment = mkalign("center", "center")
        c.border = mkborder()
    ws.row_dimensions[row].height = height


def d_cell(ws, row, col, v, alt=False, halign="left", fmt=None,
           color=None, bold=False):
    c = ws.cell(row, col, v)
    c.fill = mkfill(GRAY_L if alt else WHITE)
    c.font = mkfont(color or NAVY, 10, bold)
    c.alignment = mkalign(halign, "center")
    c.border = mkborder()
    if fmt:
        c.number_format = fmt
    return c


# ═══════════════════════════════════════════════════════════════
#  DEMO DATA GENERATION
# ═══════════════════════════════════════════════════════════════

def rr(lo, hi, step=100):
    """Random rounded number between lo and hi."""
    lo_s = max(1, int(lo / step))
    hi_s = max(1, int(hi / step))
    if lo_s > hi_s:
        hi_s = lo_s
    return random.randint(lo_s, hi_s) * step


def last_day(m, y=YEAR):
    if m == 2:
        return 28
    if m in (4, 6, 9, 11):
        return 30
    return 31


def gen_baza():
    """Generate full-year demo data for БАЗА_ДДС.
    Returns list of tuples: (date, shift, cashier, type, cat, method, amount, disc, comment)
    """
    rows = []

    # ─── ПРИХОД (revenue) ───
    d = date(YEAR, 1, 1)
    while d <= date(YEAR, 12, 31):
        mf = MONTH_FACTOR[d.month]
        for shift in SHIFTS:
            cashier = random.choice(CASHIERS)
            shift_base = rr(70000 * mf, 140000 * mf, 1000)
            sf = 0.42 if shift == "Утро" else 0.58
            total = int(shift_base * sf)

            cp = random.uniform(0.34, 0.44)
            kp = random.uniform(0.46, 0.56)
            tp = max(0.0, 1.0 - cp - kp)

            for method, pct in [("Наличные", cp), ("Карта", kp), ("Перевод", tp)]:
                amt = round(total * pct / 100) * 100
                disc = 0
                if method == "Наличные" and random.random() < 0.12:
                    disc = random.choice([-200, -100, -50, 50, 100, 200])
                rows.append((d, shift, cashier, "Приход", "Продажи",
                             method, amt, disc, ""))
        d += timedelta(1)

    # ─── FIXED MONTHLY EXPENSES ───
    for m in range(1, 13):
        ld = last_day(m)
        # ЗП (advance + main)
        for day, amt, cmt in [
            (random.randint(10, 12), rr(40000, 50000), "Аванс"),
            (random.randint(25, ld), rr(95000, 110000), "Зарплата"),
        ]:
            rows.append((date(YEAR, m, day), "Утро", random.choice(CASHIERS),
                         "Расход", "ЗП", "Наличные", amt, 0, cmt))

        rows.append((date(YEAR, m, random.randint(1, 3)), "Утро",
                     random.choice(CASHIERS), "Расход", "Аренда", "Перевод",
                     80000, 0, f"Аренда {m:02d}.{YEAR}"))

        rows.append((date(YEAR, m, 10), "Утро", random.choice(CASHIERS),
                     "Расход", "Интернет", "Перевод", 3500, 0, "Провайдер"))

        rows.append((date(YEAR, m, 15), "Утро", random.choice(CASHIERS),
                     "Расход", "Коммуналка", "Перевод",
                     rr(14000, 22000, 500), 0, ""))

        if m in (1, 4, 7, 10):
            rows.append((date(YEAR, m, 20), "Утро", random.choice(CASHIERS),
                         "Расход", "Налоги", "Перевод",
                         rr(35000, 55000), 0, "Квартальный налог"))

        rows.append((date(YEAR, m, random.randint(5, 15)), "Утро",
                     random.choice(CASHIERS), "Расход", "Реклама", "Перевод",
                     rr(5000, 15000), 0, ""))

    # ─── CASH GOODS PURCHASE (main COGS) ───
    d = date(YEAR, 1, 1)
    while d <= date(YEAR, 12, 31):
        # 1-2 purchases per day to cover realistic COGS
        for _ in range(random.randint(1, 2)):
            if random.random() < 0.75:
                mf = MONTH_FACTOR[d.month]
                rows.append((d, random.choice(SHIFTS), random.choice(CASHIERS),
                             "Расход", "Закуп товара",
                             random.choice(["Наличные", "Карта", "Перевод"]),
                             rr(35000 * mf, 90000 * mf), 0,
                             random.choice(SUPPLIERS)))
        d += timedelta(1)

    # ─── CREDIT PURCHASE (ДОЛГ) ───
    for m in range(1, 13):
        ld = last_day(m)
        mf = MONTH_FACTOR[m]
        for _ in range(random.randint(2, 4)):
            sup = random.choice(SUPPLIERS)
            rows.append((date(YEAR, m, random.randint(1, ld)), "Утро",
                         random.choice(CASHIERS), "Долг", "Закуп товара", sup,
                         rr(60000 * mf, 150000 * mf), 0, "Закуп в долг"))

    # ─── DEBT PAYMENTS ───
    for m in range(1, 13):
        ld = last_day(m)
        for _ in range(random.randint(1, 2)):
            rows.append((date(YEAR, m, random.randint(10, ld)), "Утро",
                         random.choice(CASHIERS), "Расход", "Оплата ТП", "Перевод",
                         rr(30000, 70000), 0, random.choice(SUPPLIERS)))

    # ─── MISC ───
    for m in range(1, 13):
        ld = last_day(m)
        for _ in range(random.randint(2, 5)):
            rows.append((date(YEAR, m, random.randint(1, ld)),
                         random.choice(SHIFTS), random.choice(CASHIERS),
                         "Расход", "Другое",
                         random.choice(["Наличные", "Карта"]),
                         rr(300, 5000, 100), 0, ""))

    rows.sort(key=lambda r: (r[0], r[1], r[3]))
    return rows


def gen_vyplaty():
    """Generate ЗАПИСЬ_ВЫПЛАТ demo data."""
    rows = []
    today = date.today()
    idx = 1
    for m in range(1, 13):
        ld = last_day(m)
        for sup in random.sample(SUPPLIERS, random.randint(2, 4)):
            pd = date(YEAR, m, random.randint(10, min(25, ld)))
            amt = rr(30000, 80000)
            if pd < today and random.random() > 0.25:
                status = "Оплачено"
            else:
                status = "Запланировано"
            fd = None
            if status == "Оплачено":
                fd = date(YEAR, m, min(pd.day + random.randint(0, 5), ld))
            rows.append({
                "idx": idx, "plan_date": pd, "supplier": sup,
                "amount": amt, "status": status,
                "invoice": f"НК-{YEAR}-{idx:04d}",
                "method": random.choice(["Перевод", "Наличные"]),
                "fact_date": fd, "comment": "",
            })
            idx += 1
    rows.sort(key=lambda r: r["plan_date"])
    return rows


# ═══════════════════════════════════════════════════════════════
#  BLOCK 1: БАЗА_ДДС
# ═══════════════════════════════════════════════════════════════

BAZA_HEADERS = ["Дата", "Смена", "Кассир", "Тип", "Категория",
                "Способ оплаты", "Сумма", "Расхождение", "Комментарий"]
BAZA_FMTS = [FMT_DATE, None, None, None, None, None, FMT_RUB, FMT_RUB, None]
BAZA_ALNS = ["center", "center", "center", "center", "left",
             "center", "right", "right", "left"]


def build_baza(ws, rows):
    # Title
    sheet_title(ws, "  БАЗА ДДС",
                "  Единая база всех финансовых операций магазина")

    # Stats row 3
    ws.row_dimensions[3].height = 18
    ws.merge_cells("A3:D3")
    c = ws.cell(3, 1, f"Магазин: {SHOP}   |   Год: {YEAR}")
    c.font = mkfont(GRAY_D, 9)
    c.alignment = mkalign("left", "center")

    ws.merge_cells("E3:I3")
    c = ws.cell(3, 5)
    c.value = ('=COUNTA(tblБаза[Дата])&" записей  |  Обновлено: "'
               '&TEXT(MAX(tblБаза[Дата]),"DD.MM.YYYY")')
    c.font = mkfont(GRAY_D, 9)
    c.alignment = mkalign("right", "center")

    ws.row_dimensions[4].height = 5  # spacer

    # Header row 5
    tbl_hdr(ws, 5, BAZA_HEADERS)

    # Data rows from row 6
    for i, r in enumerate(rows):
        rn = 6 + i
        alt = (i % 2 == 1)
        d, shift, cashier, typ, cat, method, amt, disc, cmt = r

        vals = [d, shift, cashier, typ, cat, method, amt,
                disc if disc != 0 else None, cmt]

        for col, (v, fmt, aln) in enumerate(zip(vals, BAZA_FMTS, BAZA_ALNS), 1):
            c = d_cell(ws, rn, col, v, alt, aln, fmt)
            if col == 4:  # Тип
                c.font = mkfont(TYPE_COLORS.get(v, NAVY), 10, True)

        ws.row_dimensions[rn].height = 17

    # Named table — pre-sized to 3000 rows
    last_row = max(5 + len(rows), 3005)
    tbl = Table(displayName="tblБаза", ref=f"A5:I{last_row}")
    tbl.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight9",
        showFirstColumn=False, showLastColumn=False,
        showRowStripes=False, showColumnStripes=False
    )
    ws.add_table(tbl)

    ws.freeze_panes = "A6"
    set_widths(ws, [("A", 13), ("B", 10), ("C", 12), ("D", 12),
                    ("E", 18), ("F", 16), ("G", 14), ("H", 14), ("I", 25)])


# ═══════════════════════════════════════════════════════════════
#  BLOCK 2: ВВОД_КАССА + ВВОД_РАСХОДЫ
# ═══════════════════════════════════════════════════════════════

def _form_label(ws, row, col, text, ncols=1, bg=TEAL_L, fg=NAVY, size=10):
    """Label cell with light teal bg, bold text."""
    if ncols > 1:
        ws.merge_cells(start_row=row, start_column=col,
                       end_row=row, end_column=col + ncols - 1)
    c = ws.cell(row, col, text)
    c.fill = mkfill(bg)
    c.font = mkfont(fg, size, True)
    c.alignment = mkalign("left", "center")
    return c


def _form_input(ws, row, col, value=None, ncols=1, fmt=None, halign="left"):
    """Editable input cell with strong teal underline."""
    if ncols > 1:
        ws.merge_cells(start_row=row, start_column=col,
                       end_row=row, end_column=col + ncols - 1)
    c = ws.cell(row, col, value)
    c.fill = mkfill(WHITE)
    c.font = mkfont(NAVY, 11, True)
    c.alignment = mkalign(halign, "center")
    c.border = Border(
        left=Side(style="thin", color="FFD1D5DB"),
        right=Side(style="thin", color="FFD1D5DB"),
        top=Side(style="thin", color="FFD1D5DB"),
        bottom=Side(style="medium", color="FF0B4F54"),
    )
    if fmt:
        c.number_format = fmt
    return c


def _form_btn(ws, row, col, text, bg=GREEN, ncols=1, nrows=1, size=12):
    """Button-styled cell."""
    if ncols > 1 or nrows > 1:
        ws.merge_cells(start_row=row, start_column=col,
                       end_row=row + nrows - 1, end_column=col + ncols - 1)
    c = ws.cell(row, col, text)
    c.fill = mkfill(bg)
    c.font = mkfont(WHITE, size, True)
    c.alignment = mkalign("center", "center")
    c.border = Border(
        left=Side(style="thin", color=bg),
        right=Side(style="thin", color=bg),
        top=Side(style="thin", color=bg),
        bottom=Side(style="medium", color=NAVY),
    )
    return c


def _add_dv(ws, formula, cell_ref, show_error=True):
    """Attach data validation dropdown to a cell."""
    dv = DataValidation(type="list", formula1=formula, allow_blank=True)
    if show_error:
        dv.error = "Выберите значение из списка"
        dv.errorTitle = "Неверное значение"
        dv.showErrorMessage = True
    else:
        dv.showErrorMessage = False  # allow free-type for autocomplete fields
    ws.add_data_validation(dv)
    dv.add(cell_ref)


def build_vvod_kassa(ws):
    """ВВОД_КАССА — Form for daily cash register entry. 16 rows × 7 cols."""
    ws.sheet_view.showGridLines = False

    # Column widths (7 cols)
    set_widths(ws, [("A", 18), ("B", 14), ("C", 14), ("D", 14),
                    ("E", 14), ("F", 14), ("G", 14)])

    # Title block
    sheet_title(ws, "  ВВОД КАССЫ",
                "  Заполните данные смены и нажмите СОХРАНИТЬ", ncols=7)

    # Row 3: Дата | Смена | Кассир
    ws.row_dimensions[3].height = 30
    _form_label(ws, 3, 1, "  Дата:")
    _form_input(ws, 3, 2, value=None, fmt=FMT_DATE, halign="center")
    _form_label(ws, 3, 3, "  Смена:")
    _form_input(ws, 3, 4, value=None, halign="center")
    _form_label(ws, 3, 5, "  Кассир:")
    _form_input(ws, 3, 6, value=None, ncols=2, halign="center")

    # Data validations for B3, D3, F3
    _add_dv(ws, '"Утро,Вечер"', "D3")
    _add_dv(ws, '"' + ",".join(CASHIERS) + '"', "F3", show_error=False)  # autocomplete

    # Row 4: TODAY button at E4 (replaces mockup text)
    ws.row_dimensions[4].height = 26
    _form_btn(ws, 4, 5, "📅 СЕГОДНЯ", bg=BLUE, ncols=2, size=11)

    ws.row_dimensions[5].height = 8  # spacer

    # Row 6: section header
    sec_hdr(ws, 6, "  Z-ОТЧЁТ vs ФАКТ", size=11, bg=TEAL_M, ncols=7, height=24)

    # Row 7: column headers
    ws.row_dimensions[7].height = 24
    headers = ["  Способ оплаты", "Z-отчёт", "Факт", "Расхождение"]
    for i, h in enumerate(headers, 1):
        c = ws.cell(7, i, h)
        c.fill = mkfill(TEAL)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center" if i > 1 else "left", "center")
        c.border = mkborder()
    # E7-G7 padded
    for col in (5, 6, 7):
        ws.cell(7, col).fill = mkfill(TEAL)
        ws.cell(7, col).border = mkborder()

    # Rows 8-10: data rows for each payment method
    for i, method in enumerate(PAY_METHODS):
        rn = 8 + i
        ws.row_dimensions[rn].height = 28
        # Label
        c = ws.cell(rn, 1, f"  {method}")
        c.fill = mkfill(GRAY_L if i % 2 == 0 else WHITE)
        c.font = mkfont(NAVY, 11, True)
        c.alignment = mkalign("left", "center")
        c.border = mkborder()
        # Z-отчёт input
        _form_input(ws, rn, 2, value=0, fmt='#,##0', halign="right")
        # Факт input
        _form_input(ws, rn, 3, value=0, fmt='#,##0', halign="right")
        # Расхождение formula = Факт - Z
        c = ws.cell(rn, 4, f"=C{rn}-B{rn}")
        c.fill = mkfill(GRAY_L if i % 2 == 0 else WHITE)
        c.font = mkfont(NAVY, 11, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder()
        c.number_format = '#,##0;[Red]-#,##0'
        # Padding cells
        for col in (5, 6, 7):
            pc = ws.cell(rn, col)
            pc.fill = mkfill(GRAY_L if i % 2 == 0 else WHITE)
            pc.border = mkborder()

    # Row 11: ИТОГО
    ws.row_dimensions[11].height = 30
    c = ws.cell(11, 1, "  ИТОГО")
    c.fill = mkfill(TEAL_M)
    c.font = mkfont(WHITE, 12, True)
    c.alignment = mkalign("left", "center")
    c.border = mkborder()
    for col, formula in [(2, "=SUM(B8:B10)"), (3, "=SUM(C8:C10)"), (4, "=SUM(D8:D10)")]:
        c = ws.cell(11, col, formula)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 12, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder()
        c.number_format = '#,##0' if col != 4 else '#,##0;[Red]-#,##0'
    for col in (5, 6, 7):
        pc = ws.cell(11, col)
        pc.fill = mkfill(TEAL_M)
        pc.border = mkborder()

    # Row 12: spacer
    ws.row_dimensions[12].height = 8

    # Row 13: Выручка за смену (big highlight)
    ws.row_dimensions[13].height = 36
    _form_label(ws, 13, 1, "  Выручка за смену:", ncols=2, bg=GRAY_M, size=11)
    c = ws.cell(13, 3, "=C11")
    c.fill = mkfill(GREEN)
    c.font = mkfont(WHITE, 16, True)
    c.alignment = mkalign("center", "center")
    c.number_format = FMT_RUB
    c.border = mkborder()
    _form_label(ws, 13, 4, "  Комментарий:", bg=GRAY_M, size=11)
    _form_input(ws, 13, 5, value="", ncols=3)

    # Rows 14-15: spacer
    ws.row_dimensions[14].height = 12
    ws.row_dimensions[15].height = 12

    # Row 16: SAVE button (large, merged across A:G)
    ws.row_dimensions[16].height = 44
    _form_btn(ws, 16, 1, "💾  СОХРАНИТЬ КАССУ", bg=GREEN, ncols=7, size=14)


def build_vvod_rashody(ws):
    """ВВОД_РАСХОДЫ — Form for daily expenses + Закуп в долг section."""
    ws.sheet_view.showGridLines = False

    set_widths(ws, [("A", 18), ("B", 16), ("C", 16), ("D", 16)])

    sheet_title(ws, "  ВВОД РАСХОДОВ",
                "  Заполните операцию и нажмите СОХРАНИТЬ", ncols=4)

    # Row 3: Дата | TODAY
    ws.row_dimensions[3].height = 30
    _form_label(ws, 3, 1, "  Дата:")
    _form_input(ws, 3, 2, value=None, fmt=FMT_DATE, halign="center")
    _form_btn(ws, 3, 3, "📅 СЕГОДНЯ", bg=BLUE, ncols=2, size=11)

    ws.row_dimensions[4].height = 8  # spacer

    # Row 5: section header — Обычный расход
    sec_hdr(ws, 5, "  РАСХОД", size=11, bg=RED, ncols=4, height=24)

    # Row 6: Категория
    ws.row_dimensions[6].height = 30
    _form_label(ws, 6, 1, "  Категория:")
    _form_input(ws, 6, 2, ncols=3, halign="center")
    _add_dv(ws, '"' + ",".join(c for c in CATS_EXPENSE if c != "Оплата ТП" or True) + '"', "B6", show_error=False)  # autocomplete

    # Row 7: Способ оплаты
    ws.row_dimensions[7].height = 30
    _form_label(ws, 7, 1, "  Способ оплаты:")
    _form_input(ws, 7, 2, ncols=3, halign="center")
    _add_dv(ws, '"' + ",".join(PAY_METHODS) + '"', "B7")

    # Row 8: Сумма
    ws.row_dimensions[8].height = 30
    _form_label(ws, 8, 1, "  Сумма:")
    _form_input(ws, 8, 2, value=0, ncols=3, fmt=FMT_RUB, halign="right")

    # Row 9: Комментарий
    ws.row_dimensions[9].height = 30
    _form_label(ws, 9, 1, "  Комментарий:")
    _form_input(ws, 9, 2, value="", ncols=3, halign="left")

    # Row 10: spacer
    ws.row_dimensions[10].height = 12

    # Row 11: section header — Закуп в долг
    sec_hdr(ws, 11, "  ЗАКУП В ДОЛГ  (заполнять ТОЛЬКО если закуп товара в долг)",
            size=11, bg=AMBER, ncols=4, height=24)

    # Row 12: Поставщик
    ws.row_dimensions[12].height = 30
    _form_label(ws, 12, 1, "  Поставщик:")
    _form_input(ws, 12, 2, ncols=3, halign="center")
    _add_dv(ws, '"' + ",".join(SUPPLIERS) + '"', "B12", show_error=False)  # autocomplete

    # Row 13: Сумма долга
    ws.row_dimensions[13].height = 30
    _form_label(ws, 13, 1, "  Сумма долга:")
    _form_input(ws, 13, 2, value=0, ncols=3, fmt=FMT_RUB, halign="right")

    # Row 14: spacer
    ws.row_dimensions[14].height = 14

    # Row 15: hint
    ws.merge_cells("A15:D15")
    c = ws.cell(15, 1,
                "  Можно заполнить ТОЛЬКО один раздел: либо РАСХОД, либо ЗАКУП В ДОЛГ")
    c.fill = mkfill(GRAY_L)
    c.font = mkfont(GRAY_D, 9, False)
    c.alignment = mkalign("center", "center")
    ws.row_dimensions[15].height = 18

    # Row 16: SAVE button
    ws.row_dimensions[16].height = 44
    _form_btn(ws, 16, 1, "💾  СОХРАНИТЬ", bg=GREEN, ncols=4, size=14)


# ═══════════════════════════════════════════════════════════════
#  BLOCK 3: ЗАПИСЬ_ВЫПЛАТ + НАСТРОЙКИ
# ═══════════════════════════════════════════════════════════════

ZV_HEADERS = ["№", "Дата плановой оплаты", "Поставщик (ТП)", "Сумма",
              "Статус", "Накладная", "Способ оплаты",
              "Дата фактической оплаты", "Примечание"]
ZV_LAST_ROW = 506  # pre-allocate space


def build_zapis_vyplat(ws, rows):
    """ЗАПИСЬ_ВЫПЛАТ — Supplier payments tracker."""
    ws.sheet_view.showGridLines = False

    set_widths(ws, [("A", 6), ("B", 18), ("C", 18), ("D", 14),
                    ("E", 15), ("F", 14), ("G", 14), ("H", 18), ("I", 22)])

    sheet_title(ws, "  ЗАПИСЬ ВЫПЛАТ",
                "  Платежи поставщикам — план и факт", ncols=9)

    # Rows 3-4: KPI summary (4 tiles)
    tiles = [
        ("Запланировано", GREEN,
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         f'tblВыплаты[Дата плановой оплаты],">="&TODAY())'),
        ("Просрочено", RED,
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         f'tblВыплаты[Дата плановой оплаты],"<"&TODAY())'),
        ("Оплачено в году", BLUE,
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Оплачено")'),
        ("Долг общий (БАЗА)", AMBER,
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Долг")'
         f'-SUMIFS(tblБаза[Сумма],tblБаза[Категория],"Оплата ТП")'),
    ]

    ws.row_dimensions[3].height = 18
    ws.row_dimensions[4].height = 32
    for i, (lbl, color, formula) in enumerate(tiles):
        c1 = i * 2 + 1
        c2 = c1 + 1
        # Label row 3
        ws.merge_cells(start_row=3, start_column=c1, end_row=3, end_column=c2)
        c = ws.cell(3, c1, lbl)
        c.fill = mkfill(color)
        c.font = mkfont(WHITE, 9, True)
        c.alignment = mkalign("center", "center")
        # Value row 4
        ws.merge_cells(start_row=4, start_column=c1, end_row=4, end_column=c2)
        c = ws.cell(4, c1, formula)
        c.fill = mkfill(WHITE)
        c.font = mkfont(color, 14, True)
        c.alignment = mkalign("center", "center")
        c.number_format = FMT_RUB
        c.border = Border(
            left=Side(style="medium", color=color),
            right=Side(style="medium", color=color),
            bottom=Side(style="medium", color=color),
        )

    ws.row_dimensions[5].height = 8  # spacer

    # Row 6: Table header
    tbl_hdr(ws, 6, ZV_HEADERS, bg=PURPLE, height=36)
    # Wrap headers
    for col in range(1, 10):
        ws.cell(6, col).alignment = mkalign("center", "center", wrap=True)

    # Data rows from row 7
    PLAN_DATE_COL = 2
    STATUS_COL = 5
    FACT_DATE_COL = 8
    for i, r in enumerate(rows):
        rn = 7 + i
        alt = (i % 2 == 1)
        vals = [
            r["idx"],
            r["plan_date"],
            r["supplier"],
            r["amount"],
            r["status"],
            r["invoice"],
            r["method"],
            r["fact_date"],
            r["comment"],
        ]
        fmts = [None, FMT_DATE, None, FMT_RUB, None, None, None, FMT_DATE, None]
        alns = ["center", "center", "left", "right", "center",
                "center", "center", "center", "left"]
        for col, (v, fmt, aln) in enumerate(zip(vals, fmts, alns), 1):
            c = d_cell(ws, rn, col, v, alt, aln, fmt)
            # Color-code status
            if col == STATUS_COL:
                if v == "Оплачено":
                    c.font = mkfont(GREEN, 10, True)
                elif v == "Запланировано":
                    c.font = mkfont(BLUE, 10, True)
        ws.row_dimensions[rn].height = 18

    # Named table tblВыплаты
    tbl = Table(displayName="tblВыплаты", ref=f"A6:I{ZV_LAST_ROW}")
    tbl.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight9",
        showRowStripes=False, showColumnStripes=False,
    )
    ws.add_table(tbl)

    # Data validations for columns E (Статус) and G (Способ)
    dv_st = DataValidation(type="list", formula1='"Запланировано,Оплачено"',
                            allow_blank=True)
    ws.add_data_validation(dv_st)
    dv_st.add(f"E7:E{ZV_LAST_ROW}")

    dv_m = DataValidation(type="list", formula1='"Наличные,Карта,Перевод"',
                           allow_blank=True)
    ws.add_data_validation(dv_m)
    dv_m.add(f"G7:G{ZV_LAST_ROW}")

    dv_sup = DataValidation(type="list",
                            formula1='"' + ",".join(SUPPLIERS) + '"',
                            allow_blank=True)
    ws.add_data_validation(dv_sup)
    dv_sup.add(f"C7:C{ZV_LAST_ROW}")

    ws.freeze_panes = "A7"


def build_nastroyki(ws):
    """НАСТРОЙКИ — Parameters, lookups, plan-vs-fact table."""
    ws.sheet_view.showGridLines = False

    set_widths(ws, [("A", 4), ("B", 22), ("C", 16), ("D", 16), ("E", 16),
                    ("F", 16), ("G", 16), ("H", 16)])

    sheet_title(ws, "  НАСТРОЙКИ",
                "  Параметры, справочники, план постоянных расходов", ncols=8)

    # ── Р1: Параметры (rows 4-9) ──
    sec_hdr(ws, 4, "  Р1 · ПАРАМЕТРЫ", bg=TEAL, ncols=8, height=24)
    params = [
        ("Магазин:", SHOP),
        ("Год для дашборда:", YEAR),
        ("Год для Р8 (план vs факт):", YEAR),
        ("Начальный остаток кассы:", 0),
        ("Валюта:", "RUB"),
    ]
    for i, (lbl, val) in enumerate(params):
        rn = 5 + i
        ws.row_dimensions[rn].height = 22
        _form_label(ws, rn, 2, "  " + lbl)
        c = _form_input(ws, rn, 3, value=val, ncols=2, halign="left")
        if isinstance(val, (int, float)) and lbl.startswith("Начал"):
            c.number_format = FMT_RUB
    # Спейсер
    ws.row_dimensions[10].height = 10

    # ── Р4: Кассы / даты (row 11-13) ──
    sec_hdr(ws, 11, "  Р4 · ПЕРИОД РАБОТЫ", bg=TEAL, ncols=8, height=24)
    ws.row_dimensions[12].height = 22
    _form_label(ws, 12, 2, "  Дата открытия магазина:")
    _form_input(ws, 12, 3, value=date(YEAR, 1, 1), ncols=2,
                fmt=FMT_DATE, halign="center")
    ws.row_dimensions[13].height = 10

    # ── Р6: Пороги (row 14-19) ──
    sec_hdr(ws, 14, "  Р6 · ПОРОГИ (для сигналов)", bg=TEAL, ncols=8, height=24)
    thresholds = [
        ("Долг — внимание (₽):", 200000),
        ("Долг — критично (₽):", 500000),
        ("Дней до оплаты — внимание:", 7),
        ("Расхождение кассы — критично (₽):", 1000),
    ]
    for i, (lbl, val) in enumerate(thresholds):
        rn = 15 + i
        ws.row_dimensions[rn].height = 22
        _form_label(ws, rn, 2, "  " + lbl)
        c = _form_input(ws, rn, 3, value=val, ncols=2,
                        fmt=FMT_RUB if "₽" in lbl else "0",
                        halign="right")
    ws.row_dimensions[19].height = 10

    # ── Р7: Справочники (rows 20-45) ──
    sec_hdr(ws, 20, "  Р7 · СПРАВОЧНИКИ", bg=TEAL, ncols=8, height=24)

    # Sub-headers row 21
    sub_headers = ["", "Кассиры", "Категории расход", "Способы оплаты",
                   "Типы операций", "Месяцы", "Поставщики (см. Р9)", ""]
    ws.row_dimensions[21].height = 24
    for i, h in enumerate(sub_headers, 1):
        c = ws.cell(21, i, h)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center")
        c.border = mkborder()

    # Lookup data — 24 rows (22-45)
    columns_data = {
        2: CASHIERS,
        3: [c for c in CATS_EXPENSE],
        4: PAY_METHODS,
        5: TYPES_ALL,
        6: MONTHS_RU,
        7: SUPPLIERS,
    }
    for rn in range(22, 46):
        ws.row_dimensions[rn].height = 18
        idx = rn - 22
        for col, lst in columns_data.items():
            v = lst[idx] if idx < len(lst) else None
            d_cell(ws, rn, col, v,
                   alt=(idx % 2 == 1), halign="left")
        # Cols 1 and 8 padding
        for col in (1, 8):
            c = ws.cell(rn, col)
            c.fill = mkfill(GRAY_L if idx % 2 == 1 else WHITE)
            c.border = mkborder()

    ws.row_dimensions[46].height = 10

    # ── Р8: План-Факт постоянных расходов (rows 47-62) ──
    sec_hdr(ws, 47, "  Р8 · ПОСТОЯННЫЕ РАСХОДЫ — ПЛАН vs ФАКТ", bg=TEAL,
            ncols=8, height=24)

    # Header row 48
    ws.row_dimensions[48].height = 32
    p8_headers = ["", "Месяц", "ЗП план", "Аренда план", "Налоги план",
                  "Интернет план", "Коммуналка план", "ИТОГО план"]
    for i, h in enumerate(p8_headers, 1):
        c = ws.cell(48, i, h)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center", wrap=True)
        c.border = mkborder()

    plan_defaults = {
        "ЗП": 145000, "Аренда": 80000, "Налоги": 0,
        "Интернет": 3500, "Коммуналка": 18000,
    }
    quarterly_tax = 45000
    for i, mname in enumerate(MONTHS_RU):
        rn = 49 + i
        m = i + 1
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, m, alt, "center")
        d_cell(ws, rn, 2, mname, alt, "left")
        d_cell(ws, rn, 3, plan_defaults["ЗП"], alt, "right", FMT_RUB)
        d_cell(ws, rn, 4, plan_defaults["Аренда"], alt, "right", FMT_RUB)
        d_cell(ws, rn, 5, quarterly_tax if m in (1, 4, 7, 10) else 0,
               alt, "right", FMT_RUB)
        d_cell(ws, rn, 6, plan_defaults["Интернет"], alt, "right", FMT_RUB)
        d_cell(ws, rn, 7, plan_defaults["Коммуналка"], alt, "right", FMT_RUB)
        # ИТОГО plan
        c = d_cell(ws, rn, 8, f"=SUM(C{rn}:G{rn})", alt, "right", FMT_RUB)
        c.font = mkfont(NAVY, 10, True)

    # Fact sub-header (row 61)
    ws.row_dimensions[61].height = 12
    sec_hdr(ws, 62, "  Р8 · ФАКТ (из БАЗА_ДДС за год $C$7)", bg=TEAL_M,
            ncols=8, height=22)
    ws.row_dimensions[63].height = 32
    p8_fact_headers = ["", "Месяц", "ЗП факт", "Аренда факт", "Налоги факт",
                       "Интернет факт", "Коммуналка факт", "ИТОГО факт"]
    for i, h in enumerate(p8_fact_headers, 1):
        c = ws.cell(63, i, h)
        c.fill = mkfill(GRAY_M)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("center", "center", wrap=True)
        c.border = mkborder()

    cats_fact = ["ЗП", "Аренда", "Налоги", "Интернет", "Коммуналка"]
    for i, mname in enumerate(MONTHS_RU):
        rn = 64 + i
        m = i + 1
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, m, alt, "center")
        d_cell(ws, rn, 2, mname, alt, "left")
        for ci, cat in enumerate(cats_fact):
            col = 3 + ci
            formula = (
                f'=SUMPRODUCT('
                f'(YEAR(tblБаза[Дата])=$C$7)*'
                f'(MONTH(tblБаза[Дата])={m})*'
                f'(tblБаза[Тип]="Расход")*'
                f'(tblБаза[Категория]="{cat}")*'
                f'tblБаза[Сумма])'
            )
            c = d_cell(ws, rn, col, formula, alt, "right", FMT_RUB)
        # ИТОГО факт
        c = d_cell(ws, rn, 8, f"=SUM(C{rn}:G{rn})", alt, "right", FMT_RUB)
        c.font = mkfont(NAVY, 10, True)

    ws.row_dimensions[76].height = 10

    # ── Р9: Поставщики (rows 77+) ──
    sec_hdr(ws, 77, "  Р9 · ПОСТАВЩИКИ (ТП)", bg=TEAL, ncols=8, height=24)
    ws.row_dimensions[78].height = 24
    p9_hdr = ["", "№", "Название", "Контакт", "Условия оплаты", "", "", ""]
    for i, h in enumerate(p9_hdr, 1):
        c = ws.cell(78, i, h)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center")
        c.border = mkborder()

    for i, sup in enumerate(SUPPLIERS):
        rn = 79 + i
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, "", alt)
        d_cell(ws, rn, 2, i + 1, alt, "center")
        d_cell(ws, rn, 3, sup, alt, "left")
        d_cell(ws, rn, 4, f"+7 (495) {random.randint(100, 999)}-{random.randint(10, 99)}-{random.randint(10, 99)}",
               alt, "left")
        d_cell(ws, rn, 5, random.choice(["30 дней", "14 дней", "Предоплата", "По факту"]),
               alt, "left")
        for col in (6, 7, 8):
            d_cell(ws, rn, col, "", alt)

    # ── Автокомплит: вспомогательные колонки I, J, K (скрытые) ──
    # VBA записывает сюда отфильтрованные списки и указывает на них DV
    ac_lists = {
        9:  list(CASHIERS),      # I — Кассиры
        10: list(CATS_EXPENSE),  # J — Категории расходов
        11: list(SUPPLIERS),     # K — Поставщики
    }
    for col, items in ac_lists.items():
        for row_i, item in enumerate(items):
            ws.cell(row=1 + row_i, column=col, value=item)
        # Pad remaining rows with empty so VBA can safely clear a fixed range
        for row_i in range(len(items), 15):
            ws.cell(row=1 + row_i, column=col, value=None)
    # Hide these helper columns from view
    for col_letter in ("I", "J", "K"):
        ws.column_dimensions[col_letter].hidden = True


# ═══════════════════════════════════════════════════════════════
#  BLOCK 4a: ПУЛЬТ
# ═══════════════════════════════════════════════════════════════

def _kpi_tile(ws, row, col, ncols, label, formula, color,
              fmt=FMT_RUB, lbl_size=9, val_size=14):
    """Render a 2-row KPI tile (label + value)."""
    # Label
    ws.merge_cells(start_row=row, start_column=col,
                   end_row=row, end_column=col + ncols - 1)
    c = ws.cell(row, col, label)
    c.fill = mkfill(color)
    c.font = mkfont(WHITE, lbl_size, True)
    c.alignment = mkalign("center", "center")

    # Value
    ws.merge_cells(start_row=row + 1, start_column=col,
                   end_row=row + 1, end_column=col + ncols - 1)
    c = ws.cell(row + 1, col, formula)
    c.fill = mkfill(WHITE)
    c.font = mkfont(color, val_size, True)
    c.alignment = mkalign("center", "center")
    c.number_format = fmt
    c.border = Border(
        left=Side(style="medium", color=color),
        right=Side(style="medium", color=color),
        bottom=Side(style="medium", color=color),
    )


def build_pult(ws):
    """ПУЛЬТ — Quick overview with KPI tiles."""
    ws.sheet_view.showGridLines = False
    set_widths(ws, [("A", 12), ("B", 12), ("C", 12), ("D", 12),
                    ("E", 12), ("F", 12)])

    sheet_title(ws, "  ПУЛЬТ", "  Быстрый обзор работы магазина", ncols=6)

    # Row 3: period selectors
    ws.row_dimensions[3].height = 30
    _form_label(ws, 3, 1, "  Год:")
    _form_input(ws, 3, 2, value=YEAR, halign="center")
    _form_label(ws, 3, 3, "  Период:")
    _form_input(ws, 3, 4, value="Весь год", ncols=2, halign="center")
    _add_dv(ws, '"' + ",".join(["Весь год"] + MONTHS_RU) + '"', "D3")

    # Hidden helper cells row 4 (period start/end derived from B3, D3)
    # B3 = year, D3 = month name or "Весь год"
    # Hidden row 4 with helpers
    ws.row_dimensions[4].height = 1
    ws.cell(4, 1, '=IF(D3="Весь год",DATE(B3,1,1),DATE(B3,MATCH(D3,'
                  + '{"Январь";"Февраль";"Март";"Апрель";"Май";"Июнь";'
                  + '"Июль";"Август";"Сентябрь";"Октябрь";"Ноябрь";"Декабрь"},0),1))')
    ws.cell(4, 2, '=IF(D3="Весь год",DATE(B3,12,31),EOMONTH(A4,0))')
    # Hide row visually
    for col in range(1, 7):
        c = ws.cell(4, col)
        c.font = mkfont(WHITE, 1)
        c.number_format = FMT_DATE

    ws.row_dimensions[5].height = 8

    # ── СЕГОДНЯ section (rows 6-9) ──
    sec_hdr(ws, 6, "  СЕГОДНЯ", bg=NAVY, ncols=6, height=22)
    today_tiles = [
        ("Выручка",
         '=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",tblБаза[Дата],TODAY())',
         GREEN),
        ("Расход",
         '=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",tblБаза[Дата],TODAY())',
         RED),
        ("Прибыль",
         '=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",tblБаза[Дата],TODAY())'
         '-SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",tblБаза[Дата],TODAY())',
         BLUE),
        ("Расхождение",
         '=SUMIFS(tblБаза[Расхождение],tblБаза[Тип],"Приход",tblБаза[Дата],TODAY())',
         AMBER),
    ]
    ws.row_dimensions[7].height = 18
    ws.row_dimensions[8].height = 32
    # 4 tiles in cols A-D, E-F left blank
    for i, (lbl, f, color) in enumerate(today_tiles):
        _kpi_tile(ws, 7, i + 1, 1, lbl, f, color, val_size=10)

    ws.row_dimensions[9].height = 10

    # ── ЗА ПЕРИОД (rows 10-13) ──
    sec_hdr(ws, 10, "  ЗА ПЕРИОД", bg=TEAL, ncols=6, height=22)
    P = '$A$4'  # period start
    Q = '$B$4'  # period end
    # Tiles are at row 11 (label) / row 12 (value), cols 1..6
    period_tiles = [
        ("Выручка",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})',
         GREEN),
        ("Расход",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})',
         RED),
        ("Прибыль", '=A12-B12', BLUE),
        ("Смен закрыто",
         f'=ROUND(COUNTIFS(tblБаза[Тип],"Приход",tblБаза[Дата],">="&{P},'
         f'tblБаза[Дата],"<="&{Q})/3,0)', PURPLE),
        ("Сред. выручка",
         '=IFERROR(A12/D12,0)', TEAL_M),
        ("Долг новый",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Долг",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})',
         AMBER),
    ]
    ws.row_dimensions[11].height = 18
    ws.row_dimensions[12].height = 32
    for i, (lbl, f, color) in enumerate(period_tiles):
        fmt = "0" if lbl == "Смен закрыто" else FMT_RUB
        _kpi_tile(ws, 11, i + 1, 1, lbl, f, color, fmt=fmt, val_size=10)

    ws.row_dimensions[13].height = 10

    # ── СИГНАЛЫ ТП (rows 14-17) ──
    sec_hdr(ws, 14, "  СИГНАЛЫ ПОСТАВЩИКАМ", bg=AMBER, ncols=6, height=22)
    tp_tiles = [
        ("Запланировано",
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         f'tblВыплаты[Дата плановой оплаты],">="&TODAY(),'
         f'tblВыплаты[Дата плановой оплаты],"<="&{Q})', GREEN),
        ("Просрочено",
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         f'tblВыплаты[Дата плановой оплаты],"<"&TODAY())', RED),
        ("Оплачено в периоде",
         f'=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Оплачено",'
         f'tblВыплаты[Дата фактической оплаты],">="&{P},'
         f'tblВыплаты[Дата фактической оплаты],"<="&{Q})', BLUE),
        ("Долг общий (сейчас)",
         '=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Долг")'
         '-SUMIFS(tblБаза[Сумма],tblБаза[Категория],"Оплата ТП")', AMBER),
    ]
    ws.row_dimensions[15].height = 18
    ws.row_dimensions[16].height = 32
    for i, (lbl, f, color) in enumerate(tp_tiles):
        _kpi_tile(ws, 15, i + 1, 1, lbl, f, color, val_size=10)

    ws.row_dimensions[17].height = 10

    # Footer note
    ws.merge_cells("A18:F18")
    c = ws.cell(18, 1, "  Подсказка: при первом открытии нажмите F9 для пересчёта")
    c.font = mkfont(GRAY_D, 9)
    c.alignment = mkalign("left", "center")


# ═══════════════════════════════════════════════════════════════
#  BLOCK 4b: КАЛЕНДАРЬ_ВЫПЛАТ
# ═══════════════════════════════════════════════════════════════

def build_calendar(ws):
    """КАЛЕНДАРЬ_ВЫПЛАТ — Monthly calendar grid 7×6 with payment summaries."""
    ws.sheet_view.showGridLines = False

    # 9 cols total: A-G = calendar, H = spacer, I-J = side panel
    set_widths(ws, [("A", 13), ("B", 13), ("C", 13), ("D", 13),
                    ("E", 13), ("F", 13), ("G", 13), ("H", 2),
                    ("I", 18), ("J", 14)])

    sheet_title(ws, "  КАЛЕНДАРЬ ВЫПЛАТ",
                "  Платежи поставщикам по дням месяца", ncols=10)

    # Row 3: Month / Year selectors
    ws.row_dimensions[3].height = 32
    _form_label(ws, 3, 1, "  Месяц:")
    _form_input(ws, 3, 2, value="Январь", halign="center")
    _add_dv(ws, '"' + ",".join(MONTHS_RU) + '"', "B3")
    _form_label(ws, 3, 3, "  Год:")
    _form_input(ws, 3, 4, value=YEAR, halign="center")
    # Today button hint
    _form_btn(ws, 3, 9, "📅 СЕГОДНЯ", bg=BLUE, ncols=2, size=11)

    # Helper cells row 4 (hidden small)
    ws.row_dimensions[4].height = 6
    # I4 = selected date (set by VBA click handler); default = first of month
    months_arr = '{"Январь";"Февраль";"Март";"Апрель";"Май";"Июнь";"Июль";"Август";"Сентябрь";"Октябрь";"Ноябрь";"Декабрь"}'
    ws.cell(4, 1, f'=DATE(D3,MATCH(B3,{months_arr},0),1)')
    ws.cell(4, 1).number_format = FMT_DATE
    ws.cell(4, 2, '=EOMONTH(A4,0)')
    ws.cell(4, 2).number_format = FMT_DATE
    ws.cell(4, 3, '=WEEKDAY(A4,2)')  # 1=Mon..7=Sun
    for col in range(1, 11):
        ws.cell(4, col).font = mkfont(WHITE, 1)

    ws.row_dimensions[5].height = 8

    # Row 6: weekday header
    weekdays = ["Понедельник", "Вторник", "Среда", "Четверг",
                "Пятница", "Суббота", "Воскресенье"]
    ws.row_dimensions[6].height = 26
    for i, wd in enumerate(weekdays, 1):
        c = ws.cell(6, i, wd)
        c.fill = mkfill(TEAL)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center")
        c.border = mkborder()

    # 6 weeks × 5 rows per day = rows 7..36
    # Each "week" occupies 5 rows: date, оплачено, план, просроч, итого
    sub_rows = ["date", "paid", "plan", "over", "total"]
    sub_labels = {"date": "", "paid": "✓ Оплачено",
                  "plan": "🟡 Планир.", "over": "🔴 Просроч.", "total": "Σ Итого"}
    sub_colors = {"date": NAVY, "paid": GREEN, "plan": AMBER,
                  "over": RED, "total": NAVY}

    start_row = 7
    for week in range(6):
        week_top = start_row + week * 5
        # heights
        ws.row_dimensions[week_top].height = 18      # date number
        for i in range(1, 5):
            ws.row_dimensions[week_top + i].height = 16

        for day_col in range(1, 8):
            # day position 0-based in 6×7 grid
            day_pos = week * 7 + (day_col - 1)
            # Day number formula
            # day_n = day_pos - (WEEKDAY-1) + 1 = day_pos - C4 + 2
            day_formula = (
                f'=IF(AND({day_pos}-$C$4+2>=1,'
                f'{day_pos}-$C$4+2<=DAY($B$4)),'
                f'{day_pos}-$C$4+2,"")'
            )
            c = ws.cell(week_top, day_col, day_formula)
            c.fill = mkfill(GRAY_L)
            c.font = mkfont(NAVY, 12, True)
            c.alignment = mkalign("center", "center")
            c.border = Border(
                left=Side(style="thin", color="FFD1D5DB"),
                right=Side(style="thin", color="FFD1D5DB"),
                top=Side(style="medium", color="FF9CA3AF"),
            )

            # Date object formula (for SUMIFS)
            # row "date" in helper: use IFERROR to handle empty cells
            # Build the actual date from the day number: DATE(year, month, day)
            date_ref_formula = (
                f'=IFERROR(DATE($D$3,MONTH($A$4),'
                f'{get_column_letter(day_col)}{week_top}),"")'
            )

            # Оплачено row
            r_paid = week_top + 1
            f_paid = (
                f'=IFERROR(IF({get_column_letter(day_col)}{week_top}="","",'
                f'SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Оплачено",'
                f'tblВыплаты[Дата фактической оплаты],'
                f'DATE($D$3,MONTH($A$4),{get_column_letter(day_col)}{week_top}))),"")'
            )
            c = ws.cell(r_paid, day_col, f_paid)
            c.fill = mkfill(WHITE)
            c.font = mkfont(GREEN, 9, True)
            c.alignment = mkalign("right", "center")
            c.border = Border(
                left=Side(style="thin", color="FFD1D5DB"),
                right=Side(style="thin", color="FFD1D5DB"),
            )
            c.number_format = '[=0]"";#,##0'

            # План row
            r_plan = week_top + 2
            f_plan = (
                f'=IFERROR(IF({get_column_letter(day_col)}{week_top}="","",'
                f'SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
                f'tblВыплаты[Дата плановой оплаты],'
                f'DATE($D$3,MONTH($A$4),{get_column_letter(day_col)}{week_top}),'
                f'tblВыплаты[Дата плановой оплаты],">="&TODAY())),"")'
            )
            c = ws.cell(r_plan, day_col, f_plan)
            c.fill = mkfill(WHITE)
            c.font = mkfont(AMBER, 9, True)
            c.alignment = mkalign("right", "center")
            c.border = Border(
                left=Side(style="thin", color="FFD1D5DB"),
                right=Side(style="thin", color="FFD1D5DB"),
            )
            c.number_format = '[=0]"";#,##0'

            # Просрочено row
            r_over = week_top + 3
            f_over = (
                f'=IFERROR(IF({get_column_letter(day_col)}{week_top}="","",'
                f'SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
                f'tblВыплаты[Дата плановой оплаты],'
                f'DATE($D$3,MONTH($A$4),{get_column_letter(day_col)}{week_top}),'
                f'tblВыплаты[Дата плановой оплаты],"<"&TODAY())),"")'
            )
            c = ws.cell(r_over, day_col, f_over)
            c.fill = mkfill(WHITE)
            c.font = mkfont(RED, 9, True)
            c.alignment = mkalign("right", "center")
            c.border = Border(
                left=Side(style="thin", color="FFD1D5DB"),
                right=Side(style="thin", color="FFD1D5DB"),
            )
            c.number_format = '[=0]"";#,##0'

            # ИТОГО row
            r_total = week_top + 4
            cl = get_column_letter(day_col)
            f_total = f'=IFERROR(IF({cl}{week_top}="","",{cl}{r_paid}+{cl}{r_plan}+{cl}{r_over}),"")'
            c = ws.cell(r_total, day_col, f_total)
            c.fill = mkfill(GRAY_M)
            c.font = mkfont(NAVY, 10, True)
            c.alignment = mkalign("right", "center")
            c.border = Border(
                left=Side(style="thin", color="FFD1D5DB"),
                right=Side(style="thin", color="FFD1D5DB"),
                bottom=Side(style="medium", color="FF9CA3AF"),
            )
            c.number_format = '[=0]"—";#,##0'

    # Side panel (col I-J), rows 6-12: monthly summary
    ws.cell(6, 9, "СВОДКА ЗА МЕСЯЦ").fill = mkfill(TEAL)
    ws.cell(6, 9).font = mkfont(WHITE, 10, True)
    ws.cell(6, 9).alignment = mkalign("center", "center")
    ws.merge_cells("I6:J6")

    side_kpis = [
        ("Оплачено",
         '=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Оплачено",'
         'tblВыплаты[Дата фактической оплаты],">="&$A$4,'
         'tblВыплаты[Дата фактической оплаты],"<="&$B$4)', GREEN),
        ("Запланировано",
         '=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         'tblВыплаты[Дата плановой оплаты],">="&$A$4,'
         'tblВыплаты[Дата плановой оплаты],"<="&$B$4,'
         'tblВыплаты[Дата плановой оплаты],">="&TODAY())', AMBER),
        ("Просрочено",
         '=SUMIFS(tblВыплаты[Сумма],tblВыплаты[Статус],"Запланировано",'
         'tblВыплаты[Дата плановой оплаты],">="&$A$4,'
         'tblВыплаты[Дата плановой оплаты],"<="&$B$4,'
         'tblВыплаты[Дата плановой оплаты],"<"&TODAY())', RED),
        ("Платежей",
         '=COUNTIFS(tblВыплаты[Дата плановой оплаты],">="&$A$4,'
         'tblВыплаты[Дата плановой оплаты],"<="&$B$4)', BLUE),
    ]
    for i, (lbl, formula, color) in enumerate(side_kpis):
        rn = 7 + i
        ws.row_dimensions[rn].height = 22
        c = ws.cell(rn, 9, lbl)
        c.fill = mkfill(GRAY_L)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("left", "center")
        c.border = mkborder()

        c = ws.cell(rn, 10, formula)
        c.fill = mkfill(WHITE)
        c.font = mkfont(color, 11, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder()
        c.number_format = "#,##0" if lbl != "Платежей" else "0"


# ═══════════════════════════════════════════════════════════════
#  BLOCK 4c: ДАШБОРД
# ═══════════════════════════════════════════════════════════════

def build_dashboard(ws):
    """ДАШБОРД — Full analytics dashboard."""
    ws.sheet_view.showGridLines = False
    set_widths(ws, [(get_column_letter(i), 12) for i in range(1, 13)])

    sheet_title(ws, "  ДАШБОРД", "  Полная аналитика магазина", ncols=12)

    # Row 3: Period selector
    ws.row_dimensions[3].height = 32
    _form_label(ws, 3, 1, "  Год от:")
    _form_input(ws, 3, 2, value=YEAR, halign="center")
    _form_label(ws, 3, 3, "  Месяц от:")
    _form_input(ws, 3, 4, value="Январь", halign="center")
    _add_dv(ws, '"' + ",".join(MONTHS_RU) + '"', "D3")
    _form_label(ws, 3, 5, "  Год до:")
    _form_input(ws, 3, 6, value=YEAR, halign="center")
    _form_label(ws, 3, 7, "  Месяц до:")
    _form_input(ws, 3, 8, value="Декабрь", halign="center")
    _add_dv(ws, '"' + ",".join(MONTHS_RU) + '"', "H3")
    _form_btn(ws, 3, 11, "🔄 ОБНОВИТЬ", bg=AMBER, ncols=2, size=11)

    # Hidden helpers row 4
    months_arr = '{"Январь";"Февраль";"Март";"Апрель";"Май";"Июнь";"Июль";"Август";"Сентябрь";"Октябрь";"Ноябрь";"Декабрь"}'
    ws.cell(4, 1, f'=DATE(B3,MATCH(D3,{months_arr},0),1)')  # period start
    ws.cell(4, 2, f'=EOMONTH(DATE(F3,MATCH(H3,{months_arr},0),1),0)')  # period end
    ws.cell(4, 1).number_format = FMT_DATE
    ws.cell(4, 2).number_format = FMT_DATE
    for col in range(1, 13):
        ws.cell(4, col).font = mkfont(WHITE, 1)
    ws.row_dimensions[4].height = 6

    P = '$A$4'
    Q = '$B$4'
    ws.row_dimensions[5].height = 8

    # ── BLOCK 1: ВЫРУЧКА (rows 6-8) ──
    sec_hdr(ws, 6, "  ВЫРУЧКА", bg=GREEN, ncols=12, height=22)
    ws.row_dimensions[7].height = 18
    ws.row_dimensions[8].height = 32
    rev_tiles = [
        ("Выручка всего",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Наличные",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
         f'tblБаза[Способ оплаты],"Наличные",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Карта",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
         f'tblБаза[Способ оплаты],"Карта",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Перевод",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
         f'tblБаза[Способ оплаты],"Перевод",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
    ]
    for i, (lbl, f) in enumerate(rev_tiles):
        _kpi_tile(ws, 7, i * 3 + 1, 3, lbl, f, GREEN, val_size=12)

    # ── BLOCK 2: РАСХОДЫ (rows 9-11) ──
    sec_hdr(ws, 9, "  РАСХОДЫ", bg=RED, ncols=12, height=22)
    ws.row_dimensions[10].height = 18
    ws.row_dimensions[11].height = 32
    exp_tiles = [
        ("Расход всего",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Закуп товара",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
         f'tblБаза[Категория],"Закуп товара",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("ФОТ + Аренда",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
         f'tblБаза[Категория],"ЗП",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'
         f'+SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
         f'tblБаза[Категория],"Аренда",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Прочее",
         f'=A11-(D11+G11)'),
    ]
    # Note: tile values land in row 8, but row 11 is value row. Need offsets.
    for i, (lbl, f) in enumerate(exp_tiles):
        col = i * 3 + 1
        _kpi_tile(ws, 10, col, 3, lbl, f, RED, val_size=12)

    # ── BLOCK 3: ПРИБЫЛЬ + ДОЛГ (rows 12-14) ──
    sec_hdr(ws, 12, "  ПРИБЫЛЬ И ДОЛГИ", bg=BLUE, ncols=12, height=22)
    ws.row_dimensions[13].height = 18
    ws.row_dimensions[14].height = 32
    pl_tiles = [
        ("Прибыль (касса)",
         f'=A8-A11'),
        ("Рентабельность",
         f'=IFERROR((A8-A11)/A8,0)', "0.0%"),
        ("Долг — взято",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Долг",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Долг общий (текущ.)",
         f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Долг")'
         f'-SUMIFS(tblБаза[Сумма],tblБаза[Категория],"Оплата ТП")'),
    ]
    for i, t in enumerate(pl_tiles):
        col = i * 3 + 1
        if len(t) == 3:
            lbl, f, fmt = t
        else:
            lbl, f = t
            fmt = FMT_RUB
        _kpi_tile(ws, 13, col, 3, lbl, f, BLUE, fmt=fmt, val_size=12)

    # ── BLOCK 4: ОПЕРАЦИИ (rows 15-17) ──
    sec_hdr(ws, 15, "  ОПЕРАЦИИ И КАССА", bg=PURPLE, ncols=12, height=22)
    ws.row_dimensions[16].height = 18
    ws.row_dimensions[17].height = 32
    op_tiles = [
        ("Смен закрыто",
         f'=ROUND(COUNTIFS(tblБаза[Тип],"Приход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})/3,0)', "0"),
        ("Сред. выручка",
         f'=IFERROR(A8/A17,0)'),
        ("Расхождение касс",
         f'=SUMIFS(tblБаза[Расхождение],tblБаза[Тип],"Приход",'
         f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'),
        ("Транзакций",
         f'=COUNTIFS(tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})', "0"),
    ]
    for i, t in enumerate(op_tiles):
        col = i * 3 + 1
        if len(t) == 3:
            lbl, f, fmt = t
        else:
            lbl, f = t
            fmt = FMT_RUB
        _kpi_tile(ws, 16, col, 3, lbl, f, PURPLE, fmt=fmt, val_size=12)

    ws.row_dimensions[18].height = 10

    # ── ДЕТАЛИЗАЦИЯ РАСХОДОВ (rows 19-30) ──
    sec_hdr(ws, 19, "  ДЕТАЛИЗАЦИЯ РАСХОДОВ ПО КАТЕГОРИЯМ", bg=NAVY,
            ncols=12, height=22)
    ws.row_dimensions[20].height = 22
    detail_hdr = ["", "Категория", "", "", "Сумма", "", "", "Доля %", "", "", "", ""]
    for i, h in enumerate(detail_hdr, 1):
        c = ws.cell(20, i, h)
        c.fill = mkfill(TEAL_M)
        c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center")
        c.border = mkborder()

    # Use CATS_EXPENSE in detail
    for i, cat in enumerate(CATS_EXPENSE):
        rn = 21 + i
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, "", alt)
        c = ws.cell(rn, 2, cat)
        ws.merge_cells(start_row=rn, start_column=2, end_row=rn, end_column=4)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("left", "center")
        c.border = mkborder()
        for col in (3, 4):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        # Sum
        formula = (
            f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Расход",'
            f'tblБаза[Категория],"{cat}",'
            f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'
        )
        ws.merge_cells(start_row=rn, start_column=5, end_row=rn, end_column=7)
        c = ws.cell(rn, 5, formula)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder()
        c.number_format = FMT_RUB
        for col in (6, 7):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        # Доля
        ws.merge_cells(start_row=rn, start_column=8, end_row=rn, end_column=12)
        c = ws.cell(rn, 8, f'=IFERROR(E{rn}/$A$11,0)')
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10)
        c.alignment = mkalign("right", "center")
        c.border = mkborder()
        c.number_format = "0.0%"
        for col in range(9, 13):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

    next_row = 21 + len(CATS_EXPENSE) + 1
    ws.row_dimensions[next_row].height = 10
    next_row += 1

    # ── ВЫРУЧКА ПО ДНЯМ НЕДЕЛИ ──
    sec_hdr(ws, next_row, "  ВЫРУЧКА ПО ДНЯМ НЕДЕЛИ", bg=TEAL, ncols=12, height=22)
    next_row += 1
    weekdays = ["Понедельник", "Вторник", "Среда", "Четверг",
                "Пятница", "Суббота", "Воскресенье"]
    ws.row_dimensions[next_row].height = 22
    hdrs_wd = ["", "День недели", "", "", "Выручка", "", "", "Доля %", "", "", "", ""]
    for i, h in enumerate(hdrs_wd, 1):
        c = ws.cell(next_row, i, h)
        c.fill = mkfill(TEAL_M); c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center"); c.border = mkborder()
    base_wd_row = next_row + 1
    for i, wd in enumerate(weekdays):
        rn = base_wd_row + i
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, "", alt)
        ws.merge_cells(start_row=rn, start_column=2, end_row=rn, end_column=4)
        c = ws.cell(rn, 2, wd)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("left", "center")
        c.border = mkborder()
        for col in (3, 4):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        ws.merge_cells(start_row=rn, start_column=5, end_row=rn, end_column=7)
        formula = (
            f'=SUMPRODUCT((WEEKDAY(tblБаза[Дата],2)={i+1})*'
            f'(tblБаза[Тип]="Приход")*'
            f'(tblБаза[Дата]>={P})*(tblБаза[Дата]<={Q})*tblБаза[Сумма])'
        )
        c = ws.cell(rn, 5, formula)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder(); c.number_format = FMT_RUB
        for col in (6, 7):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        ws.merge_cells(start_row=rn, start_column=8, end_row=rn, end_column=12)
        c = ws.cell(rn, 8, f'=IFERROR(E{rn}/$A$8,0)')
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10)
        c.alignment = mkalign("right", "center")
        c.border = mkborder(); c.number_format = "0.0%"
        for col in range(9, 13):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

    next_row = base_wd_row + 7 + 1
    ws.row_dimensions[next_row].height = 10
    next_row += 1

    # ── ВЫРУЧКА ПО СМЕНАМ ──
    sec_hdr(ws, next_row, "  ВЫРУЧКА ПО СМЕНАМ", bg=TEAL, ncols=12, height=22)
    next_row += 1
    ws.row_dimensions[next_row].height = 22
    for i, h in enumerate(["", "Смена", "", "", "Выручка", "", "", "Доля %", "", "", "", ""], 1):
        c = ws.cell(next_row, i, h)
        c.fill = mkfill(TEAL_M); c.font = mkfont(WHITE, 10, True)
        c.alignment = mkalign("center", "center"); c.border = mkborder()
    base_sh_row = next_row + 1
    for i, sh in enumerate(SHIFTS):
        rn = base_sh_row + i
        ws.row_dimensions[rn].height = 20
        alt = (i % 2 == 1)
        d_cell(ws, rn, 1, "", alt)
        ws.merge_cells(start_row=rn, start_column=2, end_row=rn, end_column=4)
        c = ws.cell(rn, 2, sh)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("left", "center"); c.border = mkborder()
        for col in (3, 4):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        ws.merge_cells(start_row=rn, start_column=5, end_row=rn, end_column=7)
        formula = (
            f'=SUMIFS(tblБаза[Сумма],tblБаза[Тип],"Приход",'
            f'tblБаза[Смена],"{sh}",'
            f'tblБаза[Дата],">="&{P},tblБаза[Дата],"<="&{Q})'
        )
        c = ws.cell(rn, 5, formula)
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10, True)
        c.alignment = mkalign("right", "center")
        c.border = mkborder(); c.number_format = FMT_RUB
        for col in (6, 7):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

        ws.merge_cells(start_row=rn, start_column=8, end_row=rn, end_column=12)
        c = ws.cell(rn, 8, f'=IFERROR(E{rn}/$A$8,0)')
        c.fill = mkfill(GRAY_L if alt else WHITE)
        c.font = mkfont(NAVY, 10)
        c.alignment = mkalign("right", "center")
        c.border = mkborder(); c.number_format = "0.0%"
        for col in range(9, 13):
            ws.cell(rn, col).fill = mkfill(GRAY_L if alt else WHITE)
            ws.cell(rn, col).border = mkborder()

    # Footer hint
    footer_row = base_sh_row + len(SHIFTS) + 2
    ws.merge_cells(start_row=footer_row, start_column=1,
                   end_row=footer_row, end_column=12)
    c = ws.cell(footer_row, 1, "  Подсказка: после изменения периода нажмите F9 для пересчёта")
    c.font = mkfont(GRAY_D, 9)
    c.alignment = mkalign("left", "center")


# ═══════════════════════════════════════════════════════════════
#  BLOCK 5: VBA EXPORT (.bas file)
# ═══════════════════════════════════════════════════════════════

VBA_CODE = r'''Attribute VB_Name = "WayMarketMacros"
' ═══════════════════════════════════════════════════════════════
'  WAY MARKET — VBA Macros
'  Импорт: Alt+F11 → File → Import File → выбрать этот .bas
'  Назначить кнопкам: правый клик по кнопке → Назначить макрос
' ═══════════════════════════════════════════════════════════════

Option Explicit

' ── Константы — имена листов ──
Private Const SH_BAZA  As String = "БАЗА_ДДС"
Private Const SH_KASSA As String = "Ввод_Касса"
Private Const SH_RASH  As String = "Ввод_Расходы"
Private Const SH_VYPL  As String = "Запись_Выплат"
Private Const SH_CAL   As String = "Календарь_Выплат"
Private Const SH_DASH  As String = "Дашборд"
Private Const SH_PULT  As String = "Пульт"
Private Const SH_SETS  As String = "Настройки"

' ── Автокомплит: вспомогательные колонки в Настройки ──
' Col I (9) = фильтр Кассиры, Col J (10) = Категории, Col K (11) = Поставщики
Private Const AC_COL_KASSA As Integer = 9
Private Const AC_COL_CAT   As Integer = 10
Private Const AC_COL_SUP   As Integer = 11
Private Const AC_MAX_ROWS  As Integer = 15

' ═══════════════════════════════════════════════════════════════
'  SAVE KASSA — Сохранить кассу в БАЗА_ДДС
'  Назначить на кнопку A16:G16 на листе Ввод_Касса
' ═══════════════════════════════════════════════════════════════
Public Sub SaveKassa()
    Dim wsK As Worksheet, wsB As Worksheet
    Set wsK = ThisWorkbook.Worksheets(SH_KASSA)
    Set wsB = ThisWorkbook.Worksheets(SH_BAZA)

    ' Валидация
    Dim dtVal As Variant, shVal As String, cashVal As String
    dtVal   = wsK.Range("B3").Value
    shVal   = CStr(wsK.Range("D3").Value)
    cashVal = CStr(wsK.Range("F3").Value)

    If Not IsDate(dtVal) Then
        MsgBox "Введите дату смены (B3)", vbExclamation, "Касса"
        Exit Sub
    End If
    If Len(Trim(shVal)) = 0 Then
        MsgBox "Выберите смену (D3)", vbExclamation, "Касса"
        Exit Sub
    End If
    If Len(Trim(cashVal)) = 0 Then
        MsgBox "Выберите кассира (F3)", vbExclamation, "Касса"
        Exit Sub
    End If

    ' Найти последнюю строку в БАЗА_ДДС
    Dim lastRow As Long
    lastRow = wsB.Cells(wsB.Rows.Count, 1).End(xlUp).Row
    If lastRow < 6 Then lastRow = 5

    ' 3 Приход-строки (Наличные, Карта, Перевод) — всегда пишем все 3
    Dim methods As Variant, i As Long, r As Long
    methods = Array("Наличные", "Карта", "Перевод")
    For i = 0 To 2
        r = lastRow + 1 + i
        Dim factVal As Double, zVal As Double, discVal As Double
        zVal    = CDbl(Nz(wsK.Cells(8 + i, 2).Value))
        factVal = CDbl(Nz(wsK.Cells(8 + i, 3).Value))
        discVal = factVal - zVal

        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = shVal
        wsB.Cells(r, 3).Value = cashVal
        wsB.Cells(r, 4).Value = "Приход"
        wsB.Cells(r, 5).Value = "Продажи"
        wsB.Cells(r, 6).Value = methods(i)
        wsB.Cells(r, 7).Value = factVal
        If discVal <> 0 Then
            wsB.Cells(r, 8).Value = discVal
        End If
        wsB.Cells(r, 9).Value = ""

        ' Форматирование
        wsB.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
        wsB.Cells(r, 7).NumberFormat = "#,##0"" ₽"""
        wsB.Cells(r, 8).NumberFormat = "#,##0"" ₽"""
    Next i

    ' Очистить форму
    wsK.Range("B3").ClearContents
    wsK.Range("D3").ClearContents
    wsK.Range("F3").ClearContents
    For i = 8 To 10
        wsK.Cells(i, 2).Value = 0
        wsK.Cells(i, 3).Value = 0
    Next i

    MsgBox "Сохранено 3 строки в БАЗА_ДДС за " & Format(dtVal, "DD.MM.YYYY") _
           & " (" & shVal & ", " & cashVal & ")", _
           vbInformation, "Касса сохранена"
End Sub


' ═══════════════════════════════════════════════════════════════
'  SAVE RASHOD — Сохранить расход или закуп в долг в БАЗА_ДДС
'  Назначить на кнопку A16:D16 на листе Ввод_Расходы
' ═══════════════════════════════════════════════════════════════
Public Sub SaveRashod()
    Dim wsR As Worksheet, wsB As Worksheet
    Set wsR = ThisWorkbook.Worksheets(SH_RASH)
    Set wsB = ThisWorkbook.Worksheets(SH_BAZA)

    Dim dtVal As Variant
    dtVal = wsR.Range("B3").Value
    If Not IsDate(dtVal) Then
        MsgBox "Введите дату (B3)", vbExclamation, "Расход"
        Exit Sub
    End If

    ' Проверяем, какой раздел заполнен
    Dim rashSum As Double, dolgSum As Double
    rashSum = CDbl(Nz(wsR.Range("B8").Value))
    dolgSum = CDbl(Nz(wsR.Range("B13").Value))

    If rashSum > 0 And dolgSum > 0 Then
        MsgBox "Заполните ТОЛЬКО один раздел: либо РАСХОД, либо ЗАКУП В ДОЛГ", _
               vbExclamation, "Расход"
        Exit Sub
    End If
    If rashSum <= 0 And dolgSum <= 0 Then
        MsgBox "Введите сумму в одном из разделов (B8 или B13)", _
               vbExclamation, "Расход"
        Exit Sub
    End If

    Dim lastRow As Long
    lastRow = wsB.Cells(wsB.Rows.Count, 1).End(xlUp).Row
    If lastRow < 6 Then lastRow = 5
    Dim r As Long: r = lastRow + 1

    If rashSum > 0 Then
        ' Обычный расход
        Dim catVal As String, mthVal As String
        catVal = CStr(wsR.Range("B6").Value)
        mthVal = CStr(wsR.Range("B7").Value)
        If Len(Trim(catVal)) = 0 Then
            MsgBox "Выберите категорию (B6)", vbExclamation, "Расход"
            Exit Sub
        End If
        If Len(Trim(mthVal)) = 0 Then
            MsgBox "Выберите способ оплаты (B7)", vbExclamation, "Расход"
            Exit Sub
        End If

        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = ""
        wsB.Cells(r, 3).Value = ""
        wsB.Cells(r, 4).Value = "Расход"
        wsB.Cells(r, 5).Value = catVal
        wsB.Cells(r, 6).Value = mthVal
        wsB.Cells(r, 7).Value = rashSum
        wsB.Cells(r, 8).Value = ""
        wsB.Cells(r, 9).Value = CStr(wsR.Range("B9").Value)

        MsgBox "Расход сохранён: " & Format(rashSum, "#,##0") & " ₽ (" & catVal & ")", _
               vbInformation, "Расход"
    Else
        ' Закуп в долг
        Dim supVal As String
        supVal = CStr(wsR.Range("B12").Value)
        If Len(Trim(supVal)) = 0 Then
            MsgBox "Выберите поставщика (B12)", vbExclamation, "Долг"
            Exit Sub
        End If

        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = ""
        wsB.Cells(r, 3).Value = ""
        wsB.Cells(r, 4).Value = "Долг"
        wsB.Cells(r, 5).Value = "Закуп товара"
        wsB.Cells(r, 6).Value = supVal
        wsB.Cells(r, 7).Value = dolgSum
        wsB.Cells(r, 8).Value = ""
        wsB.Cells(r, 9).Value = "Закуп в долг"

        MsgBox "Закуп в долг сохранён: " & Format(dolgSum, "#,##0") & _
               " ₽ (" & supVal & ")" & vbCrLf & vbCrLf & _
               "Не забудьте добавить запись в ЗАПИСЬ_ВЫПЛАТ для планирования оплаты!", _
               vbInformation, "Долг"
    End If

    ' Форматирование новой строки
    wsB.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
    wsB.Cells(r, 7).NumberFormat = "#,##0"" ₽"""

    ' Очистить форму
    wsR.Range("B3").ClearContents
    wsR.Range("B6").ClearContents
    wsR.Range("B7").ClearContents
    wsR.Range("B8").Value = 0
    wsR.Range("B9").ClearContents
    wsR.Range("B12").ClearContents
    wsR.Range("B13").Value = 0
End Sub


' ═══════════════════════════════════════════════════════════════
'  INSERT TODAY — Кнопки СЕГОДНЯ
' ═══════════════════════════════════════════════════════════════
Public Sub InsertToday_Kassa()
    ThisWorkbook.Worksheets(SH_KASSA).Range("B3").Value = Date
    ThisWorkbook.Worksheets(SH_KASSA).Range("B3").NumberFormat = "DD.MM.YYYY"
End Sub

Public Sub InsertToday_Rashod()
    ThisWorkbook.Worksheets(SH_RASH).Range("B3").Value = Date
    ThisWorkbook.Worksheets(SH_RASH).Range("B3").NumberFormat = "DD.MM.YYYY"
End Sub

Public Sub InsertToday_Calendar()
    Dim months As Variant
    months = Array("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", _
                   "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
    ThisWorkbook.Worksheets(SH_CAL).Range("B3").Value = months(Month(Date) - 1)
    ThisWorkbook.Worksheets(SH_CAL).Range("D3").Value = Year(Date)
End Sub


' ═══════════════════════════════════════════════════════════════
'  REFRESH DASHBOARD — Пересчёт + обновление всех таблиц
' ═══════════════════════════════════════════════════════════════
Public Sub RefreshDashboard()
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic
    Application.CalculateFull
    ThisWorkbook.RefreshAll
    Application.ScreenUpdating = True
    MsgBox "Все формулы и сводные пересчитаны.", vbInformation, "Обновление"
End Sub


' ═══════════════════════════════════════════════════════════════
'  АВТОКОМПЛИТ — умный поиск по подстроке
'  Как работает:
'    1) Пользователь начинает печатать в поле (F3 / B6 / B12)
'    2) Worksheet_Change вызывает AC_Kassa / AC_Category / AC_Supplier
'    3) VBA фильтрует список по введённому тексту (case-insensitive)
'    4) Записывает совпадения во вспомогательные колонки I/J/K листа Настройки
'    5) Обновляет выпадающий список поля — теперь видны только совпадения
'    6) Если совпадение ровно одно — вставляет полное значение автоматически
'
'  УСТАНОВКА (сделать 1 раз после импорта этого .bas файла):
'    Открыть Alt+F11, затем для каждого листа:
'
'  ─── Вставить в модуль листа "Ввод_Касса" ──────────────────
'  (правый клик на вкладку → "Просмотр кода", вставить ниже)
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$F$3" Then
'          Call WayMarketMacros.AC_Kassa(Target)
'      End If
'  End Sub
'
'  ─── Вставить в модуль листа "Ввод_Расходы" ────────────────
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$B$6" Then
'          Call WayMarketMacros.AC_Category(Target)
'      ElseIf Target.Address = "$B$12" Then
'          Call WayMarketMacros.AC_Supplier(Target)
'      End If
'  End Sub
'
' ═══════════════════════════════════════════════════════════════

Private Sub AC_DoFilter(inputCell As Range, masterList As Variant, helperCol As Integer)
    Dim wsS As Worksheet
    Set wsS = ThisWorkbook.Worksheets(SH_SETS)

    Dim typed As String
    typed = LCase(Trim(CStr(inputCell.Value)))

    On Error GoTo errHandler
    Application.EnableEvents = False
    Application.ScreenUpdating = False

    ' Очистить вспомогательный столбец
    wsS.Range(wsS.Cells(1, helperCol), wsS.Cells(AC_MAX_ROWS, helperCol)).ClearContents

    Dim i As Long, j As Long
    j = 0

    ' Фильтр по подстроке (регистр игнорируется)
    For i = 0 To UBound(masterList)
        If Len(typed) = 0 Or InStr(1, LCase(CStr(masterList(i))), typed, vbTextCompare) > 0 Then
            wsS.Cells(j + 1, helperCol).Value = masterList(i)
            j = j + 1
        End If
    Next i

    ' Нет совпадений — показать весь список
    If j = 0 Then
        For i = 0 To UBound(masterList)
            wsS.Cells(i + 1, helperCol).Value = masterList(i)
        Next i
        j = UBound(masterList) + 1
    End If

    ' Адрес диапазона для DataValidation
    Dim colLetter As String
    colLetter = Chr(64 + helperCol)   ' 9→I, 10→J, 11→K
    Dim dvAddr As String
    dvAddr = "=" & wsS.Name & "!$" & colLetter & "$1:$" & colLetter & "$" & j

    ' Обновить DataValidation (без блокировки — пользователь может печатать свободно)
    With inputCell.Validation
        .Delete
        .Add Type:=xlValidateList, AlertStyle:=xlValidAlertInformation, _
             Operator:=xlBetween, Formula1:=dvAddr
        .IgnoreBlank = True
        .InCellDropdown = True
        .ShowInput = False
        .ShowError = False
    End With

    ' Автозаполнение при единственном совпадении
    If j = 1 And Len(typed) > 0 Then
        inputCell.Value = wsS.Cells(1, helperCol).Value
    End If

errHandler:
    Application.EnableEvents = True
    Application.ScreenUpdating = True
End Sub

' ── Публичные методы — вызываются из Worksheet_Change листов ──

Public Sub AC_Kassa(inputCell As Range)
    Call AC_DoFilter(inputCell, Array("Айгуль", "Зарина", "Данияр"), AC_COL_KASSA)
End Sub

Public Sub AC_Category(inputCell As Range)
    Call AC_DoFilter(inputCell, _
        Array("ЗП", "Аренда", "Налоги", "Интернет", "Закуп товара", _
              "Оплата ТП", "Коммуналка", "Реклама", "Другое"), AC_COL_CAT)
End Sub

Public Sub AC_Supplier(inputCell As Range)
    Call AC_DoFilter(inputCell, _
        Array("ТД Метро", "Лента", "Вкусвилл", "Магнит", "Х5 Ритейл", "Юнилевер"), _
        AC_COL_SUP)
End Sub


' ═══════════════════════════════════════════════════════════════
'  УТИЛИТЫ
' ═══════════════════════════════════════════════════════════════
Private Function Nz(v As Variant) As Variant
    If IsEmpty(v) Or IsNull(v) Or (VarType(v) = vbString And v = "") Then
        Nz = 0
    Else
        Nz = v
    End If
End Function


' ═══════════════════════════════════════════════════════════════
'  КАК АКТИВИРОВАТЬ КНОПКИ И АВТОКОМПЛИТ:
'
'  Шаг 1: Импортировать этот .bas файл
'    Alt+F11 → File → Import File → выбрать WAY_MARKET_VBA.bas
'
'  Шаг 2: Вставить код в модули ЧЕТЫРЁХ листов.
'    Для каждого листа: правый клик на вкладку → "Просмотр кода"
'    Вставить соответствующий блок целиком (без кавычек).
'
'  ─── Модуль листа "Ввод_Касса" ─────────────────────────────
'  (двойной клик по зелёной/синей кнопке запускает макрос;
'   ввод текста в F3 фильтрует список кассиров)
'
'  Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
'      If Not Intersect(Target, Me.Range("A16:G16")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.SaveKassa
'      End If
'      If Not Intersect(Target, Me.Range("E4:F4")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.InsertToday_Kassa
'      End If
'  End Sub
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$F$3" Then Call WayMarketMacros.AC_Kassa(Target)
'  End Sub
'
'  ─── Модуль листа "Ввод_Расходы" ────────────────────────────
'
'  Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
'      If Not Intersect(Target, Me.Range("A16:D16")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.SaveRashod
'      End If
'      If Not Intersect(Target, Me.Range("C3:D3")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.InsertToday_Rashod
'      End If
'  End Sub
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$B$6" Then
'          Call WayMarketMacros.AC_Category(Target)
'      ElseIf Target.Address = "$B$12" Then
'          Call WayMarketMacros.AC_Supplier(Target)
'      End If
'  End Sub
'
'  ─── Модуль листа "Календарь_Выплат" ────────────────────────
'
'  Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
'      If Not Intersect(Target, Me.Range("I3:J3")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.InsertToday_Calendar
'      End If
'  End Sub
'
'  Private Sub Worksheet_SelectionChange(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      Dim r As Long: r = Target.Row
'      Dim c As Long: c = Target.Column
'      If c < 1 Or c > 7 Then Exit Sub
'      If (r - 7) Mod 5 <> 0 Then Exit Sub
'      If Not IsNumeric(Target.Value) Or Target.Value = "" Then Exit Sub
'      Application.ScreenUpdating = False
'      Me.Range("A7:G36").Interior.Pattern = xlNone
'      Target.Interior.Color = RGB(254, 240, 138)
'      Application.ScreenUpdating = True
'  End Sub
'
'  ─── Модуль листа "Дашборд" ─────────────────────────────────
'
'  Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
'      If Not Intersect(Target, Me.Range("K3:L3")) Is Nothing Then
'          Cancel = True: Call WayMarketMacros.RefreshDashboard
'      End If
'  End Sub
'
'  Шаг 3: Файл → Сохранить как → Книга Excel с поддержкой макросов (.xlsm)
'
' ═══════════════════════════════════════════════════════════════
'''


def write_vba_file(path="WAY_MARKET_VBA.bas"):
    with open(path, "w", encoding="utf-8") as f:
        f.write(VBA_CODE)
    return path


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

SHEET_NAMES = [
    "Пульт", "Ввод_Касса", "Ввод_Расходы", "БАЗА_ДДС",
    "Запись_Выплат", "Календарь_Выплат", "Дашборд", "Настройки",
]
TAB_COLORS = {
    "Пульт":            "0B4F54",
    "Ввод_Касса":       "059669",
    "Ввод_Расходы":     "DC2626",
    "БАЗА_ДДС":         "1D4ED8",
    "Запись_Выплат":    "7C3AED",
    "Календарь_Выплат": "D97706",
    "Дашборд":          "B45309",
    "Настройки":        "6B7280",
}


def main():
    print("Генерируем демо-данные...")
    baza = gen_baza()
    vyplaty = gen_vyplaty()
    print(f"  БАЗА_ДДС:       {len(baza)} строк")
    print(f"  ЗАПИСЬ_ВЫПЛАТ:  {len(vyplaty)} строк")

    print("\nСоздаём книгу...")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    sheets = {}
    for name in SHEET_NAMES:
        ws = wb.create_sheet(name)
        ws.sheet_properties.tabColor = TAB_COLORS[name]
        sheets[name] = ws

    print("Строим БАЗА_ДДС...")
    build_baza(sheets["БАЗА_ДДС"], baza)

    print("Строим ВВОД_КАССА...")
    build_vvod_kassa(sheets["Ввод_Касса"])

    print("Строим ВВОД_РАСХОДЫ...")
    build_vvod_rashody(sheets["Ввод_Расходы"])

    print("Строим ЗАПИСЬ_ВЫПЛАТ...")
    build_zapis_vyplat(sheets["Запись_Выплат"], vyplaty)

    print("Строим НАСТРОЙКИ...")
    build_nastroyki(sheets["Настройки"])

    print("Строим ПУЛЬТ...")
    build_pult(sheets["Пульт"])

    print("Строим КАЛЕНДАРЬ_ВЫПЛАТ...")
    build_calendar(sheets["Календарь_Выплат"])

    print("Строим ДАШБОРД...")
    build_dashboard(sheets["Дашборд"])

    # Stubs for remaining sheets
    for name in SHEET_NAMES:
        if name in ("БАЗА_ДДС", "Ввод_Касса", "Ввод_Расходы",
                    "Запись_Выплат", "Настройки",
                    "Пульт", "Календарь_Выплат", "Дашборд"):
            continue
        ws = sheets[name]
        ws.merge_cells("A1:F1")
        c = ws.cell(1, 1, f"[ {name} ]  —  будет добавлен в следующих блоках")
        c.font = mkfont(GRAY_D, 12, True)
        c.alignment = mkalign("center", "center")
        ws.row_dimensions[1].height = 36

    # Force full recalculation on file open — avoids Excel's
    # "removed and restored" dialog caused by missing calcChain
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.calcMode = "auto"

    out = "WAY_MARKET.xlsx"
    wb.save(out)
    sz = os.path.getsize(out) // 1024
    print(f"\n✓ Сохранено: {out}  ({sz} KB)")
    print(f"  Строк данных в БАЗА_ДДС: {len(baza)}")

    vba_path = write_vba_file("WAY_MARKET_VBA.bas")
    vsz = os.path.getsize(vba_path) // 1024
    print(f"✓ Сохранено: {vba_path}  ({vsz} KB)")

    print("""
═══════════════════════════════════════════════════════════════
  ИНСТРУКЦИЯ
═══════════════════════════════════════════════════════════════
  1. Откройте WAY_MARKET.xlsx в Excel
  2. Alt+F11 → File → Import File → WAY_MARKET_VBA.bas
  3. Назначьте макросы кнопкам (см. .bas внизу)
  4. Файл → Сохранить как → .xlsm
═══════════════════════════════════════════════════════════════""")


if __name__ == "__main__":
    main()
