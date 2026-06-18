# -*- coding: utf-8 -*-
"""
Вай Маркет — монолитная учётная система (Storage + UI), скелет .xlsx.
Макросы (Controllers) поставляются отдельным .bas-модулем (см. репозиторий).
Слои: БАЗА_ДДС (Storage, скрытая) · Настройки · Ввод_Касса · Ввод_Расходы ·
      Пульт · Календарь_Выплат (UI).
Собирается пошагово. Сейчас реализованы: Шаг 1 (БАЗА_ДДС), Шаг 2 (Настройки).
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BRAND = "5E5CE6"
LINE = "D9D9E3"
RUB = '#,##0\\ "₽"'
DATA_ROWS = 5000  # ёмкость реестра

thin = Side(style="thin", color=LINE)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

def head_cell(ws, r, c, text, w=None):
    cell = ws.cell(r, c, text)
    cell.font = Font(bold=True, color="FFFFFF", size=11)
    cell.fill = PatternFill("solid", fgColor=BRAND)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = BORDER
    if w:
        ws.column_dimensions[get_column_letter(c)].width = w
    return cell


# ============================================================ Шаг 1: БАЗА_ДДС
def build_baza(wb):
    ws = wb.create_sheet("БАЗА_ДДС")
    headers = ["ID", "Дата", "Тип Операции", "Статья", "Счет",
               "Сумма Дохода", "Сумма Расхода", "Описание", "Месяц", "Год"]
    widths = [8, 12, 16, 20, 14, 14, 14, 30, 8, 8]
    for c, (h, w) in enumerate(zip(headers, widths), start=1):
        head_cell(ws, 1, c, h, w)
    ws.freeze_panes = "A2"
    # Месяц/Год вычисляются формулами листа (как в ТЗ — "вычисляются формулами")
    for r in range(2, 2 + DATA_ROWS):
        ws.cell(r, 6).number_format = RUB          # Сумма Дохода
        ws.cell(r, 7).number_format = RUB          # Сумма Расхода
        ws.cell(r, 9, f'=IF(B{r}="","",MONTH(B{r}))')   # Месяц
        ws.cell(r, 10, f'=IF(B{r}="","",YEAR(B{r}))')   # Год
    # Скрытый реестр + защита (ручной ввод запрещён; макрос снимает/ставит защиту)
    ws.sheet_state = "hidden"
    ws.protection.sheet = True
    ws.protection.password = "wm"
    ws.sheet_view.showGridLines = False
    return ws


# ============================================================ Шаг 2: Настройки
def build_nastroyki(wb):
    ws = wb.create_sheet("Настройки")
    t = ws.cell(1, 1, "Настройки системы")
    t.font = Font(bold=True, size=16, color=BRAND)
    ws.cell(2, 1, "Заполняется один раз. Списки отсюда подставляются в карточки ввода и формулы Пульта.").font = \
        Font(size=10, italic=True, color="8E8E93")

    # --- Начальный остаток долга (константа) ---
    ws.cell(4, 1, "Начальный остаток долга").font = Font(bold=True)
    c = ws.cell(4, 2, 0); c.number_format = RUB; c.border = BORDER
    c.fill = PatternFill("solid", fgColor="FFF7E6")
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 16

    # --- Справочники (списки для валидации) ---
    head_cell(ws, 6, 4, "Статьи", 22)
    statyi = ["Оплата поставщику", "Аренда", "Зарплата", "Налоги",
              "Коммуналка", "ГСМ", "Расходники", "Хозрасходы", "Выручка", "Прочее"]
    for i, v in enumerate(statyi):
        cell = ws.cell(7 + i, 4, v); cell.border = BORDER

    head_cell(ws, 6, 6, "Счета", 16)
    scheta = ["Наличные", "Карта", "Банк"]
    for i, v in enumerate(scheta):
        cell = ws.cell(7 + i, 6, v); cell.border = BORDER

    head_cell(ws, 6, 8, "Тип операции (расход)", 22)
    tipy = ["Расход", "Увеличение долга"]
    for i, v in enumerate(tipy):
        cell = ws.cell(7 + i, 8, v); cell.border = BORDER

    head_cell(ws, 6, 10, "Статусы выплат", 18)
    statusy = ["Запланировано", "Оплачено", "Просрочено", "Отменено"]
    for i, v in enumerate(statusy):
        cell = ws.cell(7 + i, 10, v); cell.border = BORDER

    ws.sheet_view.showGridLines = False
    return ws


def main():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # убрать дефолтный лист
    build_baza(wb)
    build_nastroyki(wb)
    out = "Вай_Маркет.xlsx"
    wb.save(out)
    print("saved", out, "| листы:", [s.title for s in wb.worksheets])


if __name__ == "__main__":
    main()
