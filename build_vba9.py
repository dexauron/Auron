#!/usr/bin/env python3
"""Generate VBA module for WAY MARKET v9"""

vba = r"""
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

' ---- SOHRANIT KASSU (10-col: D=ВыручкаZ, E=ЭквZ, F=ПеревZ, G=ФактНал, H=ФактЭкв, I=ФактПер, J=Расхожд) ----
Sub SohranitKassu()
    Dim wsVvod As Worksheet
    Dim wsCfg As Worksheet
    Set wsVvod = ThisWorkbook.Sheets("ВВОД_КАССА")
    Set wsCfg = ThisWorkbook.Sheets("НАСТРОЙКИ")
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False

    ' Read payment method toggles from НАСТРОЙКИ (Section 3, column E)
    Dim vklEkv As Boolean: vklEkv = VklVykl(wsCfg.Cells(20, 5).Value)  ' E20: Эквайринг Z
    Dim vklPer As Boolean: vklPer = VklVykl(wsCfg.Cells(21, 5).Value)  ' E21: Перевод Z

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

        ' D=Выручка Z-отчёт (наличка) — always active
        Dim vyruchkaK As Double
        vyruchkaK = BezopasnoeCislo(wsVvod.Cells(r, 4).Value)

        If vyruchkaK > 0 Then
            If DataSmenaEstVBaze(dataValK, smenaK) Then
                MsgBox "ВНИМАНИЕ: Смена '" & smenaK & "' за " & Format(dataValK, "DD.MM.YYYY") & _
                       " уже записана в базе! Сохранение пропущено.", vbExclamation
            Else
                ' D: Z-отчёт наличка → Доход/Наличка (always)
                ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Наличка", vyruchkaK, "Z-отчёт"
                ' E: Z-отчёт эквайринг — только если включено в НАСТРОЙКАХ
                If vklEkv Then
                    Dim ekvZ As Double: ekvZ = BezopasnoeCislo(wsVvod.Cells(r, 5).Value)
                    If ekvZ > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Эквайринг", ekvZ, "Z-Эквайринг"
                End If
                ' F: Z-отчёт перевод — только если включено в НАСТРОЙКАХ
                If vklPer Then
                    Dim perZ As Double: perZ = BezopasnoeCislo(wsVvod.Cells(r, 6).Value)
                    If perZ > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Перевод", perZ, "Z-Перевод"
                End If
                ' J: Расхождение (col 10) → тип Расхождение если ненулевое
                Dim rashK As Double: rashK = BezopasnoeCislo(wsVvod.Cells(r, 10).Value)
                If Abs(rashK) > 0.01 Then
                    ZapisatTransakciyu dataValK, smenaK, kassirK, "Расхождение", "", "Наличка", rashK, "Расхождение по смене"
                End If
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

' ---- SOHRANIT RASHODY (5-col: B=Категория, C=Способ, D=Сумма, E=Комментарий) ----
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
        Dim katR As String: katR = CStr(wsVvod.Cells(r, 2).Value)
        Dim sposobR As String: sposobR = CStr(wsVvod.Cells(r, 3).Value)
        Dim summaR As Double: summaR = BezopasnoeCislo(wsVvod.Cells(r, 4).Value)
        Dim kommentR As String: kommentR = CStr(wsVvod.Cells(r, 5).Value)
        If summaR > 0 And katR <> "" Then
            ZapisatTransakciyu dataValR, "-", "", "Расход", katR, sposobR, summaR, kommentR
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

' ---- SOHRANIT VIPLATU — читает последнюю заполненную строку tblВыплаты → БАЗА_ДДС ----
Sub SohranitViplatu()
    Dim wsVvod As Worksheet
    Set wsVvod = ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ")

    ' Find last filled row in tblВыплаты (col B = Дата выплаты)
    Dim tbl As ListObject
    Set tbl = wsVvod.ListObjects("tblВыплаты")

    Dim lastDataRow As Long
    lastDataRow = 0
    Dim i As Long
    Dim startRow As Long
    startRow = tbl.HeaderRowRange.Row + 1  ' first data row

    For i = startRow To startRow + tbl.ListRows.Count - 1
        If wsVvod.Cells(i, 2).Value <> "" And wsVvod.Cells(i, 4).Value <> "" Then
            lastDataRow = i
        End If
    Next i

    If lastDataRow = 0 Then
        MsgBox "Нет данных для сохранения. Заполните дату и сумму в таблице.", vbExclamation
        Exit Sub
    End If

    ' Read from tblВыплаты columns: B=Дата, C=Поставщик, D=Сумма, E=Статус, G=Способ, H=Комментарий
    Dim dataVal As Date
    Dim poluchatel As String
    Dim summa As Double
    Dim sposob As String
    Dim komment As String

    dataVal = CDate(wsVvod.Cells(lastDataRow, 2).Value)
    poluchatel = CStr(wsVvod.Cells(lastDataRow, 3).Value)
    summa = BezopasnoeCislo(wsVvod.Cells(lastDataRow, 4).Value)
    sposob = CStr(wsVvod.Cells(lastDataRow, 7).Value)
    komment = CStr(wsVvod.Cells(lastDataRow, 8).Value)

    If summa = 0 Or poluchatel = "" Then
        MsgBox "Заполните поставщика и сумму в строке " & lastDataRow & "!", vbExclamation
        Exit Sub
    End If

    ' Write to БАЗА_ДДС as "Оплата долга"
    ZapisatTransakciyu dataVal, "-", "", "Оплата долга", "Выплата поставщику", sposob, summa, "Выплата: " & poluchatel

    ' Mark row as Выплачено
    wsVvod.Cells(lastDataRow, 5).Value = "Выплачено"

    MsgBox "Выплата записана в БАЗА_ДДС! Строка отмечена 'Выплачено'.", vbInformation
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

' EksportOtchetaPDF — УДАЛЕНО (экспорт PDF запрещён по архитектуре v9)

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

' ---- Helper: add one sidebar button ----
Private Function AddSideBtn(ws As Worksheet, btnName As String, btnText As String, _
                             macroName As String, x As Single, y As Single, _
                             w As Single, h As Single, r As Integer, g As Integer, b_c As Integer) As Shape
    Dim b As Shape
    Set b = ws.Shapes.AddShape(msoShapeRoundedRectangle, x, y, w, h)
    b.TextFrame.Characters.Text = btnText
    b.TextFrame.Characters.Font.Bold = True
    b.TextFrame.Characters.Font.Size = 10
    b.Fill.ForeColor.RGB = RGB(r, g, b_c)
    b.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
    b.Line.Visible = msoFalse
    b.Name = btnName
    If macroName <> "" Then ws.Shapes(btnName).OnAction = macroName
    Set AddSideBtn = b
End Function

' ---- Navigation subs ----
Sub НавигацияНаДашборд()
    ThisWorkbook.Sheets("ДАШБОРД").Activate
End Sub

Sub НавигацияНаБазу()
    ThisWorkbook.Sheets("БАЗА_ДДС").Activate
End Sub

Sub НавигацияНаКасса()
    ThisWorkbook.Sheets("ВВОД_КАССА").Activate
End Sub

Sub НавигацияНаРасходы()
    ThisWorkbook.Sheets("ВВОД_РАСХОДЫ").Activate
End Sub

Sub НавигацияНаВыплаты()
    ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ").Activate
End Sub

' ---- Setup all buttons (right-side sidebar panel) ----
' ---- ZACHISLIT POSTOYANNYE RASHODY: write current-month fixed expenses to BAZA_DDS ----
Sub ZachislitPostoyannyeRashody()
    Dim wsCfg As Worksheet
    Set wsCfg = ThisWorkbook.Sheets("НАСТРОЙКИ")
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False

    Dim mNum As Integer: mNum = Month(Now)
    Dim monthRow As Long: monthRow = 81 + mNum  ' rows 82–93 = months 1–12

    Dim cats(1 To 6) As String
    cats(1) = "ЗП": cats(2) = "Аренда": cats(3) = "Налоги"
    cats(4) = "Интернет": cats(5) = "Охрана": cats(6) = "Другое"

    Dim todayD As Date: todayD = Now()
    Dim zapisano As Integer: zapisano = 0
    Dim i As Integer
    For i = 1 To 6
        Dim summa As Double
        summa = BezopasnoeCislo(wsCfg.Cells(monthRow, i + 1).Value)
        If summa > 0 Then
            ZapisatTransakciyu todayD, "-", "", "Расход", cats(i), "Перевод", summa, "Постоянный расход " & cats(i)
            zapisano = zapisano + 1
        End If
    Next i

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    If zapisano > 0 Then
        MsgBox "Постоянные расходы зачислены! Записано строк: " & zapisano & " (БАЗА_ДДС).", vbInformation
    Else
        MsgBox "Нет данных для текущего месяца в Разделе 8 НАСТРОЙКИ (строка " & monthRow & ").", vbExclamation
    End If
End Sub

Sub UstanovitVseKnopki()
    Dim ws As Worksheet
    Dim btn As Shape

    ' === ВВОД_КАССА ===
    Set ws = ThisWorkbook.Sheets("ВВОД_КАССА")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    ' Action buttons (top area, stacked right)
    Call AddSideBtn(ws, "btnSaveKassu",  "СОХРАНИТЬ КАССУ", "SohranitKassu",  750, 4,  160, 32, 59, 130, 246)
    Call AddSideBtn(ws, "btnSogodnya",   "СЕГОДНЯ",          "ПоставитьСегодня", 750, 42, 160, 28, 16, 185, 129)
    Call AddSideBtn(ws, "btnVchera",     "ВЧЕРА",            "ПоставитьВчера",   750, 76, 160, 28, 107, 114, 128)
    ' Navigation buttons (bottom of sidebar)
    Call AddSideBtn(ws, "navDash_K",  "▶ Дашборд",    "НавигацияНаДашборд",   750, 120, 160, 24, 79, 70, 229)
    Call AddSideBtn(ws, "navRash_K",  "▶ Расходы",    "НавигацияНаРасходы",   750, 150, 160, 24, 239, 68, 68)
    Call AddSideBtn(ws, "navVipl_K",  "▶ Выплаты",    "НавигацияНаВыплаты",   750, 180, 160, 24, 245, 158, 11)
    Call AddSideBtn(ws, "navBaza_K",  "▶ База ДДС",   "НавигацияНаБазу",      750, 210, 160, 24, 107, 114, 128)

    ' === ВВОД_РАСХОДЫ ===
    Set ws = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "btnSaveRashody", "СОХРАНИТЬ РАСХОДЫ", "SohranitRashody", 550, 4, 160, 32, 239, 68, 68)
    Call AddSideBtn(ws, "navDash_R",  "▶ Дашборд",  "НавигацияНаДашборд",  550, 42,  160, 24, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_R",   "▶ Касса",    "НавигацияНаКасса",    550, 72,  160, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navVipl_R",  "▶ Выплаты",  "НавигацияНаВыплаты",  550, 102, 160, 24, 245, 158, 11)
    Call AddSideBtn(ws, "navBaza_R",  "▶ База ДДС", "НавигацияНаБазу",     550, 132, 160, 24, 107, 114, 128)

    ' === ЗАПИСЬ_НА_ВЫПЛАТУ ===
    Set ws = ThisWorkbook.Sheets("ЗАПИСЬ_НА_ВЫПЛАТУ")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "btnSaveViplatu", "СОХРАНИТЬ ВЫПЛАТУ", "SohranitViplatu", 720, 4, 160, 32, 245, 158, 11)
    Call AddSideBtn(ws, "navDash_V",  "▶ Дашборд",  "НавигацияНаДашборд",  720, 42,  160, 24, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_V",   "▶ Касса",    "НавигацияНаКасса",    720, 72,  160, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navRash_V",  "▶ Расходы",  "НавигацияНаРасходы",  720, 102, 160, 24, 239, 68, 68)
    Call AddSideBtn(ws, "navBaza_V",  "▶ База ДДС", "НавигацияНаБазу",     720, 132, 160, 24, 107, 114, 128)

    ' === КАЛЕНДАРЬ_ВЫПЛАТ ===
    Set ws = ThisWorkbook.Sheets("КАЛЕНДАРЬ_ВЫПЛАТ")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "navDash_Kal",  "▶ Дашборд",  "НавигацияНаДашборд",  970, 4,  150, 28, 79, 70, 229)
    Call AddSideBtn(ws, "navVipl_Kal",  "▶ Выплаты",  "НавигацияНаВыплаты",  970, 38, 150, 24, 245, 158, 11)
    Call AddSideBtn(ws, "navKas_Kal",   "▶ Касса",    "НавигацияНаКасса",    970, 68, 150, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navBaza_Kal",  "▶ База ДДС", "НавигацияНаБазу",     970, 98, 150, 24, 107, 114, 128)

    ' === БАЗА_ДДС ===
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "navDash_B",  "▶ Дашборд",  "НавигацияНаДашборд",  710, 4,  150, 28, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_B",   "▶ Касса",    "НавигацияНаКасса",    710, 38, 150, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navRash_B",  "▶ Расходы",  "НавигацияНаРасходы",  710, 68, 150, 24, 239, 68, 68)
    Call AddSideBtn(ws, "navVipl_B",  "▶ Выплаты",  "НавигацияНаВыплаты",  710, 98, 150, 24, 245, 158, 11)

    ' === ДАШБОРД ===
    Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    On Error Resume Next
    For Each btn In ws.Shapes
        If btn.Name Like "btn*" Or btn.Name Like "nav*" Then btn.Delete
    Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "btnObnovit",  "ОБНОВИТЬ",    "ObnovitDashboard",     810, 4,  130, 28, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_D",   "▶ Касса",    "НавигацияНаКасса",     810, 38, 130, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navRash_D",  "▶ Расходы",  "НавигацияНаРасходы",   810, 68, 130, 24, 239, 68, 68)
    Call AddSideBtn(ws, "navVipl_D",  "▶ Выплаты",  "НавигацияНаВыплаты",   810, 98, 130, 24, 245, 158, 11)
    Call AddSideBtn(ws, "navBaza_D",  "▶ База ДДС", "НавигацияНаБазу",      810, 128, 130, 24, 107, 114, 128)

    ' === ОТЧЁТ_РУКОВОДИТЕЛЮ (nav only, no PDF) ===
    Set ws = ThisWorkbook.Sheets("ОТЧЁТ_РУКОВОДИТЕЛЮ")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "navDash_O",  "▶ Дашборд",  "НавигацияНаДашборд",  545, 4,  150, 28, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_O",   "▶ Касса",    "НавигацияНаКасса",    545, 38, 150, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navRash_O",  "▶ Расходы",  "НавигацияНаРасходы",  545, 68, 150, 24, 239, 68, 68)
    Call AddSideBtn(ws, "navBaza_O",  "▶ База ДДС", "НавигацияНаБазу",     545, 98, 150, 24, 107, 114, 128)

    ' === НАСТРОЙКИ ===
    Set ws = ThisWorkbook.Sheets("НАСТРОЙКИ")
    On Error Resume Next
    For Each btn In ws.Shapes: btn.Delete: Next btn
    On Error GoTo 0
    Call AddSideBtn(ws, "btnZachislit", "ЗАЧИСЛИТЬ РАСХОДЫ", "ZachislitPostoyannyeRashody", 830, 4,  190, 32, 20, 184, 166)
    Call AddSideBtn(ws, "navDash_N",  "▶ Дашборд",  "НавигацияНаДашборд",  830, 42,  190, 24, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_N",   "▶ Касса",    "НавигацияНаКасса",    830, 72,  190, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navBaza_N",  "▶ База ДДС", "НавигацияНаБазу",     830, 102, 190, 24, 107, 114, 128)

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
"""

# Save as cp1251 with CRLF
out_path = "/home/user/Auron/Модуль_WM9.bas"
src = vba.strip()
src_bytes = src.encode("cp1251", errors="replace")
with open(out_path, "wb") as f:
    # Write BOM-free cp1251 with CRLF line endings
    for line in src.splitlines():
        f.write(line.encode("cp1251", errors="replace") + b"\r\n")

import os
size = os.path.getsize(out_path)
print(f"✅ Модуль_WM9.bas saved — {size} bytes ({size//1024} KB)")
