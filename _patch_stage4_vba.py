#!/usr/bin/env python3
"""Stage 4 patch for build_vba9.py: update macros, remove PDF, add navigation, right-side buttons"""
import sys

src_path = "/home/user/Auron/build_vba9.py"
with open(src_path, encoding="utf-8") as f:
    src = f.read()

# ── PATCH 1: SohranitKassu — updated for 10-col ВВОД_КАССА ──────────────────
OLD_SK = """' ---- SOHRANIT KASSU ----
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
End Sub"""

NEW_SK = """' ---- SOHRANIT KASSU (10-col: D=ВыручкаZ, E=ЭквZ, F=ПеревZ, G=ФактНал, H=ФактЭкв, I=ФактПер, J=Расхожд) ----
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

        ' D=Выручка Z-отчёт (наличка)
        Dim vyruchkaK As Double
        vyruchkaK = BezopasnoeCislo(wsVvod.Cells(r, 4).Value)

        If vyruchkaK > 0 Then
            If DataSmenaEstVBaze(dataValK, smenaK) Then
                MsgBox "ВНИМАНИЕ: Смена '" & smenaK & "' за " & Format(dataValK, "DD.MM.YYYY") & _
                       " уже записана в базе! Сохранение пропущено.", vbExclamation
            Else
                ' D: Z-отчёт наличка → Доход/Наличка
                ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Наличка", vyruchkaK, "Z-отчёт"
                ' E: Z-отчёт эквайринг → Доход/Эквайринг
                Dim ekvZ As Double: ekvZ = BezopasnoeCislo(wsVvod.Cells(r, 5).Value)
                If ekvZ > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Эквайринг", ekvZ, "Z-Эквайринг"
                ' F: Z-отчёт перевод → Доход/Перевод
                Dim perZ As Double: perZ = BezopasnoeCislo(wsVvod.Cells(r, 6).Value)
                If perZ > 0 Then ZapisatTransakciyu dataValK, smenaK, kassirK, "Доход", "", "Перевод", perZ, "Z-Перевод"
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
End Sub"""

# ── PATCH 2: SohranitRashody — updated for 5-col (no Кассир) ────────────────
OLD_SR = """' ---- SOHRANIT RASHODY ----
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
End Sub"""

NEW_SR = """' ---- SOHRANIT RASHODY (5-col: B=Категория, C=Способ, D=Сумма, E=Комментарий) ----
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
End Sub"""

# ── PATCH 3: SohranitViplatu — fix to read tblВыплаты last row → БАЗА_ДДС ───
OLD_SV = """' ---- SOHRANIT VIPLATU ----
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
End Sub"""

NEW_SV = """' ---- SOHRANIT VIPLATU — читает последнюю заполненную строку tblВыплаты → БАЗА_ДДС ----
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
End Sub"""

# ── PATCH 4: Remove EksportOtchetaPDF ────────────────────────────────────────
OLD_PDF = """' ---- EKSPORT PDF ----
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
    fileName = ThisWorkbook.Path & "\\Отчёт_" & mesyac & "_" & god & ".pdf"
    wsRpt.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fileName, Quality:=xlQualityStandard
    MsgBox "PDF сохранён: " & fileName, vbInformation
End Sub"""

NEW_PDF = """' EksportOtchetaPDF — УДАЛЕНО (экспорт PDF запрещён по архитектуре v9)"""

# ── PATCH 5: Replace UstanovitVseKnopki with right-side sidebar + nav buttons ─
OLD_BTN = """' ---- Setup all buttons ----
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
End Sub"""

NEW_BTN = """' ---- Helper: add one sidebar button ----
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
    Call AddSideBtn(ws, "btnSaveRashody", "СОХРАНИТЬ РАСХОДЫ", "SohranitRashody", 510, 4, 160, 32, 239, 68, 68)
    Call AddSideBtn(ws, "navDash_R",  "▶ Дашборд",  "НавигацияНаДашборд",  510, 42,  160, 24, 79, 70, 229)
    Call AddSideBtn(ws, "navKas_R",   "▶ Касса",    "НавигацияНаКасса",    510, 72,  160, 24, 59, 130, 246)
    Call AddSideBtn(ws, "navVipl_R",  "▶ Выплаты",  "НавигацияНаВыплаты",  510, 102, 160, 24, 245, 158, 11)
    Call AddSideBtn(ws, "navBaza_R",  "▶ База ДДС", "НавигацияНаБазу",     510, 132, 160, 24, 107, 114, 128)

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

    MsgBox "Все кнопки установлены! Шаблон готов к работе.", vbInformation
End Sub"""

# Apply all patches
patches = [
    (OLD_SK, NEW_SK, "SohranitKassu"),
    (OLD_SR, NEW_SR, "SohranitRashody"),
    (OLD_SV, NEW_SV, "SohranitViplatu"),
    (OLD_PDF, NEW_PDF, "EksportOtchetaPDF"),
    (OLD_BTN, NEW_BTN, "UstanovitVseKnopki"),
]

for old, new, name in patches:
    if old not in src:
        print(f"ERROR: anchor not found for {name}")
        sys.exit(1)
    src = src.replace(old, new, 1)
    print(f"✓ {name} patched")

with open(src_path, "w", encoding="utf-8") as f:
    f.write(src)
print("✓ build_vba9.py fully patched")
