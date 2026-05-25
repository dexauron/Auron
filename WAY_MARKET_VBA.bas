Attribute VB_Name = "WayMarketMacros"
' ═══════════════════════════════════════════════════════════════
'  WAY MARKET — VBA Macros
'  Импорт: Alt+F11 → File → Import File → выбрать этот .bas
'  Назначить кнопкам: правый клик по кнопке → Назначить макрос
' ═══════════════════════════════════════════════════════════════

Option Explicit

' ── Константы ──
Private Const SH_BAZA  As String = "БАЗА_ДДС"
Private Const SH_KASSA As String = "Ввод_Касса"
Private Const SH_RASH  As String = "Ввод_Расходы"
Private Const SH_VYPL  As String = "Запись_Выплат"
Private Const SH_CAL   As String = "Календарь_Выплат"
Private Const SH_DASH  As String = "Дашборд"
Private Const SH_PULT  As String = "Пульт"

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
'  ВСТАВКА В МОДУЛЬ ЛИСТА Календарь_Выплат:
'  Скопировать в модуль листа (правый клик по вкладке → View Code)
' ═══════════════════════════════════════════════════════════════
'  Private Sub Worksheet_SelectionChange(ByVal Target As Range)
'      ' Реакция на клик по дате в календаре (строки 7..36, колонки A..G)
'      If Target.Cells.Count > 1 Then Exit Sub
'      Dim r As Long: r = Target.Row
'      Dim c As Long: c = Target.Column
'      If c < 1 Or c > 7 Then Exit Sub
'      If (r - 7) Mod 5 <> 0 Then Exit Sub  ' только строки с числом дня
'      If Not IsNumeric(Target.Value) Then Exit Sub
'      If Target.Value = "" Then Exit Sub
'
'      ' Подсветить выбранную ячейку
'      Application.ScreenUpdating = False
'      Me.Range("A7:G36").Interior.Pattern = xlNone
'      Target.Interior.Color = RGB(254, 240, 138)
'      Application.ScreenUpdating = True
'  End Sub
'
'  Private Sub Worksheet_Activate()
'      ' Установить текущий месяц/год при открытии листа
'      Module1.InsertToday_Calendar
'  End Sub
'
' ═══════════════════════════════════════════════════════════════
'  КАК ИСПОЛЬЗОВАТЬ:
'  1) Открыть файл в Excel
'  2) Alt+F11 → File → Import File → выбрать этот .bas файл
'  3) Назначить макросы кнопкам:
'     - Ввод_Касса!A16 → SaveKassa
'     - Ввод_Касса!E4  → InsertToday_Kassa
'     - Ввод_Расходы!A16 → SaveRashod
'     - Ввод_Расходы!C3  → InsertToday_Rashod
'     - Календарь!I3 → InsertToday_Calendar
'     - Дашборд!K3  → RefreshDashboard
'  4) Файл → Сохранить как → Тип файла: Книга Excel с поддержкой макросов (.xlsm)
' ═══════════════════════════════════════════════════════════════
