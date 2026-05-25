Attribute VB_Name = "WayMarketMacros"
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
'  УСТАНОВКА КНОПОК — ЗАПУСТИТЬ ОДИН РАЗ
'  После импорта .bas:  Alt+F8 → SetupAll → Выполнить
'  Добавляет кнопки-фигуры с макросами + автокомплит.
' ═══════════════════════════════════════════════════════════════
Public Sub SetupAll()
    Application.ScreenUpdating = False

    Dim wsK As Worksheet, wsR As Worksheet
    Dim wsC As Worksheet, wsD As Worksheet
    Set wsK = ThisWorkbook.Worksheets(SH_KASSA)
    Set wsR = ThisWorkbook.Worksheets(SH_RASH)
    Set wsC = ThisWorkbook.Worksheets(SH_CAL)
    Set wsD = ThisWorkbook.Worksheets(SH_DASH)

    ' ── Ввод_Касса ──────────────────────────────────────────────
    Call AddBtn(wsK, "A16:G16", "  СОХРАНИТЬ КАССУ", _
                "WayMarketMacros.SaveKassa", RGB(5, 150, 105))
    Call AddBtn(wsK, "E4:F4", "  СЕГОДНЯ", _
                "WayMarketMacros.InsertToday_Kassa", RGB(29, 78, 216))

    ' ── Ввод_Расходы ────────────────────────────────────────────
    Call AddBtn(wsR, "A16:D16", "  СОХРАНИТЬ", _
                "WayMarketMacros.SaveRashod", RGB(5, 150, 105))
    Call AddBtn(wsR, "C3:D3", "  СЕГОДНЯ", _
                "WayMarketMacros.InsertToday_Rashod", RGB(29, 78, 216))

    ' ── Календарь_Выплат ────────────────────────────────────────
    Call AddBtn(wsC, "I3:J3", "  СЕГОДНЯ", _
                "WayMarketMacros.InsertToday_Calendar", RGB(29, 78, 216))

    ' ── Дашборд ─────────────────────────────────────────────────
    Call AddBtn(wsD, "K3:L3", "  ОБНОВИТЬ", _
                "WayMarketMacros.RefreshDashboard", RGB(217, 119, 6))

    ' ── Автокомплит (Worksheet_Change) ──────────────────────────
    Call TryInjectAutocomplete

    Application.ScreenUpdating = True
    MsgBox "Кнопки установлены!" & vbCrLf & _
           "Сохраните файл как .xlsm чтобы сохранить макросы.", _
           vbInformation, "WAY MARKET — Установка завершена"
End Sub


Private Sub AddBtn(ws As Worksheet, rngAddr As String, caption As String, _
                   macro As String, clr As Long)
    Dim rng As Range
    Set rng = ws.Range(rngAddr)

    ' Удалить предыдущую кнопку с тем же макросом
    Dim shp As Shape
    For Each shp In ws.Shapes
        If shp.OnAction = macro Then shp.Delete: Exit For
    Next shp

    ' Добавить прямоугольную фигуру с назначенным макросом
    Set shp = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
        rng.Left + 1, rng.Top + 1, rng.Width - 2, rng.Height - 2)

    shp.OnAction = macro
    shp.Fill.ForeColor.RGB = clr
    shp.Fill.Solid
    shp.Line.Visible = msoFalse

    On Error Resume Next
    shp.TextFrame2.TextRange.Text = caption
    shp.TextFrame2.TextRange.Font.Bold = True
    shp.TextFrame2.TextRange.Font.Size = 12
    shp.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    shp.TextFrame2.VerticalAnchor = msoAnchorMiddle
    shp.TextFrame2.TextRange.ParagraphFormat.Alignment = ppAlignCenter
    On Error GoTo 0
End Sub


Private Sub TryInjectAutocomplete()
    ' Требует: Файл → Параметры → Центр управления безопасностью →
    '   Параметры макросов → "Доверять доступу к объектной модели VBA"
    On Error GoTo noAccess

    Dim proj As Object
    Set proj = ThisWorkbook.VBProject

    Call InjectWSChange(ThisWorkbook.Worksheets(SH_KASSA), _
        "Private Sub Worksheet_Change(ByVal Target As Range)" & vbCrLf & _
        "    If Target.Cells.Count > 1 Then Exit Sub" & vbCrLf & _
        "    If Target.Address = ""$F$3"" Then" & vbCrLf & _
        "        Call WayMarketMacros.AC_Kassa(Target)" & vbCrLf & _
        "    End If" & vbCrLf & _
        "End Sub")

    Call InjectWSChange(ThisWorkbook.Worksheets(SH_RASH), _
        "Private Sub Worksheet_Change(ByVal Target As Range)" & vbCrLf & _
        "    If Target.Cells.Count > 1 Then Exit Sub" & vbCrLf & _
        "    If Target.Address = ""$B$6"" Then" & vbCrLf & _
        "        Call WayMarketMacros.AC_Category(Target)" & vbCrLf & _
        "    ElseIf Target.Address = ""$B$12"" Then" & vbCrLf & _
        "        Call WayMarketMacros.AC_Supplier(Target)" & vbCrLf & _
        "    End If" & vbCrLf & _
        "End Sub")
    Exit Sub

noAccess:
    ' Кнопки работают и без этой настройки. Только автокомплит при наборе недоступен.
End Sub


Private Sub InjectWSChange(ws As Worksheet, code As String)
    Dim cm As Object
    Set cm = ThisWorkbook.VBProject.VBComponents(ws.CodeName).CodeModule
    If InStr(1, cm.Lines(1, cm.CountOfLines), "Worksheet_Change") = 0 Then
        cm.InsertLines cm.CountOfLines + 1, vbCrLf & code
    End If
End Sub


' ═══════════════════════════════════════════════════════════════
'  КАК ИСПОЛЬЗОВАТЬ:
'  1) Открыть WAY_MARKET.xlsx в Excel
'  2) Alt+F11 → File → Import File → выбрать WAY_MARKET_VBA.bas
'  3) Alt+F8 → выбрать "SetupAll" → нажать "Выполнить"
'     Кнопки появятся на листах, макросы назначатся автоматически.
'  4) Файл → Сохранить как → Книга Excel с поддержкой макросов (.xlsm)
' ═══════════════════════════════════════════════════════════════
