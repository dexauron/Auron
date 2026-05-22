#!/usr/bin/env python3
"""Генерация VBA модуля для WAY MARKET v8 в cp1251"""

vba = r"""Attribute VB_Name = "Модуль_WM8"
' ===============================================================
' WAY MARKET v8 — VBA Модуль
' Листы: ВВОД_КАССА + ВВОД_РАСХОДЫ (разделены)
' Установка: Alt+F11 -> File -> Import File -> Модуль_WM8.bas
'            Alt+F8 -> УстановитьВсеКнопки -> Run
' ===============================================================
Option Explicit

' --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ------------------------------------

Function БезопасноеЧисло(val As Variant) As Double
    On Error Resume Next
    If IsNumeric(val) And Not IsEmpty(val) And val <> "" Then
        БезопасноеЧисло = CDbl(val)
    Else
        БезопасноеЧисло = 0
    End If
    On Error GoTo 0
End Function

Function ВклВыкл(val As Variant) As Boolean
    ВклВыкл = (UCase(CStr(val)) = "ВКЛ")
End Function

Function ПоследняяСтрокаБазы() As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    ПоследняяСтрокаБазы = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If ПоследняяСтрокаБазы < 3 Then ПоследняяСтрокаБазы = 3
End Function

Sub ЗаписатьТранзакцию(Дата As Date, Смена As String, Кассир As String, _
                        Тип As String, Категория As String, Способ As String, _
                        Сумма As Double, Комментарий As String)
    Dim ws As Worksheet
    Dim r As Long
    Set ws = ThisWorkbook.Sheets("БАЗА_ДДС")
    r = ПоследняяСтрокаБазы() + 1
    ws.Cells(r, 1).Value = Дата
    ws.Cells(r, 1).NumberFormat = "DD.MM.YYYY"
    ws.Cells(r, 2).Value = Смена
    ws.Cells(r, 3).Value = Кассир
    ws.Cells(r, 4).Value = Тип
    ws.Cells(r, 5).Value = Категория
    ws.Cells(r, 6).Value = Способ
    ws.Cells(r, 7).Value = Сумма
    ws.Cells(r, 7).NumberFormat = "#,##0"
    ws.Cells(r, 8).Value = Комментарий
End Sub

Function ПолучитьДату(wsName As String) As Variant
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(wsName)
    Dim dd As Variant, mm As Variant, yy As Variant
    dd = ws.Range("C5").Value
    mm = ws.Range("E5").Value
    yy = ws.Range("H5").Value
    If dd = "" Or mm = "" Or yy = "" Then
        ПолучитьДату = "": Exit Function
    End If
    Dim m As Integer
    Select Case CStr(mm)
        Case "Январь": m = 1
        Case "Февраль": m = 2
        Case "Март": m = 3
        Case "Апрель": m = 4
        Case "Май": m = 5
        Case "Июнь": m = 6
        Case "Июль": m = 7
        Case "Август": m = 8
        Case "Сентябрь": m = 9
        Case "Октябрь": m = 10
        Case "Ноябрь": m = 11
        Case "Декабрь": m = 12
        Case Else: ПолучитьДату = "": Exit Function
    End Select
    On Error Resume Next
    ПолучитьДату = DateSerial(CInt(yy), m, CInt(dd))
    On Error GoTo 0
End Function

Sub ПоставитьДату(wsName As String, d As Date)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(wsName)
    Dim mn() As Variant
    mn = Array("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", _
               "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
    ws.Range("C5").Value = Day(d)
    ws.Range("E5").Value = mn(Month(d) - 1)
    ws.Range("H5").Value = Year(d)
End Sub

' --- ВВОД_КАССА --------------------------------------------------

Sub ПоставитьСегодняКасса()
    ПоставитьДату "ВВОД_КАССА", Date
End Sub

Sub ПоставитьВчераКасса()
    ПоставитьДату "ВВОД_КАССА", Date - 1
End Sub

Sub ОбновитьФормуКасса()
    Dim ws As Worksheet, wsН As Worksheet
    Set ws = ThisWorkbook.Sheets("ВВОД_КАССА")
    Set wsН = ThisWorkbook.Sheets("НАСТРОЙКИ")
    Application.ScreenUpdating = False
    ws.Rows("11:22").Hidden = Not ВклВыкл(wsН.Range("E15").Value)
    ws.Rows("24:35").Hidden = Not ВклВыкл(wsН.Range("E16").Value)
    ws.Rows("37:48").Hidden = Not ВклВыкл(wsН.Range("E17").Value)
    ws.Rows("51:52").Hidden = Not ВклВыкл(wsН.Range("E34").Value)
    Application.ScreenUpdating = True
    MsgBox "Форма обновлена по настройкам", vbInformation, "Готово"
End Sub

Sub СохранитьКассу()
    On Error GoTo Ошибка
    Dim wsК As Worksheet, wsН As Worksheet
    Set wsК = ThisWorkbook.Sheets("ВВОД_КАССА")
    Set wsН = ThisWorkbook.Sheets("НАСТРОЙКИ")

    Dim датаVar As Variant
    датаVar = ПолучитьДату("ВВОД_КАССА")
    If датаVar = "" Then
        MsgBox "Заполните все 3 поля даты: ДД, Месяц, ГГГГ", vbExclamation
        wsК.Range("C5").Select: Exit Sub
    End If
    Dim дата As Date: дата = CDate(датаVar)

    Dim кассир As String
    кассир = CStr(wsК.Range("C9").Value)
    If кассир = "" Then
        MsgBox "Выберите кассира", vbExclamation
        wsК.Range("C9").Select: Exit Sub
    End If

    Dim день As Boolean, вечер As Boolean, ночь As Boolean
    Dim экв As Boolean, пер As Boolean, онл As Boolean, иман As Boolean, выпл As Boolean
    Dim свНал As Boolean, свЭкв As Boolean
    день = ВклВыкл(wsН.Range("E15").Value)
    вечер = ВклВыкл(wsН.Range("E16").Value)
    ночь = ВклВыкл(wsН.Range("E17").Value)
    экв = ВклВыкл(wsН.Range("E20").Value)
    пер = ВклВыкл(wsН.Range("E21").Value)
    онл = ВклВыкл(wsН.Range("E22").Value)
    иман = ВклВыкл(wsН.Range("E23").Value)
    выпл = ВклВыкл(wsН.Range("E24").Value)
    свНал = ВклВыкл(wsН.Range("E27").Value)
    свЭкв = ВклВыкл(wsН.Range("E28").Value)

    Dim отв As Integer
    отв = MsgBox("Сохранить кассу за " & Format(дата, "DD.MM.YYYY") & "?" & vbCrLf & _
                 "Кассир: " & кассир, vbYesNo + vbQuestion, "Подтверждение")
    If отв = vbNo Then Exit Sub

    Application.ScreenUpdating = False

    Dim смены(2) As String, флаги(2) As Boolean
    смены(0) = "День": флаги(0) = день
    смены(1) = "Вечер": флаги(1) = вечер
    смены(2) = "Ночь": флаги(2) = ночь

    Dim addrsZ(2, 7) As String
    addrsZ(0, 0) = "E12": addrsZ(0, 1) = "E13": addrsZ(0, 2) = "E14"
    addrsZ(0, 3) = "E15": addrsZ(0, 4) = "E16": addrsZ(0, 5) = "E17"
    addrsZ(0, 6) = "E19": addrsZ(0, 7) = "E20"
    addrsZ(1, 0) = "E25": addrsZ(1, 1) = "E26": addrsZ(1, 2) = "E27"
    addrsZ(1, 3) = "E28": addrsZ(1, 4) = "E29": addrsZ(1, 5) = "E30"
    addrsZ(1, 6) = "E32": addrsZ(1, 7) = "E33"
    addrsZ(2, 0) = "E38": addrsZ(2, 1) = "E39": addrsZ(2, 2) = "E40"
    addrsZ(2, 3) = "E41": addrsZ(2, 4) = "E42": addrsZ(2, 5) = "E43"
    addrsZ(2, 6) = "E45": addrsZ(2, 7) = "E46"

    Dim si As Integer
    For si = 0 To 2
        If флаги(si) Then
            Dim смена As String: смена = смены(si)
            Dim zН As Double, zЭ As Double, zП As Double
            Dim zО As Double, zИ As Double, zВ As Double
            Dim фН As Double, фЭ As Double
            zН = БезопасноеЧисло(wsК.Range(addrsZ(si, 0)).Value)
            If экв Then zЭ = БезопасноеЧисло(wsК.Range(addrsZ(si, 1)).Value)
            If пер Then zП = БезопасноеЧисло(wsК.Range(addrsZ(si, 2)).Value)
            If онл Then zО = БезопасноеЧисло(wsК.Range(addrsZ(si, 3)).Value)
            If иман Then zИ = БезопасноеЧисло(wsК.Range(addrsZ(si, 4)).Value)
            If выпл Then zВ = БезопасноеЧисло(wsК.Range(addrsZ(si, 5)).Value)
            If свНал Then фН = БезопасноеЧисло(wsК.Range(addrsZ(si, 6)).Value)
            If свЭкв Then фЭ = БезопасноеЧисло(wsК.Range(addrsZ(si, 7)).Value)

            If zН > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Доход", "Выручка", "Наличка", zН, "по Z"
            If zЭ > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Доход", "Выручка", "Эквайринг", zЭ, "по Z"
            If zП > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Доход", "Выручка", "Перевод", zП, "по Z"
            If zО > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Доход", "Выручка", "Онлайн", zО, "Онлайн"
            If zИ > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Иман", "Прочие расходы", "Иман", zИ, "Иман"
            If zВ > 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Расход", "Прочие расходы", "Наличка", zВ, "Выплата с кассы"

            If свНал Then
                Dim рН As Double: рН = zН - zВ - фН
                If рН <> 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Расхождение", "Прочие расходы", "Наличка", рН, "Расхождение нал (" & смена & ")"
            End If
            If свЭкв Then
                Dim рЭ As Double: рЭ = zЭ - фЭ
                If рЭ <> 0 Then ЗаписатьТранзакцию дата, смена, кассир, "Расхождение", "Прочие расходы", "Эквайринг", рЭ, "Расхождение экв (" & смена & ")"
            End If
        End If
    Next si

    If ВклВыкл(wsН.Range("E34").Value) Then
        Dim остУ As Double, остВ As Double
        остУ = БезопасноеЧисло(wsК.Range("E51").Value)
        остВ = БезопасноеЧисло(wsК.Range("E52").Value)
        If остУ > 0 Then ЗаписатьТранзакцию дата, "—", кассир, "Касса", "Касса утром", "Наличка", остУ, "Остаток утром"
        If остВ > 0 Then ЗаписатьТранзакцию дата, "—", кассир, "Касса", "Касса вечером", "Наличка", остВ, "Остаток вечером"
    End If

    ОчиститьКассу
    Application.ScreenUpdating = True
    MsgBox "Касса за " & Format(дата, "DD.MM.YYYY") & " сохранена в БАЗА_ДДС", vbInformation
    Exit Sub
Ошибка:
    Application.ScreenUpdating = True
    MsgBox "Ошибка: " & Err.Description, vbCritical
End Sub

Sub ОчиститьКассу()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ВВОД_КАССА")
    Dim addr As Variant
    For Each addr In Array("C5", "E5", "H5", "C9")
        ws.Range(CStr(addr)).Value = ""
    Next addr
    For Each addr In Array("E12","E13","E14","E15","E16","E17","E19","E20", _
                           "E25","E26","E27","E28","E29","E30","E32","E33", _
                           "E38","E39","E40","E41","E42","E43","E45","E46","E51","E52")
        ws.Range(CStr(addr)).Value = ""
    Next addr
    ws.Range("C5").Select
End Sub

' --- ВВОД_РАСХОДЫ ------------------------------------------------

Sub ПоставитьСегодняРасходы()
    ПоставитьДату "ВВОД_РАСХОДЫ", Date
End Sub

Sub ПоставитьВчераРасходы()
    ПоставитьДату "ВВОД_РАСХОДЫ", Date - 1
End Sub

Sub СохранитьРасходы()
    On Error GoTo Ошибка
    Dim wsР As Worksheet, wsН As Worksheet
    Set wsР = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    Set wsН = ThisWorkbook.Sheets("НАСТРОЙКИ")

    Dim датаVar As Variant
    датаVar = ПолучитьДату("ВВОД_РАСХОДЫ")
    If датаVar = "" Then
        MsgBox "Заполните все 3 поля даты: ДД, Месяц, ГГГГ", vbExclamation
        wsР.Range("C5").Select: Exit Sub
    End If
    Dim дата As Date: дата = CDate(датаVar)

    Dim отв As String: отв = CStr(wsР.Range("C9").Value)
    If отв = "" Then отв = "—"

    Dim ответ As Integer
    ответ = MsgBox("Сохранить расходы за " & Format(дата, "DD.MM.YYYY") & "?", vbYesNo + vbQuestion, "Подтверждение")
    If ответ = vbNo Then Exit Sub

    Application.ScreenUpdating = False

    Dim спис As Boolean, возвр As Boolean
    спис = ВклВыкл(wsН.Range("E32").Value)
    возвр = ВклВыкл(wsН.Range("E33").Value)

    Dim з1 As Double, з2 As Double, з3 As Double, з4 As Double
    Dim гсм As Double, мат As Double, проч As Double
    Dim сп As Double, вр As Double
    з1 = БезопасноеЧисло(wsР.Range("E12").Value)
    з2 = БезопасноеЧисло(wsР.Range("E13").Value)
    з3 = БезопасноеЧисло(wsР.Range("E14").Value)
    з4 = БезопасноеЧисло(wsР.Range("E15").Value)
    гсм = БезопасноеЧисло(wsР.Range("E18").Value)
    мат = БезопасноеЧисло(wsР.Range("E19").Value)
    проч = БезопасноеЧисло(wsР.Range("E20").Value)
    If спис Then сп = БезопасноеЧисло(wsР.Range("E23").Value)
    If возвр Then вр = БезопасноеЧисло(wsР.Range("E24").Value)

    If з1 > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Расход", "Закуп товара", "Наличка", з1, "Закуп нал из кассы"
    If з2 > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Расход", "Закуп товара", "Наличка", з2, "Закуп нал из офиса"
    If з3 > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Долг", "Закуп товара", "Долг", з3, "Закуп в долг"
    If з4 > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Оплата долга", "Закуп товара", "Наличка", з4, "Выплата долга поставщикам"
    If гсм > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Расход", "ГСМ", "Наличка", гсм, ""
    If мат > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Расход", "Расходный материал", "Наличка", мат, ""
    If проч > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Расход", "Прочие расходы", "Наличка", проч, ""
    If сп > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Списание", "Списание", "", сп, "Списание товара"
    If вр > 0 Then ЗаписатьТранзакцию дата, "—", отв, "Возврат", "Возврат", "", вр, "Возврат поставщику"

    ОчиститьРасходы
    Application.ScreenUpdating = True
    MsgBox "Расходы за " & Format(дата, "DD.MM.YYYY") & " сохранены в БАЗА_ДДС", vbInformation
    Exit Sub
Ошибка:
    Application.ScreenUpdating = True
    MsgBox "Ошибка: " & Err.Description, vbCritical
End Sub

Sub ОчиститьРасходы()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    Dim addr As Variant
    For Each addr In Array("C5","E5","H5","C9","E12","E13","E14","E15","E18","E19","E20","E23","E24")
        ws.Range(CStr(addr)).Value = ""
    Next addr
    ws.Range("C5").Select
End Sub

' --- ДАШБОРД -----------------------------------------------------

Sub ОбновитьДашборд()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    ws.Range("B4").Value = DateSerial(Year(Date), Month(Date), 1)
    ws.Range("B4").NumberFormat = "DD.MM.YYYY"
    ws.Range("D4").Value = Date
    ws.Range("D4").NumberFormat = "DD.MM.YYYY"
End Sub

Sub ДашбордПрошлыйМесяц()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    ws.Range("B4").Value = DateSerial(Year(Date), Month(Date) - 1, 1)
    ws.Range("B4").NumberFormat = "DD.MM.YYYY"
    ws.Range("D4").Value = DateSerial(Year(Date), Month(Date), 1) - 1
    ws.Range("D4").NumberFormat = "DD.MM.YYYY"
End Sub

Sub ДашбордГод()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    ws.Range("B4").Value = DateSerial(Year(Date), 1, 1)
    ws.Range("B4").NumberFormat = "DD.MM.YYYY"
    ws.Range("D4").Value = Date
    ws.Range("D4").NumberFormat = "DD.MM.YYYY"
End Sub

Sub ДашбордВсёВремя()
    Dim ws As Worksheet, wsН As Worksheet
    Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    Set wsН = ThisWorkbook.Sheets("НАСТРОЙКИ")
    Dim startDate As Variant: startDate = wsН.Range("E6").Value
    If IsDate(startDate) Then
        ws.Range("B4").Value = CDate(startDate)
    Else
        ws.Range("B4").Value = DateSerial(2026, 1, 1)
    End If
    ws.Range("B4").NumberFormat = "DD.MM.YYYY"
    ws.Range("D4").Value = Date
    ws.Range("D4").NumberFormat = "DD.MM.YYYY"
End Sub

' --- УСТАНОВИТЬ КНОПКИ -------------------------------------------

Sub УстановитьВсеКнопки()
    On Error GoTo Ошибка
    УстановитьКнопкиКасса
    УстановитьКнопкиРасходы
    УстановитьКнопкиДашборд
    ОбновитьДашборд
    MsgBox "Все кнопки установлены!" & vbCrLf & _
           "Дашборд настроен на текущий месяц." & vbCrLf & vbCrLf & _
           "Готово к работе!", vbInformation, "WAY MARKET v8"
    Exit Sub
Ошибка:
    MsgBox "Ошибка: " & Err.Description, vbCritical
End Sub

Sub УстановитьКнопкиКасса()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ВВОД_КАССА")
    Dim sh As Shape
    For Each sh In ws.Shapes
        If InStr(LCase(sh.Name), "btnk") > 0 Then sh.Delete
    Next sh
    СоздатьКнопку ws, "btnkСег", "Сегодня", "ПоставитьСегодняКасса", ws.Range("N4:O5"), RGB(59, 130, 246)
    СоздатьКнопку ws, "btnkВч", "Вчера", "ПоставитьВчераКасса", ws.Range("N6:O7"), RGB(245, 158, 11)
    СоздатьКнопку ws, "btnkСохр", "СОХРАНИТЬ КАССУ", "СохранитьКассу", ws.Range("N8:O12"), RGB(16, 185, 129)
    СоздатьКнопку ws, "btnkОч", "Очистить", "ОчиститьКассу", ws.Range("N13:O14"), RGB(239, 68, 68)
    СоздатьКнопку ws, "btnkОбн", "Обновить форму", "ОбновитьФормуКасса", ws.Range("N15:O16"), RGB(139, 92, 246)
End Sub

Sub УстановитьКнопкиРасходы()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ВВОД_РАСХОДЫ")
    Dim sh As Shape
    For Each sh In ws.Shapes
        If InStr(LCase(sh.Name), "btnr") > 0 Then sh.Delete
    Next sh
    СоздатьКнопку ws, "btnrСег", "Сегодня", "ПоставитьСегодняРасходы", ws.Range("N4:O5"), RGB(59, 130, 246)
    СоздатьКнопку ws, "btnrВч", "Вчера", "ПоставитьВчераРасходы", ws.Range("N6:O7"), RGB(245, 158, 11)
    СоздатьКнопку ws, "btnrСохр", "СОХРАНИТЬ РАСХОДЫ", "СохранитьРасходы", ws.Range("N8:O12"), RGB(16, 185, 129)
    СоздатьКнопку ws, "btnrОч", "Очистить", "ОчиститьРасходы", ws.Range("N13:O14"), RGB(239, 68, 68)
End Sub

Sub УстановитьКнопкиДашборд()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Sheets("ДАШБОРД")
    Dim sh As Shape
    For Each sh In ws.Shapes
        If InStr(LCase(sh.Name), "dash") > 0 Then sh.Delete
    Next sh
    СоздатьКнопку ws, "dashМес", "Этот месяц", "ОбновитьДашборд", ws.Range("H4:I4"), RGB(79, 70, 229)
    СоздатьКнопку ws, "dashПрош", "Прошлый мес.", "ДашбордПрошлыйМесяц", ws.Range("J4:K4"), RGB(139, 92, 246)
    СоздатьКнопку ws, "dashГод", "С нач. года", "ДашбордГод", ws.Range("L4:M4"), RGB(20, 184, 166)
    СоздатьКнопку ws, "dashВсё", "Всё время", "ДашбордВсёВремя", ws.Range("N4:O4"), RGB(107, 114, 128)
End Sub

Sub СоздатьКнопку(ws As Worksheet, имя As String, текст As String, _
                   макрос As String, диап As Range, цвет As Long)
    Dim btn As Shape
    Set btn = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
        диап.Left, диап.Top, диап.Width, диап.Height)
    btn.Name = имя
    btn.Fill.ForeColor.RGB = цвет
    btn.Line.Visible = msoFalse
    btn.TextFrame2.TextRange.Text = текст
    btn.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    btn.TextFrame2.TextRange.Font.Size = 11
    btn.TextFrame2.TextRange.Font.Bold = True
    btn.TextFrame2.TextRange.Font.Name = "Calibri"
    btn.TextFrame2.VerticalAnchor = msoAnchorMiddle
    btn.TextFrame2.HorizontalAnchor = msoAnchorCenter
    btn.OnAction = макрос
End Sub
"""

# Сохраняем в cp1251 с CRLF
with open("/home/user/Auron/Модуль_WM8.bas", "w", encoding="cp1251", newline="\r\n") as f:
    f.write(vba)

# UTF-8 версия для просмотра
with open("/home/user/Auron/Модуль_WM8_utf8.txt", "w", encoding="utf-8") as f:
    f.write(vba)

print("✅ VBA модули сохранены:")
print("   Модуль_WM8.bas (cp1251, CRLF) — для импорта в Excel")
print("   Модуль_WM8_utf8.txt (utf-8)   — для просмотра")
