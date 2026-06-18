Attribute VB_Name = "Модуль_ВайМаркет"
' ===============================================================
' ВАЙ МАРКЕТ — контроллеры (Storage <- UI), сводная и кнопки.
' Установка: Alt+F11 -> File -> Import File -> этот .bas
'            Alt+F8 -> УстановитьКнопки -> Run
' ===============================================================
Option Explicit

Private Const ПАРОЛЬ As String = "wm"

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
