# -*- coding: utf-8 -*-
"""
Вай Маркет — монолитная учётная система (Storage + UI), скелет .xlsx + VBA .bas.
Слои:
  Storage     : БАЗА_ДДС (скрытая, защищённая, плоский реестр)
  Controllers : VBA-модуль Модуль_ВайМаркет.bas (запись из карточек, сводная, кнопки)
  UI/State    : Настройки · Ввод_Касса · Ввод_Расходы · Пульт · Календарь_Выплат · Сводные
Макрос строится отдельно: Alt+F11 → Import File → .bas → Alt+F8 → УстановитьКнопки.
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Protection
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter

BRAND = "5E5CE6"
LINE = "D9D9E3"
RUB = '#,##0\\ "₽"'
DATEFMT = "DD.MM.YYYY"
PWD = "wm"
R = 5001          # последняя строка данных БАЗА_ДДС (2..5001)
CR = 1001         # последняя строка Календаря (2..1001)

thin = Side(style="thin", color=LINE)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
INPUT_FILL = PatternFill("solid", fgColor="FFF7E6")
RED_FILL = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")


def head_cell(ws, r, c, text, w=None):
    cell = ws.cell(r, c, text)
    cell.font = Font(bold=True, color="FFFFFF", size=11)
    cell.fill = PatternFill("solid", fgColor=BRAND)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = BORDER
    if w:
        ws.column_dimensions[get_column_letter(c)].width = w
    return cell


def label(ws, r, c, text):
    cell = ws.cell(r, c, text)
    cell.font = Font(bold=True)
    return cell


def input_cell(ws, r, c, fmt=None):
    cell = ws.cell(r, c)
    cell.protection = Protection(locked=False)
    cell.fill = INPUT_FILL
    cell.border = BORDER
    if fmt:
        cell.number_format = fmt
    return cell


def title(ws, text):
    t = ws.cell(1, 1, text)
    t.font = Font(bold=True, size=16, color=BRAND)


# ============================================================ Шаг 1: БАЗА_ДДС
def build_baza(wb):
    ws = wb.create_sheet("БАЗА_ДДС")
    headers = ["ID", "Дата", "Тип Операции", "Статья", "Счет",
               "Сумма Дохода", "Сумма Расхода", "Описание", "Месяц", "Год"]
    widths = [8, 12, 16, 20, 14, 14, 14, 30, 8, 8]
    for c, (h, w) in enumerate(zip(headers, widths), start=1):
        head_cell(ws, 1, c, h, w)
    ws.freeze_panes = "A2"
    for r in range(2, R + 1):
        ws.cell(r, 6).number_format = RUB
        ws.cell(r, 7).number_format = RUB
        ws.cell(r, 2).number_format = DATEFMT
        ws.cell(r, 9, f'=IF(B{r}="","",MONTH(B{r}))')
        ws.cell(r, 10, f'=IF(B{r}="","",YEAR(B{r}))')
    ws.sheet_state = "hidden"
    ws.protection.sheet = True
    ws.protection.password = PWD
    ws.sheet_view.showGridLines = False
    return ws


# ============================================================ Шаг 2: Настройки
def build_nastroyki(wb):
    ws = wb.create_sheet("Настройки")
    title(ws, "Настройки системы")
    ws.cell(2, 1, "Заполняется один раз. Списки подставляются в карточки ввода и формулы Пульта.").font = \
        Font(size=10, italic=True, color="8E8E93")
    label(ws, 4, 1, "Начальный остаток долга")
    c = ws.cell(4, 2, 0); c.number_format = RUB; c.border = BORDER; c.fill = INPUT_FILL
    c.protection = Protection(locked=False)
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 16

    head_cell(ws, 6, 4, "Статьи", 22)
    for i, v in enumerate(["Оплата поставщику", "Аренда", "Зарплата", "Налоги", "Коммуналка",
                           "ГСМ", "Расходники", "Хозрасходы", "Выручка", "Прочее"]):
        ws.cell(7 + i, 4, v).border = BORDER
    head_cell(ws, 6, 6, "Счета", 16)
    for i, v in enumerate(["Наличные", "Карта", "Банк"]):
        ws.cell(7 + i, 6, v).border = BORDER
    head_cell(ws, 6, 8, "Тип операции (расход)", 22)
    for i, v in enumerate(["Расход", "Увеличение долга"]):
        ws.cell(7 + i, 8, v).border = BORDER
    head_cell(ws, 6, 10, "Статусы выплат", 18)
    for i, v in enumerate(["Запланировано", "Оплачено", "Просрочено", "Отменено"]):
        ws.cell(7 + i, 10, v).border = BORDER
    ws.sheet_view.showGridLines = False
    return ws


def _dv(ws, formula1, cells):
    from openpyxl.worksheet.datavalidation import DataValidation
    dv = DataValidation(type="list", formula1=formula1, allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(cells)


def _protect(ws):
    ws.protection.sheet = True
    ws.protection.password = PWD
    ws.sheet_view.showGridLines = False


# ============================================================ Шаг 3: Ввод_Касса
def build_vvod_kassa(wb):
    ws = wb.create_sheet("Ввод_Касса")
    title(ws, "Ввод кассы (выручка)")
    ws.cell(2, 1, "Тип операции жёстко «Доход». Заполни и нажми кнопку.").font = \
        Font(size=10, italic=True, color="8E8E93")
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 28
    label(ws, 3, 1, "Дата");        input_cell(ws, 3, 2, DATEFMT)
    label(ws, 4, 1, "Счёт");        input_cell(ws, 4, 2)
    label(ws, 5, 1, "Сумма");       input_cell(ws, 5, 2, RUB)
    label(ws, 6, 1, "Комментарий"); input_cell(ws, 6, 2)
    _dv(ws, "=Настройки!$F$7:$F$9", "B4")
    ws.cell(8, 1, "↓ кнопка «Записать кассу» появится после запуска УстановитьКнопки").font = \
        Font(size=9, italic=True, color="8E8E93")
    _protect(ws)
    return ws


# ============================================================ Шаг 4: Ввод_Расходы
def build_vvod_rashody(wb):
    ws = wb.create_sheet("Ввод_Расходы")
    title(ws, "Ввод расходов и долга")
    ws.cell(2, 1, "Тип «Увеличение долга» долг растит, но кассу НЕ уменьшает.").font = \
        Font(size=10, italic=True, color="8E8E93")
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 28
    label(ws, 3, 1, "Дата");          input_cell(ws, 3, 2, DATEFMT)
    label(ws, 4, 1, "Тип операции");  input_cell(ws, 4, 2)
    label(ws, 5, 1, "Статья");        input_cell(ws, 5, 2)
    label(ws, 6, 1, "Счёт");          input_cell(ws, 6, 2)
    label(ws, 7, 1, "Сумма");         input_cell(ws, 7, 2, RUB)
    label(ws, 8, 1, "Комментарий");   input_cell(ws, 8, 2)
    _dv(ws, "=Настройки!$H$7:$H$8", "B4")
    _dv(ws, "=Настройки!$D$7:$D$16", "B5")
    _dv(ws, "=Настройки!$F$7:$F$9", "B6")
    ws.cell(10, 1, "↓ кнопка «Записать расход» появится после запуска УстановитьКнопки").font = \
        Font(size=9, italic=True, color="8E8E93")
    _protect(ws)
    return ws


# ============================================================ Шаг 5: Пульт
def build_pult(wb):
    ws = wb.create_sheet("Пульт")
    title(ws, "ПУЛЬТ — сводка")
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 20
    label(ws, 3, 1, "Месяц (1-12)"); m = input_cell(ws, 3, 2); m.value = 6
    label(ws, 4, 1, "Год");          y = input_cell(ws, 4, 2); y.value = 2026

    B = "БАЗА_ДДС!"
    def metric(r, name, formula, fmt=RUB, big=False):
        label(ws, r, 1, name)
        c = ws.cell(r, 2, formula); c.number_format = fmt
        c.font = Font(bold=True, size=14 if big else 11, color=BRAND if big else "1C1C1E")
        c.border = BORDER

    metric(6, "Доступные средства",
           f'=SUM({B}F2:F{R})-SUMIF({B}C2:C{R},"Расход",{B}G2:G{R})', big=True)
    metric(7, "Общий долг поставщикам",
           f'=Настройки!B4+SUMIF({B}C2:C{R},"Увеличение долга",{B}G2:G{R})'
           f'-SUMIF({B}D2:D{R},"Оплата поставщику",{B}G2:G{R})', big=True)
    metric(8, "План выплат за месяц",
           f'=SUMIFS(Календарь_Выплат!C3:C{CR},Календарь_Выплат!D3:D{CR},"Запланировано",'
           f'Календарь_Выплат!F3:F{CR},$B$3,Календарь_Выплат!G3:G{CR},$B$4)')
    metric(10, "Доходы за месяц",
           f'=SUMIFS({B}F2:F{R},{B}I2:I{R},$B$3,{B}J2:J{R},$B$4)')
    metric(11, "Расходы за месяц",
           f'=SUMIFS({B}G2:G{R},{B}I2:I{R},$B$3,{B}J2:J{R},$B$4,{B}C2:C{R},"Расход")')

    ws.cell(13, 1, "↓ кнопка «Обновить сводную» появится после УстановитьКнопки").font = \
        Font(size=9, italic=True, color="8E8E93")
    _protect(ws)
    return ws


# ============================================================ Шаг 6: Календарь_Выплат
def build_calendar(wb):
    ws = wb.create_sheet("Календарь_Выплат")
    title(ws, "Календарь выплат")
    heads = ["Дата", "Назначение", "План сумма", "Статус", "Факт сумма", "Месяц", "Год"]
    widths = [12, 26, 14, 16, 14, 8, 8]
    for c, (h, w) in enumerate(zip(heads, widths), start=1):
        head_cell(ws, 2, c, h, w)
    ws.freeze_panes = "A3"
    for r in range(3, CR + 1):
        for c in (1, 2, 3, 4, 5):
            cell = ws.cell(r, c); cell.protection = Protection(locked=False); cell.border = BORDER
        ws.cell(r, 1).number_format = DATEFMT
        ws.cell(r, 3).number_format = RUB
        ws.cell(r, 5).number_format = RUB
        ws.cell(r, 6, f'=IF(A{r}="","",MONTH(A{r}))')
        ws.cell(r, 7, f'=IF(A{r}="","",YEAR(A{r}))')
    _dv(ws, "=Настройки!$J$7:$J$10", f"D3:D{CR}")
    # просрочка: дата < сегодня и статус «Запланировано» → красное
    ws.conditional_formatting.add(
        f"A3:E{CR}",
        FormulaRule(formula=['AND($A3<>"",$A3<TODAY(),$D3="Запланировано")'], fill=RED_FILL))
    _protect(ws)
    return ws


# ============================================================ Лист Сводные (плейсхолдер)
def build_svodnye(wb):
    ws = wb.create_sheet("Сводные")
    title(ws, "Сводные таблицы")
    ws.cell(3, 1, "Нажми «Обновить сводную» на Пульте — макрос построит сводную таблицу "
                  "из БАЗА_ДДС с Временной шкалой (фильтр по дате) и срезами.").font = \
        Font(size=10, italic=True, color="8E8E93")
    ws.column_dimensions["A"].width = 60
    ws.sheet_view.showGridLines = False
    return ws


# ============================================================ VBA-модуль (.bas, cp1251)
VBA = r'''Attribute VB_Name = "Модуль_ВайМаркет"
' ===============================================================
' ВАЙ МАРКЕТ — контроллеры (Storage <- UI), сводная и кнопки.
' Установка: Alt+F11 -> File -> Import File -> этот .bas
'            Alt+F8 -> УстановитьКнопки -> Run
' ===============================================================
Option Explicit

Private Const ПАРОЛЬ As String = "wm"

' --- ВСПОМОГАТЕЛЬНОЕ ---------------------------------------------
Function ПоследняяСтрока(ws As Worksheet) As Long
    ПоследняяСтрока = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
End Function

Function НовыйID(ws As Worksheet) As Long
    Dim лс As Long
    лс = ПоследняяСтрока(ws)
    If лс < 2 Then
        НовыйID = 1
    Else
        НовыйID = Val(ws.Cells(лс, 1).Value) + 1
    End If
End Function

Sub ОбеспечитьМесяцГод(ws As Worksheet, r As Long)
    If ws.Cells(r, 9).Formula = "" Then
        ws.Cells(r, 9).Formula = "=IF(B" & r & "="""","""",MONTH(B" & r & "))"
        ws.Cells(r, 10).Formula = "=IF(B" & r & "="""","""",YEAR(B" & r & "))"
    End If
End Sub

' --- КОНТРОЛЛЕР: КАССА (тип жёстко «Доход») ---------------------
Sub ЗаписатьКассу()
    Dim wsФ As Worksheet, wsБ As Worksheet
    Set wsФ = ThisWorkbook.Sheets("Ввод_Касса")
    Set wsБ = ThisWorkbook.Sheets("БАЗА_ДДС")

    Dim дата As Variant, счет As String, сумма As Variant, ком As String
    дата = wsФ.Range("B3").Value
    счет = Trim(CStr(wsФ.Range("B4").Value))
    сумма = wsФ.Range("B5").Value
    ком = Trim(CStr(wsФ.Range("B6").Value))

    If Not IsDate(дата) Then MsgBox "Укажите корректную дату.", vbExclamation: Exit Sub
    If счет = "" Then MsgBox "Выберите счёт.", vbExclamation: Exit Sub
    If Not IsNumeric(сумма) Then MsgBox "Введите сумму числом.", vbExclamation: Exit Sub
    If CDbl(сумма) <= 0 Then MsgBox "Сумма должна быть больше нуля.", vbExclamation: Exit Sub

    Dim r As Long
    wsБ.Unprotect ПАРОЛЬ
    r = ПоследняяСтрока(wsБ) + 1
    wsБ.Cells(r, 1).Value = НовыйID(wsБ)
    wsБ.Cells(r, 2).Value = CDate(дата)
    wsБ.Cells(r, 3).Value = "Доход"
    wsБ.Cells(r, 4).Value = "Выручка"
    wsБ.Cells(r, 5).Value = счет
    wsБ.Cells(r, 6).Value = CDbl(сумма)
    wsБ.Cells(r, 7).Value = 0
    wsБ.Cells(r, 8).Value = ком
    ОбеспечитьМесяцГод wsБ, r
    wsБ.Protect ПАРОЛЬ

    wsФ.Range("B3:B6").ClearContents
    MsgBox "Касса записана: " & Format(CDbl(сумма), "#,##0") & " руб.", vbInformation
End Sub

' --- КОНТРОЛЛЕР: РАСХОД / УВЕЛИЧЕНИЕ ДОЛГА ----------------------
Sub ЗаписатьРасход()
    Dim wsФ As Worksheet, wsБ As Worksheet
    Set wsФ = ThisWorkbook.Sheets("Ввод_Расходы")
    Set wsБ = ThisWorkbook.Sheets("БАЗА_ДДС")

    Dim дата As Variant, тип As String, статья As String
    Dim счет As String, сумма As Variant, ком As String
    дата = wsФ.Range("B3").Value
    тип = Trim(CStr(wsФ.Range("B4").Value))
    статья = Trim(CStr(wsФ.Range("B5").Value))
    счет = Trim(CStr(wsФ.Range("B6").Value))
    сумма = wsФ.Range("B7").Value
    ком = Trim(CStr(wsФ.Range("B8").Value))

    If Not IsDate(дата) Then MsgBox "Укажите корректную дату.", vbExclamation: Exit Sub
    If тип <> "Расход" And тип <> "Увеличение долга" Then _
        MsgBox "Выберите тип операции.", vbExclamation: Exit Sub
    If статья = "" Then MsgBox "Выберите статью.", vbExclamation: Exit Sub
    If счет = "" Then MsgBox "Выберите счёт.", vbExclamation: Exit Sub
    If Not IsNumeric(сумма) Then MsgBox "Введите сумму числом.", vbExclamation: Exit Sub
    If CDbl(сумма) <= 0 Then MsgBox "Сумма должна быть больше нуля.", vbExclamation: Exit Sub

    Dim r As Long
    wsБ.Unprotect ПАРОЛЬ
    r = ПоследняяСтрока(wsБ) + 1
    wsБ.Cells(r, 1).Value = НовыйID(wsБ)
    wsБ.Cells(r, 2).Value = CDate(дата)
    wsБ.Cells(r, 3).Value = тип
    wsБ.Cells(r, 4).Value = статья
    wsБ.Cells(r, 5).Value = счет
    wsБ.Cells(r, 6).Value = 0
    wsБ.Cells(r, 7).Value = CDbl(сумма)
    wsБ.Cells(r, 8).Value = ком
    ОбеспечитьМесяцГод wsБ, r
    wsБ.Protect ПАРОЛЬ

    wsФ.Range("B3:B8").ClearContents
    MsgBox "Записано: " & тип & " — " & Format(CDbl(сумма), "#,##0") & " руб.", vbInformation
End Sub

' --- СВОДНАЯ + ВРЕМЕННАЯ ШКАЛА (фильтр по дате/времени) ---------
Sub ПостроитьСводные()
    Dim wsБ As Worksheet, wsС As Worksheet
    Dim pc As PivotCache, pt As PivotTable
    Dim лс As Long, рнг As Range
    Set wsБ = ThisWorkbook.Sheets("БАЗА_ДДС")
    лс = ПоследняяСтрока(wsБ)
    If лс < 2 Then MsgBox "Нет данных для сводной.", vbExclamation: Exit Sub

    Application.DisplayAlerts = False
    On Error Resume Next
    ThisWorkbook.Sheets("Сводные").Delete
    On Error GoTo 0
    Application.DisplayAlerts = True
    Set wsС = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
    wsС.Name = "Сводные"

    Set рнг = wsБ.Range("A1:J" & лс)
    Set pc = ThisWorkbook.PivotCaches.Create(xlDatabase, рнг)
    Set pt = pc.CreatePivotTable(wsС.Range("B8"), "СводнаяДДС")
    With pt
        .PivotFields("Статья").Orientation = xlRowField
        .PivotFields("Тип Операции").Orientation = xlColumnField
        .AddDataField .PivotFields("Сумма Дохода"), "Доход", xlSum
        .AddDataField .PivotFields("Сумма Расхода"), "Расход", xlSum
        .ShowTableStyleRowStripes = True
    End With

    ' Временная шкала по дате (Excel 2013+); срез по счёту — если доступно
    On Error Resume Next
    Dim scT As SlicerCache
    Set scT = ThisWorkbook.SlicerCaches.Add2(pt, "Дата", , xlTimeline)
    scT.Slicers.Add wsС, , "ШкалаДата", "Период", 6, 350, 280, 100
    Dim scS As SlicerCache
    Set scS = ThisWorkbook.SlicerCaches.Add2(pt, "Счет")
    scS.Slicers.Add wsС, , "СрезСчет", "Счёт", 130, 350, 160, 120
    On Error GoTo 0

    wsС.Activate
    MsgBox "Сводная построена. Период фильтруй Временной шкалой сверху.", vbInformation
End Sub

' --- УСТАНОВКА КНОПОК -------------------------------------------
Sub ДобавитьКнопку(имяЛиста As String, макрос As String, подпись As String, адрес As String)
    Dim ws As Worksheet, b As Button, shp As Shape
    Set ws = ThisWorkbook.Sheets(имяЛиста)
    ws.Unprotect ПАРОЛЬ
    For Each shp In ws.Shapes
        If shp.Type = msoFormControl Then shp.Delete
    Next shp
    Set b = ws.Buttons.Add(ws.Range(адрес).Left, ws.Range(адрес).Top, 150, 34)
    b.OnAction = макрос
    b.Caption = подпись
    ws.Protect ПАРОЛЬ
End Sub

Sub УстановитьКнопки()
    ДобавитьКнопку "Ввод_Касса", "ЗаписатьКассу", "Записать кассу", "B8"
    ДобавитьКнопку "Ввод_Расходы", "ЗаписатьРасход", "Записать расход", "B10"
    ДобавитьКнопку "Пульт", "ПостроитьСводные", "Обновить сводную", "B13"
    MsgBox "Кнопки установлены.", vbInformation
End Sub
'''


def write_bas():
    name = "Модуль_ВайМаркет.bas"
    with open(name, "wb") as f:
        f.write(VBA.replace("\n", "\r\n").encode("cp1251"))
    return name


def main():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    build_baza(wb)
    build_nastroyki(wb)
    build_vvod_kassa(wb)
    build_vvod_rashody(wb)
    build_pult(wb)
    build_calendar(wb)
    build_svodnye(wb)
    out = "Вай_Маркет.xlsx"
    wb.save(out)
    bas = write_bas()
    print("saved", out, "| листы:", [s.title for s in wb.worksheets])
    print("saved", bas)


if __name__ == "__main__":
    main()
