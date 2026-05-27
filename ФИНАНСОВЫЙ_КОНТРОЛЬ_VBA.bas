Attribute VB_Name = "FinKontrolMacros"
' ===============================================================
'  ФИНАНСОВЫЙ КОНТРОЛЬ — VBA Macros
'  Импорт: Alt+F11 -> File -> Import File -> выбрать этот .bas
'  Назначить кнопкам: правый клик по кнопке -> Назначить макрос
' ===============================================================

Option Explicit

' -- Константы — имена листов --
Private Const SH_BAZA  As String = "БАЗА_ДДС"
Private Const SH_KASSA As String = "Ввод_Касса"
Private Const SH_RASH  As String = "Ввод_Расходы"
Private Const SH_VYPL  As String = "Запись_Выплат"
Private Const SH_CAL   As String = "Календарь_Выплат"
Private Const SH_DASH  As String = "Дашборд"
Private Const SH_PULT  As String = "Пульт"
Private Const SH_SETS  As String = "Настройки"
Private Const SH_SVOD  As String = "Сводные"

' -- Автокомплит: вспомогательные колонки в Настройки --
' Col I (9) = фильтр Кассиры, Col J (10) = Категории, Col K (11) = Поставщики
Private Const AC_COL_KASSA As Integer = 9
Private Const AC_COL_CAT   As Integer = 10
Private Const AC_COL_SUP   As Integer = 11
Private Const AC_MAX_ROWS  As Integer = 15

' ===============================================================
'  SAVE KASSA — Сохранить кассу в БАЗА_ДДС
'  Назначить на кнопку A17:G17 на листе Ввод_Касса
' ===============================================================
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

    ' Добавляем строки через ListObject — таблица расширяется автоматически
    Dim tblB As ListObject
    Set tblB = wsB.ListObjects("tblБаза")

    ' 3 Приход-строки (Наличные, Карта, Перевод)
    Dim methods As Variant, i As Long, r As Long
    Dim factVal As Double, zVal As Double, discVal As Double
    methods = Array("Наличные", "Карта", "Перевод")
    For i = 0 To 2
        r = tblB.ListRows.Add.Range.Row
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
        If discVal <> 0 Then wsB.Cells(r, 8).Value = discVal
        wsB.Cells(r, 9).Value = CStr(wsK.Range("E13").Value)
        wsB.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
        wsB.Cells(r, 7).NumberFormat = "#,##0"
        wsB.Cells(r, 8).NumberFormat = "#,##0"
    Next i

    ' Выплата из кассы (D14) — если сумма > 0
    Dim vyplAmt As Double
    vyplAmt = CDbl(Nz(wsK.Range("D14").Value))
    If vyplAmt > 0 Then
        r = tblB.ListRows.Add.Range.Row
        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = shVal
        wsB.Cells(r, 3).Value = cashVal
        wsB.Cells(r, 4).Value = "Расход"
        wsB.Cells(r, 5).Value = "Выплата"
        wsB.Cells(r, 6).Value = "Наличные"
        wsB.Cells(r, 7).Value = vyplAmt
        wsB.Cells(r, 8).Value = ""
        wsB.Cells(r, 9).Value = "Выплата из кассы"
        wsB.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
        wsB.Cells(r, 7).NumberFormat = "#,##0"
    End If

    ' Очистить форму
    wsK.Range("B3").ClearContents
    wsK.Range("D3").ClearContents
    wsK.Range("F3").ClearContents
    For i = 8 To 10
        wsK.Cells(i, 2).Value = 0
        wsK.Cells(i, 3).Value = 0
    Next i
    wsK.Range("D14").Value = 0
    wsK.Range("E13").ClearContents

    MsgBox "Сохранено в БАЗА_ДДС за " & Format(dtVal, "DD.MM.YYYY") _
           & " (" & shVal & ", " & cashVal & ")", _
           vbInformation, "Касса сохранена"
End Sub


' ===============================================================
'  SAVE RASHOD — Сохранить расход или закуп в долг в БАЗА_ДДС
'  Назначить на кнопку A16:D16 на листе Ввод_Расходы
' ===============================================================
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

    Dim tblB As ListObject
    Set tblB = wsB.ListObjects("tblБаза")
    Dim r As Long

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

        r = tblB.ListRows.Add.Range.Row
        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = ""
        wsB.Cells(r, 3).Value = ""
        wsB.Cells(r, 4).Value = "Расход"
        wsB.Cells(r, 5).Value = catVal
        wsB.Cells(r, 6).Value = mthVal
        wsB.Cells(r, 7).Value = rashSum
        wsB.Cells(r, 8).Value = ""
        wsB.Cells(r, 9).Value = CStr(wsR.Range("B9").Value)

        MsgBox "Расход сохранён: " & Format(rashSum, "#,##0") & " " & ChrW(8381) & " (" & catVal & ")", _
               vbInformation, "Расход"
    Else
        ' Закуп в долг
        Dim supVal As String
        supVal = CStr(wsR.Range("B12").Value)
        If Len(Trim(supVal)) = 0 Then
            MsgBox "Выберите поставщика (B12)", vbExclamation, "Долг"
            Exit Sub
        End If

        r = tblB.ListRows.Add.Range.Row
        wsB.Cells(r, 1).Value = CDate(dtVal)
        wsB.Cells(r, 2).Value = ""
        wsB.Cells(r, 3).Value = ""
        wsB.Cells(r, 4).Value = "Долг"
        wsB.Cells(r, 5).Value = "Закуп товара"
        wsB.Cells(r, 6).Value = "Перевод"
        wsB.Cells(r, 7).Value = dolgSum
        wsB.Cells(r, 8).Value = ""
        wsB.Cells(r, 9).Value = supVal

        MsgBox "Закуп в долг сохранён: " & Format(dolgSum, "#,##0") & " " & ChrW(8381) & _
               " (" & supVal & ")" & vbCrLf & vbCrLf & _
               "Не забудьте добавить запись в ЗАПИСЬ_ВЫПЛАТ для планирования оплаты!", _
               vbInformation, "Долг"
    End If

    ' Форматирование новой строки
    wsB.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
    wsB.Cells(r, 7).NumberFormat = "#,##0"

    ' Очистить форму
    wsR.Range("B3").ClearContents
    wsR.Range("B6").ClearContents
    wsR.Range("B7").ClearContents
    wsR.Range("B8").Value = 0
    wsR.Range("B9").ClearContents
    wsR.Range("B12").ClearContents
    wsR.Range("B13").Value = 0
End Sub


' ===============================================================
'  INSERT TODAY — Кнопки СЕГОДНЯ
' ===============================================================
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


' ===============================================================
'  REFRESH DASHBOARD — Пересчёт + обновление всех таблиц
' ===============================================================
Public Sub RefreshDashboard()
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic
    Application.CalculateFull
    ThisWorkbook.RefreshAll
    Application.ScreenUpdating = True
    MsgBox "Все формулы и сводные пересчитаны.", vbInformation, "Обновление"
End Sub


' ===============================================================
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
'  --- Вставить в модуль листа "Ввод_Касса" ------------------
'  (правый клик на вкладку -> "Просмотр кода", вставить ниже)
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$F$3" Then
'          Call FinKontrolMacros.AC_Kassa(Target)
'      End If
'  End Sub
'
'  --- Вставить в модуль листа "Ввод_Расходы" ----------------
'
'  Private Sub Worksheet_Change(ByVal Target As Range)
'      If Target.Cells.Count > 1 Then Exit Sub
'      If Target.Address = "$B$6" Then
'          Call FinKontrolMacros.AC_Category(Target)
'      ElseIf Target.Address = "$B$12" Then
'          Call FinKontrolMacros.AC_Supplier(Target)
'      End If
'  End Sub
'
' ===============================================================

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
    colLetter = Chr(64 + helperCol)   ' 9->I, 10->J, 11->K
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

' -- Публичные методы — вызываются из Worksheet_Change листов --

Public Sub AC_Kassa(inputCell As Range)
    ' Читаем кассиров из Настройки Р7 (столбец B, строки 22+)
    Dim wsS As Worksheet
    Set wsS = ThisWorkbook.Worksheets(SH_SETS)
    Dim startRow As Long, n As Long, i As Long
    startRow = 22
    n = 0
    Do While Len(CStr(wsS.Cells(startRow + n, 2).Value)) > 0
        n = n + 1
    Loop
    If n = 0 Then Exit Sub
    Dim lst() As String
    ReDim lst(n - 1)
    For i = 0 To n - 1
        lst(i) = CStr(wsS.Cells(startRow + i, 2).Value)
    Next i
    Call AC_DoFilter(inputCell, lst, AC_COL_KASSA)
End Sub

Public Sub AC_Category(inputCell As Range)
    ' Читаем категории из Настройки Р7 (столбец C, строки 22+)
    Dim wsS As Worksheet
    Set wsS = ThisWorkbook.Worksheets(SH_SETS)
    Dim startRow As Long, n As Long, i As Long
    startRow = 22
    n = 0
    Do While Len(CStr(wsS.Cells(startRow + n, 3).Value)) > 0
        n = n + 1
    Loop
    If n = 0 Then Exit Sub
    Dim lst() As String
    ReDim lst(n - 1)
    For i = 0 To n - 1
        lst(i) = CStr(wsS.Cells(startRow + i, 3).Value)
    Next i
    Call AC_DoFilter(inputCell, lst, AC_COL_CAT)
End Sub

Public Sub AC_Supplier(inputCell As Range)
    ' Читаем поставщиков из Настройки P9 (столбец C, строки 79+)
    ' Добавляй новых поставщиков прямо в таблицу Настройки — список бесконечный
    Dim wsS As Worksheet
    Set wsS = ThisWorkbook.Worksheets(SH_SETS)
    Dim startRow As Long, n As Long, i As Long
    startRow = 79
    n = 0
    Do While Len(CStr(wsS.Cells(startRow + n, 3).Value)) > 0
        n = n + 1
    Loop
    If n = 0 Then Exit Sub
    Dim lst() As String
    ReDim lst(n - 1)
    For i = 0 To n - 1
        lst(i) = CStr(wsS.Cells(startRow + i, 3).Value)
    Next i
    Call AC_DoFilter(inputCell, lst, AC_COL_SUP)
End Sub


' ===============================================================
'  УТИЛИТЫ
' ===============================================================
Private Function Nz(v As Variant) As Variant
    If IsEmpty(v) Or IsNull(v) Or (VarType(v) = vbString And v = "") Then
        Nz = 0
    Else
        Nz = v
    End If
End Function


' ===============================================================
'  УСТАНОВКА КНОПОК — ЗАПУСТИТЬ ОДИН РАЗ
'  После импорта .bas:  Alt+F8 -> SetupAll -> Выполнить
'  Добавляет кнопки-фигуры с макросами + автокомплит.
' ===============================================================
Public Sub SetupAll()
    On Error GoTo setupErr
    Application.ScreenUpdating = False

    Dim wsK As Worksheet, wsR As Worksheet
    Dim wsC As Worksheet, wsD As Worksheet
    Set wsK = ThisWorkbook.Worksheets(SH_KASSA)
    Set wsR = ThisWorkbook.Worksheets(SH_RASH)
    Set wsC = ThisWorkbook.Worksheets(SH_CAL)
    Set wsD = ThisWorkbook.Worksheets(SH_DASH)

    ' -- Ввод_Касса ----------------------------------------------
    Call AddBtn(wsK, "A17:G17", "  СОХРАНИТЬ КАССУ", _
                "FinKontrolMacros.SaveKassa", RGB(5, 150, 105))
    Call AddBtn(wsK, "E4:F4", "  СЕГОДНЯ", _
                "FinKontrolMacros.InsertToday_Kassa", RGB(29, 78, 216))

    ' -- Ввод_Расходы --------------------------------------------
    Call AddBtn(wsR, "A16:D16", "  СОХРАНИТЬ", _
                "FinKontrolMacros.SaveRashod", RGB(5, 150, 105))
    Call AddBtn(wsR, "C3:D3", "  СЕГОДНЯ", _
                "FinKontrolMacros.InsertToday_Rashod", RGB(29, 78, 216))

    ' -- Календарь_Выплат ----------------------------------------
    Call AddBtn(wsC, "I3:J3", "  СЕГОДНЯ", _
                "FinKontrolMacros.InsertToday_Calendar", RGB(29, 78, 216))

    ' -- Дашборд -------------------------------------------------
    Call AddBtn(wsD, "K3:L3", "  ОБНОВИТЬ", _
                "FinKontrolMacros.RefreshDashboard", RGB(217, 119, 6))

    ' -- Сводные -------------------------------------------------
    Call AddBtn(ThisWorkbook.Worksheets(SH_SVOD), "A3:L3", _
                "  СОЗДАТЬ СВОДНЫЕ ТАБЛИЦЫ", _
                "FinKontrolMacros.CreatePivotTables", RGB(14, 116, 144))

    ' -- Автокомплит (Worksheet_Change) --------------------------
    Call TryInjectAutocomplete

    Application.ScreenUpdating = True
    MsgBox "Кнопки установлены!" & vbCrLf & _
           "Сохраните файл как .xlsm чтобы сохранить макросы.", _
           vbInformation, "ФИНАНСОВЫЙ КОНТРОЛЬ — Установка завершена"
    Exit Sub
setupErr:
    Application.ScreenUpdating = True
    MsgBox "Ошибка установки: " & Err.Description, vbCritical, "SetupAll"
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
    shp.TextFrame2.TextRange.ParagraphFormat.Alignment = 2  ' ppAlignCenter=2 (mso center); ppAlignCenter not in Excel VBA
    On Error GoTo 0
End Sub


Private Sub TryInjectAutocomplete()
    ' Требует: Файл -> Параметры -> Центр управления безопасностью ->
    '   Параметры макросов -> "Доверять доступу к объектной модели VBA"
    On Error GoTo noAccess

    Dim proj As Object
    Set proj = ThisWorkbook.VBProject

    Call InjectWSChange(ThisWorkbook.Worksheets(SH_KASSA), _
        "Private Sub Worksheet_Change(ByVal Target As Range)" & vbCrLf & _
        "    If Target.Cells.Count > 1 Then Exit Sub" & vbCrLf & _
        "    If Target.Address = ""$F$3"" Then" & vbCrLf & _
        "        Call FinKontrolMacros.AC_Kassa(Target)" & vbCrLf & _
        "    End If" & vbCrLf & _
        "End Sub")

    Call InjectWSChange(ThisWorkbook.Worksheets(SH_RASH), _
        "Private Sub Worksheet_Change(ByVal Target As Range)" & vbCrLf & _
        "    If Target.Cells.Count > 1 Then Exit Sub" & vbCrLf & _
        "    If Target.Address = ""$B$6"" Then" & vbCrLf & _
        "        Call FinKontrolMacros.AC_Category(Target)" & vbCrLf & _
        "    ElseIf Target.Address = ""$B$12"" Then" & vbCrLf & _
        "        Call FinKontrolMacros.AC_Supplier(Target)" & vbCrLf & _
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


' ===============================================================
'  СВОДНЫЕ ТАБЛИЦЫ — реальные Excel PivotTables из tblБаза
'  Alt+F8 -> CreatePivotTables -> Выполнить  (или нажать кнопку на листе)
' ===============================================================
Public Sub CreatePivotTables()
    On Error GoTo pivErr
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    Dim wbk As Workbook
    Set wbk = ThisWorkbook

    Dim wsSrc As Worksheet
    Set wsSrc = wbk.Worksheets(SH_BAZA)

    Dim wsPT As Worksheet
    Set wsPT = wbk.Worksheets(SH_SVOD)

    ' Очистить старые сводные таблицы
    Dim pt As PivotTable
    For Each pt In wsPT.PivotTables
        pt.TableRange2.Clear
    Next pt

    ' Источник — умная таблица tblБаза
    Dim tbl As ListObject
    Set tbl = wsSrc.ListObjects("tblБаза")
    Dim srcAddr As String
    srcAddr = "'" & wsSrc.Name & "'!" & tbl.Range.Address

    ' Создать общий PivotCache
    Dim pc As PivotCache
    Set pc = wbk.PivotCaches.Create(SourceType:=xlDatabase, SourceData:=srcAddr)

    ' -- ПТ1: Выручка по месяцам ---------------------------------
    Dim pt1 As PivotTable
    Set pt1 = pc.CreatePivotTable( _
        TableDestination:=wsPT.Cells(10, 2), TableName:="PT_VyruchkaMesyac")
    With pt1
        With .PivotFields("Тип")
            .Orientation = xlPageField
            .CurrentPage = "Приход"
        End With
        With .PivotFields("Дата")
            .Orientation = xlRowField
            .Position = 1
        End With
        With .PivotFields("Сумма")
            .Orientation = xlDataField
            .Function = xlSum
            .NumberFormat = "#,##0"
            .Name = "Выручка (руб.)"
        End With
        .NullString = "0"
        .RowAxisLayout xlTabularRow
    End With
    On Error Resume Next
    pt1.PivotFields("Дата").AutoGroup
    On Error GoTo pivErr

    ' -- ПТ2: Расходы по категориям ------------------------------
    Dim pt2 As PivotTable
    Set pt2 = pc.CreatePivotTable( _
        TableDestination:=wsPT.Cells(10, 9), TableName:="PT_RaskhodKat")
    With pt2
        With .PivotFields("Тип")
            .Orientation = xlPageField
            .CurrentPage = "Расход"
        End With
        With .PivotFields("Категория")
            .Orientation = xlRowField
            .Position = 1
        End With
        With .PivotFields("Сумма")
            .Orientation = xlDataField
            .Function = xlSum
            .NumberFormat = "#,##0"
            .Name = "Сумма расходов"
        End With
        .NullString = "0"
    End With

    ' -- ПТ3: Выручка кассиры x смены ----------------------------
    Dim pt3 As PivotTable
    Set pt3 = pc.CreatePivotTable( _
        TableDestination:=wsPT.Cells(30, 2), TableName:="PT_VyruchkaKassir")
    With pt3
        With .PivotFields("Тип")
            .Orientation = xlPageField
            .CurrentPage = "Приход"
        End With
        With .PivotFields("Кассир")
            .Orientation = xlRowField
            .Position = 1
        End With
        With .PivotFields("Смена")
            .Orientation = xlColumnField
            .Position = 1
        End With
        With .PivotFields("Сумма")
            .Orientation = xlDataField
            .Function = xlSum
            .NumberFormat = "#,##0"
            .Name = "Выручка"
        End With
        .NullString = "0"
    End With

    ' -- ПТ4: Долги по поставщикам -------------------------------
    Dim pt4 As PivotTable
    Set pt4 = pc.CreatePivotTable( _
        TableDestination:=wsPT.Cells(30, 9), TableName:="PT_DolgiPost")
    With pt4
        With .PivotFields("Тип")
            .Orientation = xlPageField
            .CurrentPage = "Долг"
        End With
        With .PivotFields("Комментарий")
            .Orientation = xlRowField
            .Position = 1
        End With
        With .PivotFields("Сумма")
            .Orientation = xlDataField
            .Function = xlSum
            .NumberFormat = "#,##0"
            .Name = "Долг (руб.)"
        End With
        .NullString = "0"
    End With

    ' -- ПТ5: Итоговая сводная по всем типам ---------------------
    Dim pt5 As PivotTable
    Set pt5 = pc.CreatePivotTable( _
        TableDestination:=wsPT.Cells(50, 2), TableName:="PT_ObshchayaSvodnaya")
    With pt5
        With .PivotFields("Тип")
            .Orientation = xlRowField
            .Position = 1
        End With
        With .PivotFields("Категория")
            .Orientation = xlRowField
            .Position = 2
        End With
        With .PivotFields("Способ оплаты")
            .Orientation = xlColumnField
            .Position = 1
        End With
        With .PivotFields("Сумма")
            .Orientation = xlDataField
            .Function = xlSum
            .NumberFormat = "#,##0"
            .Name = "Итого"
        End With
        .NullString = "0"
    End With

    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    MsgBox "5 сводных таблиц созданы!" & vbCrLf & vbCrLf & _
           "ПТ1 - Выручка по месяцам" & vbCrLf & _
           "ПТ2 - Расходы по категориям" & vbCrLf & _
           "ПТ3 - Выручка: кассиры x смены" & vbCrLf & _
           "ПТ4 - Долги по поставщикам" & vbCrLf & _
           "ПТ5 - Итоговая сводная (тип x категория x метод оплаты)", _
           vbInformation, "ФИНАНСОВЫЙ КОНТРОЛЬ — Сводные таблицы"
    Exit Sub
pivErr:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    MsgBox "Ошибка при создании сводных таблиц:" & vbCrLf & Err.Description, _
           vbCritical, "CreatePivotTables"
End Sub


' ===============================================================
'  КАК ИСПОЛЬЗОВАТЬ:
'  1) Открыть ФИНАНСОВЫЙ_КОНТРОЛЬ.xlsx в Excel
'  2) Alt+F11 -> File -> Import File -> выбрать ФИНАНСОВЫЙ_КОНТРОЛЬ_VBA.bas
'  3) Alt+F8 -> выбрать "SetupAll" -> нажать "Выполнить"
'     Кнопки появятся на листах, макросы назначатся автоматически.
'  4) Файл -> Сохранить как -> Книга Excel с поддержкой макросов (.xlsm)
' ===============================================================
