Attribute VB_Name = "WAY_MARKET_v9"
Option Explicit

' =========================================================
' WAY MARKET v9 -- VBA Module
' Alt+F11 -> File -> Import File -> select this .bas file
' No sheet protection used — user configures manually.
'
' ВАЖНО для КАЛЕНДАРЬ_ВЫПЛАТ (SelectionChange):
' В редакторе VBA раскройте лист "КАЛЕНДАРЬ_ВЫПЛАТ"
' и вставьте в его модуль следующий код:
'
'   Private Sub Worksheet_SelectionChange(ByVal Target As Range)
'       If Target.Column >= 1 And Target.Column <= 14 Then
'           Dim rowNum As Long: rowNum = Target.Row
'           If rowNum >= 11 And (rowNum - 11) Mod 4 = 0 Then
'               Dim colIdx As Long: colIdx = Target.Column
'               If colIdx Mod 2 = 1 Then
'                   If Target.Value <> "" Then
'                       Call WAY_MARKET_v9.ObnovitBokovuyuPanelKalendarya(CDate(DateSerial(Me.Range("G4"), Me.Range("P4"), Me.Range(Target.Address).Value)))
'                   End If
'               End If
'           End If
'       End If
'   End Sub
'
' =========================================================

' ---- Safe number conversion ----
Function BezopasnoeCislo(val As Variant) As Double
    On Error Resume Next
    If IsNumeric(val) Then
        BezopasnoeCislo = CDbl(val)
    Else
        BezopasnoeCislo = 0
    End If
    On Error GoTo 0
End Function

' ---- Check if value = "Vkl" ----
Function VklVykl(val As Variant) As Boolean
    VklVykl = (CStr(val) = "Вкл")
End Function

' ---- Find last row in BAZA_DDS ----
Function PoslednyayaStrokaBazy() As Long
    Dim ws As Worksheet
    Dim r As Long
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    r = 3004
    Do While r > 3 And ws.Cells(r, 1).Value = ""
        r = r - 1
    Loop
    If r < 4 Then r = 3
    PoslednyayaStrokaBazy = r
End Function

' ---- Anti-duplication check: date+shift already exists ----
Function DataSmenaEstVBaze(dataVal As Date, smena As String) As Boolean
    Dim ws As Worksheet
    Dim r As Long
    Dim lastR As Long
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    lastR = PoslednyayaStrokaBazy()
    DataSmenaEstVBaze = False
    For r = 4 To lastR
        If ws.Cells(r, 1).Value = dataVal And ws.Cells(r, 2).Value = smena Then
            DataSmenaEstVBaze = True
            Exit For
        End If
    Next r
End Function

' ---- Write one transaction row ----
Sub ZapisatTransakciyu(dataVal As Date, smena As String, kassir As String, _
                        tip As String, kategoriya As String, sposob As String, _
                        summa As Double, komment As String)
    Dim ws As Worksheet
    Dim r As Long
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    r = PoslednyayaStrokaBazy() + 1
    If r > 3003 Then
        MsgBox "База данных заполнена (3000 записей). Создайте новый файл.", vbExclamation
        Exit Sub
    End If
    ws.Cells(r, 1).Value = dataVal
    ws.Cells(r, 2).Value = smena
    ws.Cells(r, 3).Value = kassir
    ws.Cells(r, 4).Value = tip
    ws.Cells(r, 5).Value = kategoriya
    ws.Cells(r, 6).Value = sposob
    ws.Cells(r, 7).Value = summa
    ws.Cells(r, 8).Value = komment
    ws.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
    ws.Cells(r, 7).NumberFormat = "#,##0;[Red]-#,##0"
End Sub

' ---- Build date from VVOD_KASSA fields ----
Function PoluiChitDatu(wsVvod As Worksheet) As Date
    Dim den As Integer, mesyac As Integer, god As Integer
    Dim mesyacStr As String
    Dim months As Variant
    months = Array("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", _
                   "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
    den = BezopasnoeCislo(wsVvod.Range("B5").Value)
    mesyacStr = CStr(wsVvod.Range("E5").Value)
    god = BezopasnoeCislo(wsVvod.Range("H5").Value)
    Dim i As Integer
    mesyac = 1
    For i = 0 To 11
        If months(i) = mesyacStr Then
            mesyac = i + 1
            Exit For
        End If
    Next i
    If den = 0 Or god = 0 Then
        MsgBox "Не заполнена дата!", vbExclamation
        PoluiChitDatu = 0
        Exit Function
    End If
    On Error Resume Next
    PoluiChitDatu = DateSerial(god, mesyac, den)
    On Error GoTo 0
End Function

' ---- SOHRANIT KASSU ----
Sub SohranitKassu()
    Dim wsVvod As Worksheet
    Set wsVvod = ThisWorkbook.Sheets("ВВОД_КАССА")
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False

    Dim tbl As ListObject
    Set tbl = wsVvod.ListObjects("tblВводКасса")

    Dim zapisano As Integer
    zapisano = 0
    Dim r As Long

    For r = 4 To 503
        If wsVvod.Cells(r, 1).Value = "" Then GoTo NextRowK

        Dim dataValK As Date
        Dim smenaK As String
        Dim kassirK As String
        dataValK = CDate(wsVvod.Cells(r, 1).Value)
        smenaK = CStr(wsVvod.Cells(r, 2).Value)
        kassirK = CStr(wsVvod.Cells(r, 3).Value)

        Dim vyruchkaK As Double
        vyruchkaK = BezopasnoeCislo(wsVvod.Cells(r, 4).Value)

        If vyruchkaK > 0 Then
            If DataSmenaEstVBaze(dataValK, smenaK) Then
                MsgBox "ВНИМАНИЕ: Смена '" & smenaK & "' за " & Format(dataValK, "DD.MM.YYYY") & _
                       " уже записана в базе! Сохранение пропущено.", vbExclamation
            Else
                ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Наличка", vyruchkaK, "Z-отчёт"
                Dim ekv As Double: ekv = BezopasnoeCislo(wsVvod.Cells(r, 6).Value)
                If ekv > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Эквайринг", ekv, "Эквайринг"
                Dim perK As Double: perK = BezopasnoeCislo(wsVvod.Cells(r, 7).Value)
                If perK > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Перевод", perK, "Перевод"
                Dim imanK As Double: imanK = BezopasnoeCislo(wsVvod.Cells(r, 8).Value)
                If imanK > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Иман", "", "Иман", imanK, "Иман"
                Dim viplK As Double: viplK = BezopasnoeCislo(wsVvod.Cells(r, 9).Value)
                If viplK > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Расход", "", "Наличка", viplK, "Выплата с кассы"
                Dim zakupK As Double: zakupK = BezopasnoeCislo(wsVvod.Cells(r, 10).Value)
                If zakupK > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Расход", "Закуп товара", "Наличка", zakupK, "Закуп"
                Dim dolgK As Double: dolgK = BezopasnoeCislo(wsVvod.Cells(r, 11).Value)
                If dolgK > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Долг", "Закуп товара", "Долг", dolgK, "Долг поставщику"
                zapisano = zapisano + 1
            End If
        End If
NextRowK:
    Next r

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    If zapisano > 0 Then
        tbl.DataBodyRange.ClearContents
        Dim todayK As Date: todayK = Now()
        wsVvod.Cells(4, 1).Value = todayK: wsVvod.Cells(4, 2).Value = "День"
        wsVvod.Cells(5, 1).Value = todayK: wsVvod.Cells(5, 2).Value = "Вечер"
        wsVvod.Cells(6, 1).Value = todayK: wsVvod.Cells(6, 2).Value = "Ночь"
        wsVvod.Range("A4:A6").NumberFormat = "DD.MM.YYYY"
        MsgBox "Касса сохранена! Записано смен: " & zapisano, vbInformation
    Else
        MsgBox "Нет данных для сохранения (введите выручку Z-отчётов).", vbExclamation
    End If
End Sub

' ---- SOHRANIT RASHODY ----
Sub SohranitRashody()
    Dim wsVvod As Worksheet
    Set wsVvod = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False

    Dim tbl As ListObject
    Set tbl = wsVvod.ListObjects("tblВводРасходы")

    Dim zapisano As Integer
    zapisano = 0
    Dim r As Long

    For r = 4 To 503
        If wsVvod.Cells(r, 1).Value = "" Then GoTo NextRowR
        Dim dataValR As Date: dataValR = CDate(wsVvod.Cells(r, 1).Value)
        Dim kassirR As String: kassirR = CStr(wsVvod.Cells(r, 2).Value)
        Dim katR As String: katR = CStr(wsVvod.Cells(r, 3).Value)
        Dim sposobR As String: sposobR = CStr(wsVvod.Cells(r, 4).Value)
        Dim summaR As Double: summaR = BezopasnoeCislo(wsVvod.Cells(r, 5).Value)
        Dim kommentR As String: kommentR = CStr(wsVvod.Cells(r, 6).Value)
        If summaR > 0 And katR <> "" Then
            ZapisatTransakciyu dataValR, "-", kassirR, "Расход", katR, sposobR, summaR, kommentR
            zapisano = zapisano + 1
        End If
NextRowR:
    Next r

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    If zapisano > 0 Then
        tbl.DataBodyRange.ClearContents
        wsVvod.Cells(4, 1).Value = Now()
        wsVvod.Cells(4, 1).NumberFormat = "DD.MM.YYYY"
        MsgBox "Расходы сохранены! Записей: " & zapisano, vbInformation
    Else
        MsgBox "Нет данных для сохранения.", vbExclamation
    End If
End Sub

' ---- SOHRANIT VIPLATU ----
Sub SohranitViplatu()
    Dim wsVvod As Worksheet
    Dim wsKal As Worksheet
    Set wsVvod = ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ")
    Set wsKal = ThisWorkbook.Sheets("КАЛЕНДАРЬ_ВЫПЛАТ")

    Dim dataVal As Date
    Dim poluchatel As String
    Dim tip As String
    Dim summa As Double
    Dim sposob As String
    Dim komment As String

    dataVal = wsVvod.Range("D4").Value
    poluchatel = CStr(wsVvod.Range("D5").Value)
    tip = CStr(wsVvod.Range("D6").Value)
    summa = BezopasnoeCislo(wsVvod.Range("D7").Value)
    sposob = CStr(wsVvod.Range("D8").Value)
    komment = CStr(wsVvod.Range("D9").Value)

    If summa = 0 Or poluchatel = "" Then
        MsgBox "Заполните получателя и сумму!", vbExclamation
        Exit Sub
    End If

    ' Find next empty row in KALENDAR_VIPLAT
    Dim r As Long
    r = 4
    Do While wsKal.Cells(r, 1).Value <> "" And r < 1003
        r = r + 1
    Loop

    wsKal.Cells(r, 1).Value = dataVal
    wsKal.Cells(r, 2).Value = poluchatel
    wsKal.Cells(r, 3).Value = tip
    wsKal.Cells(r, 4).Value = summa
    wsKal.Cells(r, 7).Value = "Ожидается"
    wsKal.Cells(r, 8).Value = komment
    wsKal.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
    wsKal.Cells(r, 4).NumberFormat = "#,##0;[Red]-#,##0"

    ' Also write to BAZA_DDS
    ZapisatTransakciyu dataVal, "-", "", "Расход", tip, sposob, summa, "Выплата: " & poluchatel

    ' Clear input
    wsVvod.Range("D5:D9").ClearContents

    MsgBox "Выплата записана!", vbInformation
End Sub

' ---- OBNOVIT DASHBOARD ----
Sub ObnovitDashboard()
    Dim wsDash As Worksheet
    Set wsDash = ThisWorkbook.Sheets("ДАШБОРД")
    Dim months As Variant
    months = Array("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", _
                   "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
    wsDash.Range("B4").Value = months(Month(Now) - 1)
    wsDash.Range("E4").Value = Year(Now)
    Application.Calculate
    MsgBox "Дашборд обновлён на " & months(Month(Now) - 1) & " " & Year(Now), vbInformation
End Sub

' ---- EKSPORT PDF ----
Sub EksportOtchetaPDF()
    Dim wsRpt As Worksheet
    Set wsRpt = ThisWorkbook.Sheets("ОТЧЁТ_РУКОВОДИТЕЛЮ")
    Dim fileName As String
    Dim wsDash As Worksheet
    Set wsDash = ThisWorkbook.Sheets("ДАШБОРД")
    Dim mesyac As String
    Dim god As String
    mesyac = CStr(wsDash.Range("B4").Value)
    god = CStr(wsDash.Range("E4").Value)
    fileName = ThisWorkbook.Path & "\Отчёт_" & mesyac & "_" & god & ".pdf"
    wsRpt.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fileName, Quality:=xlQualityStandard
    MsgBox "PDF сохранён: " & fileName, vbInformation
End Sub

' ---- SEGONYA / VCHERA ----
Sub ПоставитьСегодня()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.ActiveSheet
    ws.Cells(4, 1).Value = Now()
    ws.Cells(5, 1).Value = Now()
    ws.Cells(6, 1).Value = Now()
    ws.Range("A4:A6").NumberFormat = "DD.MM.YYYY"
End Sub

Sub ПоставитьВчера()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.ActiveSheet
    Dim vchera As Date: vchera = Now() - 1
    ws.Cells(4, 1).Value = vchera
    ws.Cells(5, 1).Value = vchera
    ws.Cells(6, 1).Value = vchera
    ws.Range("A4:A6").NumberFormat = "DD.MM.YYYY"
End Sub

' ---- Setup all buttons ----
Sub UstanovitVseKnopki()
    Dim ws As Worksheet

    ' VVOD_KASSA buttons
    Set ws = ThisWorkbook.Sheets("ВВОД_КАССА")
    Dim btn As Shape
    On Error Resume Next
    For Each btn In ws.Shapes
        btn.Delete
    Next btn
    On Error GoTo 0

    Dim b As Shape
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 10, 2, 160, 36)
    b.TextFrame.Characters.Text = "СОХРАНИТЬ КАССУ"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(59, 130, 246)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnSaveKassu"
    ws.Shapes("btnSaveKassu").OnAction = "SohranitKassu"

    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 180, 2, 120, 36)
    b.TextFrame.Characters.Text = "СЕГОДНЯ"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(16, 185, 129)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnSogodnya"
    ws.Shapes("btnSogodnya").OnAction = "ПоставитьСегодня"

    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 310, 2, 120, 36)
    b.TextFrame.Characters.Text = "ВЧЕРА"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(107, 114, 128)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnVchera"
    ws.Shapes("btnVchera").OnAction = "ПоставитьВчера"

    ' VVOD_RASHODY button
    Set ws = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    On Error Resume Next
    For Each btn In ws.Shapes
        btn.Delete
    Next btn
    On Error GoTo 0
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 10, 2, 160, 36)
    b.TextFrame.Characters.Text = "СОХРАНИТЬ РАСХОДЫ"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(239, 68, 68)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnSaveRashody"
    ws.Shapes("btnSaveRashody").OnAction = "SohranitRashody"

    ' ZAPIS_NA_VIPLATU button
    Set ws = ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ")
    On Error Resume Next
    For Each btn In ws.Shapes
        btn.Delete
    Next btn
    On Error GoTo 0
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 10, 2, 160, 36)
    b.TextFrame.Characters.Text = "СОХРАНИТЬ ВЫПЛАТУ"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(245, 158, 11)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnSaveViplatu"
    ws.Shapes("btnSaveViplatu").OnAction = "SohranitViplatu"

    ' DASHBOARD buttons
    Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    On Error Resume Next
    For Each btn In ws.Shapes
        If btn.Name = "btnObnovit" Or btn.Name = "btnPDF" Then btn.Delete
    Next btn
    On Error GoTo 0
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 800, 52, 130, 28)
    b.TextFrame.Characters.Text = "ОБНОВИТЬ"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 10
    b.Fill.ForeColor.RGB = RGB(79, 70, 229)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnObnovit"
    ws.Shapes("btnObnovit").OnAction = "ObnovitDashboard"

    ' OTCHET_RUKOVODITELYU PDF button
    Set ws = ThisWorkbook.Sheets("ОТЧЁТ_РУКОВОДИТЕЛЮ")
    On Error Resume Next
    For Each btn In ws.Shapes
        btn.Delete
    Next btn
    On Error GoTo 0
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, 10, 2, 160, 36)
    b.TextFrame.Characters.Text = "ЭКСПОРТ PDF"
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 11
    b.Fill.ForeColor.RGB = RGB(17, 24, 39)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = "btnPDF"
    ws.Shapes("btnPDF").OnAction = "EksportOtchetaPDF"

    MsgBox "Все кнопки установлены! Шаблон готов к работе.", vbInformation
End Sub

' ---- Calendar sidebar: show payments for selected day ----
Sub ObnovitBokovuyuPanelKalendarya(selectedDate As Date)
    Dim wsKal As Worksheet
    Dim wsZap As Worksheet
    Set wsKal = ThisWorkbook.Sheets("КАЛЕНДАРЬ_ВЫПЛАТ")
    Set wsZap = ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ")

    Const SB_COL As Integer = 15  ' Column O — sidebar start
    Const SB_START As Integer = 4  ' First data row in sidebar
    Const SB_END As Integer = 29   ' Last row in sidebar

    ' Clear sidebar
    wsKal.Range(wsKal.Cells(3, SB_COL), wsKal.Cells(3, SB_COL + 3)).Merge True
    wsKal.Cells(3, SB_COL).Value = Format(selectedDate, "DD.MM.YYYY")
    wsKal.Cells(3, SB_COL).Font.Bold = True
    wsKal.Cells(3, SB_COL).Font.Color = RGB(79, 70, 229)

    Dim i As Long, outRow As Long
    outRow = SB_START

    ' Clear previous data
    wsKal.Range(wsKal.Cells(SB_START, SB_COL), wsKal.Cells(SB_END, SB_COL + 3)).ClearContents

    ' Fill from tblВыплаты
    Dim lastR As Long
    lastR = 503
    For i = 4 To lastR
        If wsZap.Cells(i, 2).Value = selectedDate Then
            If outRow > SB_END Then Exit For
            wsKal.Cells(outRow, SB_COL).Value = CStr(wsZap.Cells(i, 3).Value)   ' Поставщик
            wsKal.Cells(outRow, SB_COL + 1).Value = BezopasnoeCislo(wsZap.Cells(i, 4).Value)  ' Сумма
            wsKal.Cells(outRow, SB_COL + 2).Value = CStr(wsZap.Cells(i, 5).Value)   ' Статус
            wsKal.Cells(outRow, SB_COL + 3).Value = CStr(wsZap.Cells(i, 6).Value)   ' Накладная
            wsKal.Cells(outRow, SB_COL + 1).NumberFormat = "#,##0;[Red]-#,##0"
            ' Color by status
            Select Case wsZap.Cells(i, 5).Value
                Case "Выплачено":   wsKal.Cells(outRow, SB_COL).Interior.Color = RGB(209, 250, 229)
                Case "Просрочено":  wsKal.Cells(outRow, SB_COL).Interior.Color = RGB(254, 226, 226)
                Case "Запланировано": wsKal.Cells(outRow, SB_COL).Interior.Color = RGB(239, 246, 255)
                Case Else: wsKal.Cells(outRow, SB_COL).Interior.Color = RGB(247, 248, 250)
            End Select
            outRow = outRow + 1
        End If
    Next i

    If outRow = SB_START Then
        wsKal.Cells(SB_START, SB_COL).Value = "(Выплат нет)"
        wsKal.Cells(SB_START, SB_COL).Font.Italic = True
        wsKal.Cells(SB_START, SB_COL).Font.Color = RGB(107, 114, 128)
    End If
End Sub

' ---- Keyboard shortcuts ----
Sub Auto_Open()
    Application.OnKey "^+s", "SohranitKassu"
    Application.OnKey "^+r", "SohranitRashody"
    Application.OnKey "^+d", "ObnovitDashboard"
End Sub

Sub Auto_Close()
    Application.OnKey "^+s"
    Application.OnKey "^+r"
    Application.OnKey "^+d"
End Sub
