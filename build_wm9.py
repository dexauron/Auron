#!/usr/bin/env python3
"""WAY MARKET v9 — Full Build (11 sheets). Professional management accounting template."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Protection
from openpyxl.formatting.rule import FormulaRule, ColorScaleRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.chart import LineChart, BarChart, PieChart, Reference
from openpyxl.chart.series import DataPoint
from openpyxl.utils import get_column_letter
from datetime import date, datetime

today = date.today()

# ── Color Palette ──────────────────────────────────────────────────────────────
NAVY="FF111827"; INDIGO="FF4F46E5"
GREEN="FF10B981"; GREEN_L="FFD1FAE5"
BLUE="FF3B82F6";  BLUE_L="FFEFF6FF"
RED="FFEF4444";   RED_L="FFFEE2E2"
AMBER="FFF59E0B"; AMBER_L="FFFEF3C7"
PURPLE="FF8B5CF6";PURP_L="FFEDE9FE"
TEAL="FF14B8A6";  TEAL_L="FFCCFBF1"
GRAY="FF6B7280";  LGRAY="FFF7F8FA"
BORDER="FFE5E7EB";WHITE="FFFFFFFF"
INP="FFEFF6FF";   INP_BD="FF3B82F6"
DISABLED="FFF3F4F6"
MONEY="#,##0;[Red]-#,##0"; MONEY2="#,##0.0;[Red]-#,##0.0"; DATE_F="DD.MM.YYYY"
MONTHS_RU=["Январь","Февраль","Март","Апрель","Май","Июнь",
           "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"]

# ── Style Helpers ──────────────────────────────────────────────────────────────
def F(c): return PatternFill("solid",start_color=c,fgColor=c)
def fnt(sz=10,bold=False,col="FF000000",it=False):
    return Font(name="Calibri",size=sz,bold=bold,color=col,italic=it)
def brd(c=BORDER,s="thin"):
    sd=Side(style=s,color=c); return Border(left=sd,right=sd,top=sd,bottom=sd)
def brd_med(c=INP_BD): sd=Side(style="medium",color=c); return Border(left=sd,right=sd,top=sd,bottom=sd)
def CA(wrap=True): return Alignment(horizontal="center",vertical="center",wrap_text=wrap)
def LA(): return Alignment(horizontal="left",vertical="center",wrap_text=True)
def RA(): return Alignment(horizontal="right",vertical="center")
def prot(locked=True): return Protection(locked=locked)

def banner(ws,txt,merge,bg=NAVY,sz=14,col="FFFFFFFF"):
    ws.merge_cells(merge)
    c=ws[merge.split(":")[0]]; c.value=txt
    c.font=fnt(sz,True,col); c.fill=F(bg); c.alignment=CA()
    r=int(''.join(x for x in merge.split(":")[0] if x.isdigit()))
    ws.row_dimensions[r].height=38

def sec_hdr(ws,row,txt,ncols,bg,h=26):
    ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=ncols)
    c=ws.cell(row,1); c.value=txt
    c.font=fnt(10,True,"FFFFFFFF"); c.fill=F(bg); c.alignment=LA()
    ws.row_dimensions[row].height=h

def hrow(ws,row,headers,bg=NAVY,h=24):
    for ci,h_ in enumerate(headers,1):
        c=ws.cell(row,ci); c.value=h_
        c.font=fnt(9,True,"FFFFFFFF"); c.fill=F(bg); c.alignment=CA(); c.border=brd()
    ws.row_dimensions[row].height=h

def cw(ws,widths):
    for col,w in widths.items(): ws.column_dimensions[col].width=w

def lbl_cell(ws,row,c1,c2,text,bg=LGRAY,h=24):
    if c1!=c2: ws.merge_cells(start_row=row,start_column=c1,end_row=row,end_column=c2)
    c=ws.cell(row,c1); c.value=text
    c.font=fnt(10); c.fill=F(bg); c.border=brd(); c.alignment=LA()
    ws.row_dimensions[row].height=h

def inp_cell(ws,row,c1,c2,money=True,val=None,fmt=None):
    if c1!=c2: ws.merge_cells(start_row=row,start_column=c1,end_row=row,end_column=c2)
    c=ws.cell(row,c1)
    if val is not None: c.value=val
    c.font=fnt(12,True,INDIGO); c.fill=F(INP); c.border=brd_med(); c.alignment=CA()
    c.protection=prot(False)
    if money: c.number_format=MONEY
    if fmt: c.number_format=fmt
    return c

def calc_cell(ws,row,c1,c2,formula,money=True,col=GREEN,bg=GREEN_L,sz=11):
    if c1!=c2: ws.merge_cells(start_row=row,start_column=c1,end_row=row,end_column=c2)
    c=ws.cell(row,c1); c.value=formula
    c.font=fnt(sz,True,col); c.fill=F(bg); c.border=brd()
    c.alignment=RA() if money else CA()
    if money: c.number_format=MONEY
    return c

def hint_cell(ws,row,c1,c2,text):
    if c1!=c2: ws.merge_cells(start_row=row,start_column=c1,end_row=row,end_column=c2)
    c=ws.cell(row,c1); c.value=text
    c.font=fnt(9,it=True,col=GRAY); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()

# ── Dashboard KPI Card Builder ─────────────────────────────────────────────────
def kpi_card(ws, row, col_start, col_end, label, value_formula, prev_formula,
             bg_label=LGRAY, bg_val=WHITE, val_color=NAVY, money_fmt=True):
    """Creates a 2-row KPI card: row N=label, row N+1=value+trend"""
    # Label row
    ws.merge_cells(start_row=row, start_column=col_start, end_row=row, end_column=col_end)
    c = ws.cell(row, col_start)
    c.value = label
    c.font = fnt(9, False, GRAY); c.fill = F(bg_label)
    c.border = brd(); c.alignment = CA()
    ws.row_dimensions[row].height = 18

    # Value row
    ws.merge_cells(start_row=row+1, start_column=col_start, end_row=row+1, end_column=col_end-1)
    cv = ws.cell(row+1, col_start)
    cv.value = value_formula
    cv.font = fnt(14, True, val_color); cv.fill = F(bg_val)
    cv.border = brd(); cv.alignment = CA(wrap=False)
    if money_fmt: cv.number_format = MONEY

    # Trend arrow cell
    ct = ws.cell(row+1, col_end)
    if prev_formula:
        ct.value = f'=IF({value_formula[1:]}>{prev_formula[1:]},"▲","▼")'
        ct.font = fnt(11, True, GREEN)
    else:
        ct.value = ""
    ct.fill = F(bg_val); ct.border = brd(); ct.alignment = CA()
    ws.row_dimensions[row+1].height = 32

    # Traffic light conditional formatting
    addr_val = f"{get_column_letter(col_start)}{row+1}"
    return cv, ct

wb = Workbook()

# ════════════════════════════════════════════════════════════
# 1. НАСТРОЙКИ
# ════════════════════════════════════════════════════════════
ws = wb.active; ws.title = "НАСТРОЙКИ"; ws.sheet_view.showGridLines = False
banner(ws, "⚙  НАСТРОЙКИ МАГАЗИНА — все параметры в одном месте", "A1:H1", INDIGO)
ws.merge_cells("A2:H2")
ws.cell(2,1).value = "Заполните разделы ниже один раз. Все листы подстроятся автоматически."
ws.cell(2,1).font = fnt(10,it=True,col=GRAY); ws.cell(2,1).fill = F(LGRAY)
ws.cell(2,1).alignment = CA(); ws.row_dimensions[2].height = 22

sec_hdr(ws, 4, "  ПАРАМЕТРЫ МАГАЗИНА", 8, INDIGO)
params = [("Название магазина","WAY MARKET №2","text"),
          ("Дата начала учёта","01.01.2026","date"),
          ("Доля в фонд рентабельности (%)","25","num"),
          ("Лимит на закуп (%)","75","num"),
          ("Начальный долг поставщикам (₽)", 500000, "money"),
          ("Округление сумм","До рубля","round"),
          ("Период сравнения","Прошлый месяц","period")]
for i,(label,val,t) in enumerate(params,5):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=label; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=val; c.font=fnt(11,True,INDIGO); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); c.protection=prot(False)
    if t=="money": c.number_format=MONEY
    if t=="date": c.number_format=DATE_F
    if t=="round":
        dv=DataValidation(type="list",formula1='"До рубля,До копейки,До 100 руб,До 1000 руб"')
        ws.add_data_validation(dv); dv.add(c)
    if t=="period":
        dv=DataValidation(type="list",formula1='"Прошлый месяц,Прошлый квартал,Прошлый год"')
        ws.add_data_validation(dv); dv.add(c)
    ws.row_dimensions[i].height=24

sec_hdr(ws, 13, "  РЕЖИМ РАБОТЫ — активные смены", 8, AMBER)
ws.merge_cells("A14:D14"); ws.cell(14,1).value="Количество смен"
ws.cell(14,1).font=fnt(10); ws.cell(14,1).fill=F(LGRAY); ws.cell(14,1).border=brd(); ws.cell(14,1).alignment=LA()
ws.merge_cells("E14:H14"); ws.cell(14,5).value=2
ws.cell(14,5).font=fnt(11,True,AMBER); ws.cell(14,5).fill=F(INP)
ws.cell(14,5).border=brd_med(); ws.cell(14,5).alignment=CA(); ws.cell(14,5).protection=prot(False)
dv_cnt=DataValidation(type="list",formula1='"1,2,3"'); ws.add_data_validation(dv_cnt); dv_cnt.add(ws.cell(14,5))
dv_oo=DataValidation(type="list",formula1='"Вкл,Выкл"'); ws.add_data_validation(dv_oo)
for i,(sn,sv) in enumerate([("Смена ДЕНЬ","Вкл"),("Смена ВЕЧЕР","Вкл"),("Смена НОЧЬ","Выкл")],15):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=sn; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=sv; c.font=fnt(11,True); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); dv_oo.add(c); c.protection=prot(False)
    ws.row_dimensions[i].height=22

sec_hdr(ws, 19, "  Z-ОТЧЁТ (источники выручки)", 8, BLUE)
for i,(p,v) in enumerate([("Эквайринг","Вкл"),("Перевод","Вкл"),("Онлайн торговля","Выкл"),
                           ("Иман (хозяин)","Вкл"),("Выплата с кассы","Вкл")],20):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=p; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=v; c.font=fnt(11,True); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); dv_oo.add(c); c.protection=prot(False)
    ws.row_dimensions[i].height=22

sec_hdr(ws, 26, "  КОНТРОЛЬ КАССЫ", 8, GREEN)
for i,(p,v) in enumerate([("Сверка по наличке","Вкл"),("Сверка по эквайрингу","Выкл"),("Сверка по переводу","Выкл")],27):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=p; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=v; c.font=fnt(11,True); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); dv_oo.add(c); c.protection=prot(False)
    ws.row_dimensions[i].height=22

sec_hdr(ws, 31, "  ИНВЕНТАРЬ И ДОПОЛНИТЕЛЬНЫЙ УЧЁТ", 8, PURPLE)
for i,(p,v) in enumerate([("Списание товара","Вкл"),("Возврат поставщику","Вкл"),("Касса утром/вечером (остатки)","Вкл")],32):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=p; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=v; c.font=fnt(11,True); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); dv_oo.add(c); c.protection=prot(False)
    ws.row_dimensions[i].height=22

sec_hdr(ws, 36, "  ПОРОГИ УВЕДОМЛЕНИЙ", 8, RED)
for i,(p,v,t) in enumerate([("Расхождение кассы больше (₽)",5000,"money"),
                              ("Общий долг больше (₽)",1000000,"money"),
                              ("Просрочка больше (дней)",7,"num")],37):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=4)
    c=ws.cell(i,1); c.value=p; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
    ws.merge_cells(start_row=i,start_column=5,end_row=i,end_column=8)
    c=ws.cell(i,5); c.value=v; c.font=fnt(11,True,RED); c.fill=F(INP)
    c.border=brd_med(); c.alignment=CA(); c.protection=prot(False)
    if t=="money": c.number_format=MONEY
    ws.row_dimensions[i].height=22

# Conditional formatting for Вкл/Выкл
for addr in ["E15","E16","E17","E20","E21","E22","E23","E24","E27","E28","E29","E32","E33","E34"]:
    ws.conditional_formatting.add(addr,FormulaRule(formula=[f'{addr}="Вкл"'],fill=F(GREEN_L),font=fnt(11,True,GREEN)))
    ws.conditional_formatting.add(addr,FormulaRule(formula=[f'{addr}="Выкл"'],fill=F(RED_L),font=fnt(11,True,RED)))

sec_hdr(ws, 41, "  СПРАВОЧНИКИ (выпадающие списки для ввода данных)", 8, INDIGO)
# Кассиры col A
ws.cell(43,1).value="КАССИРЫ"; ws.cell(43,1).font=fnt(10,True,"FFFFFFFF")
ws.cell(43,1).fill=F(PURPLE); ws.cell(43,1).alignment=CA(); ws.cell(43,1).border=brd()
for i,n in enumerate(["Иванов А.","Петров П.","Сидоров С.","Козлов К."],44):
    c=ws.cell(i,1); c.value=n; c.font=fnt(10); c.fill=F(PURP_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
for i in range(48,80):
    c=ws.cell(i,1); c.fill=F(PURP_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
# Категории col C
ws.cell(43,3).value="КАТЕГОРИИ"; ws.cell(43,3).font=fnt(10,True,"FFFFFFFF")
ws.cell(43,3).fill=F(AMBER); ws.cell(43,3).alignment=CA(); ws.cell(43,3).border=brd()
cats=["Закуп товара","ГСМ","Расходный материал","Зарплата","Аренда","Коммунальные",
      "Налог","Прочие расходы","Списание","Возврат","Маркетинг","Охрана"]
for i,n in enumerate(cats,44):
    c=ws.cell(i,3); c.value=n; c.font=fnt(10); c.fill=F(AMBER_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
for i in range(56,80):
    c=ws.cell(i,3); c.fill=F(AMBER_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
# Способы оплаты col E
ws.cell(43,5).value="СПОСОБЫ ОПЛАТЫ"; ws.cell(43,5).font=fnt(10,True,"FFFFFFFF")
ws.cell(43,5).fill=F(TEAL); ws.cell(43,5).alignment=CA(); ws.cell(43,5).border=brd()
for i,n in enumerate(["Наличка","Эквайринг","Перевод","Онлайн","Иман","Долг"],44):
    c=ws.cell(i,5); c.value=n; c.font=fnt(10); c.fill=F(TEAL_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
for i in range(50,80):
    c=ws.cell(i,5); c.fill=F(TEAL_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA(); c.protection=prot(False)
# Типы операций col G
ws.cell(43,7).value="ТИПЫ ОПЕРАЦИЙ"; ws.cell(43,7).font=fnt(10,True,"FFFFFFFF")
ws.cell(43,7).fill=F(BLUE); ws.cell(43,7).alignment=CA(); ws.cell(43,7).border=brd()
for i,n in enumerate(["Доход","Расход","Долг","Оплата долга","Расхождение","Иман","Списание","Возврат","Касса"],44):
    c=ws.cell(i,7); c.value=n; c.font=fnt(10); c.fill=F(BLUE_L if i%2==0 else WHITE); c.border=brd(); c.alignment=LA()

# Постоянные расходы
sec_hdr(ws, 82, "  ПОСТОЯННЫЕ РАСХОДЫ (умная таблица tblПостоянные)", 8, TEAL)
hrow(ws, 83, ["Месяц","Зарплата","Аренда","Коммунальные","Налог","Маркетинг","Охрана","ИТОГО"], TEAL, 24)
for mi,mon in enumerate(MONTHS_RU):
    r=84+mi
    for ci,v in enumerate([mon,540000,366000,90000,90000,30000,25000],1):
        c=ws.cell(r,ci); c.value=v; c.font=fnt(10,bold=(ci==1))
        c.fill=F(INP if ci>=2 else (LGRAY if mi%2==0 else WHITE))
        c.border=brd(); c.alignment=LA() if ci==1 else RA()
        if ci>=2: c.number_format=MONEY; c.protection=prot(False)
    ws.cell(r,8).value=f"=SUM(B{r}:G{r})"; ws.cell(r,8).font=fnt(10,True,TEAL)
    ws.cell(r,8).fill=F(TEAL_L); ws.cell(r,8).border=brd(); ws.cell(r,8).alignment=RA()
    ws.cell(r,8).number_format=MONEY; ws.row_dimensions[r].height=22
tbl_c=Table(displayName="tblПостоянные",ref="A83:H95")
tbl_c.tableStyleInfo=TableStyleInfo(name="TableStyleLight2",showRowStripes=True); ws.add_table(tbl_c)

cw(ws,{"A":22,"B":14,"C":14,"D":16,"E":14,"F":14,"G":14,"H":14})
ws.freeze_panes="A3"
ws.sheet_properties.tabColor="FF374151"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ НАСТРОЙКИ")

# ════════════════════════════════════════════════════════════
# 2. БАЗА_ДДС (умная таблица tblБаза)
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("БАЗА_ДДС"); ws.sheet_view.showGridLines = False
banner(ws, "БАЗА ДДС — ТРАНЗАКЦИОННЫЙ ЛОГ (умная таблица tblБаза)", "A1:H1", NAVY)
ws.merge_cells("A2:H2")
ws.cell(2,1).value = "Умная таблица tblБаза — фильтрация по любому столбцу. Данные вносятся через ВВОД_КАССА и ВВОД_РАСХОДЫ."
ws.cell(2,1).font=fnt(10,it=True,col=BLUE); ws.cell(2,1).fill=F(LGRAY); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

headers_b=["Дата","Смена","Кассир","Тип операции","Категория","Способ оплаты","Сумма","Комментарий"]
hrow(ws,3,headers_b,NAVY,32)
for r in range(4,3004):
    alt=r%2==0
    for ci in range(1,9):
        c=ws.cell(r,ci); c.border=brd(); c.fill=F(LGRAY if alt else WHITE); c.font=fnt(10)
        c.alignment=CA() if ci in [2,4,6] else LA() if ci in [3,5,8] else RA() if ci==7 else CA()
        c.protection=prot(False)
    ws.cell(r,1).number_format=DATE_F; ws.cell(r,7).number_format=MONEY
    ws.row_dimensions[r].height=20

for tipo,fill_,font_ in [("Доход",BLUE_L,BLUE),("Расход",RED_L,RED),("Долг",AMBER_L,AMBER),
                          ("Оплата долга",GREEN_L,GREEN),("Расхождение",RED_L,RED),
                          ("Иман",PURP_L,PURPLE),("Списание",RED_L,RED),("Возврат",GREEN_L,GREEN),("Касса",TEAL_L,TEAL)]:
    ws.conditional_formatting.add("D4:D3003",FormulaRule(formula=[f'$D4="{tipo}"'],fill=F(fill_),font=fnt(10,True,font_)))

dv_tp=DataValidation(type="list",formula1="=НАСТРОЙКИ!$G$44:$G$52"); ws.add_data_validation(dv_tp); dv_tp.add("D4:D3003")
dv_pay=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$49"); ws.add_data_validation(dv_pay); dv_pay.add("F4:F3003")
dv_cat=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$44:$C$55"); ws.add_data_validation(dv_cat); dv_cat.add("E4:E3003")
dv_ksr=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$44:$A$79"); ws.add_data_validation(dv_ksr); dv_ksr.add("C4:C3003")
dv_sm=DataValidation(type="list",formula1='"День,Вечер,Ночь,-"'); ws.add_data_validation(dv_sm); dv_sm.add("B4:B3003")

tbl_b=Table(displayName="tblБаза",ref="A3:H3003")
tbl_b.tableStyleInfo=TableStyleInfo(name="TableStyleMedium2",showRowStripes=True,showFirstColumn=False)
ws.add_table(tbl_b)
cw(ws,{"A":12,"B":10,"C":18,"D":16,"E":18,"F":14,"G":14,"H":30})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FF6B7280"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ БАЗА_ДДС")

# ════════════════════════════════════════════════════════════
# 3. ВВОД_КАССА
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_КАССА"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД ДАННЫХ КАССЫ — Z-отчёты и факт", "A1:M1", BLUE)
ws.merge_cells("A2:M2")
ws.cell(2,1).value="1. Выберите дату  2. Укажите кассира  3. Введите Z-отчёты смен  4. Нажмите СОХРАНИТЬ КАССУ"
ws.cell(2,1).font=fnt(10,it=True,col=BLUE); ws.cell(2,1).fill=F(BLUE_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

# Дата
sec_hdr(ws, 4, "  ДАТА СМЕНЫ", 13, INDIGO)
for col_,lbl_ in [(1,"День"),(4,"Месяц"),(7,"Год"),(10,"Итоговая дата:")]:
    c=ws.cell(5,col_); c.value=lbl_; c.font=fnt(10); c.fill=F(LGRAY); c.border=brd(); c.alignment=LA()
c=inp_cell(ws,5,2,3,money=False); c.value=today.day
dv_dd=DataValidation(type="whole",operator="between",formula1=1,formula2=31,allow_blank=True)
ws.add_data_validation(dv_dd); dv_dd.add(ws.cell(5,2))
c=inp_cell(ws,5,5,6,money=False); c.value=MONTHS_RU[today.month-1]
dv_mm=DataValidation(type="list",formula1='"Январь,Февраль,Март,Апрель,Май,Июнь,Июль,Август,Сентябрь,Октябрь,Ноябрь,Декабрь"')
ws.add_data_validation(dv_mm); dv_mm.add(ws.cell(5,5))
c=inp_cell(ws,5,8,9,money=False); c.value=today.year
dv_yy=DataValidation(type="whole",operator="between",formula1=2020,formula2=2099,allow_blank=True)
ws.add_data_validation(dv_yy); dv_yy.add(ws.cell(5,8))
ws.merge_cells("J5:M5")
c=ws.cell(5,10)
c.value='=IFERROR(DATE(H5,MATCH(E5,{"Январь";"Февраль";"Март";"Апрель";"Май";"Июнь";"Июль";"Август";"Сентябрь";"Октябрь";"Ноябрь";"Декабрь"},0),B5),"")'
c.font=fnt(12,True,GREEN); c.fill=F(GREEN_L); c.border=brd(); c.alignment=CA(); c.number_format='[$-419]dddd, d mmmm yyyy'
ws.row_dimensions[5].height=28

# Кассир
sec_hdr(ws, 7, "  КАССИР СМЕНЫ", 13, INDIGO)
lbl_cell(ws,8,1,4,"Кассир")
c=inp_cell(ws,8,5,9,money=False)
dv_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$44:$A$79"); ws.add_data_validation(dv_k); dv_k.add(c)

# Z-отчёты смен
sec_hdr(ws, 10, "  Z-ОТЧЁТЫ СМЕН (выручка)", 13, GREEN)
hrow(ws,11,["Смена","Выручка Zотч","Нал.факт","Эквайринг","Перевод","Онлайн","Иман","Выплата","Расхождение","Остаток","—","—","—"],GREEN,24)
for r,sn in enumerate([("День","Вечер","Ночь")],12):
    for ri,sname in enumerate(sn):
        row=12+ri
        ws.cell(row,1).value=sname; ws.cell(row,1).font=fnt(10,True); ws.cell(row,1).fill=F(LGRAY); ws.cell(row,1).border=brd(); ws.cell(row,1).alignment=CA()
        for ci in range(2,10):
            c=inp_cell(ws,row,ci,ci,money=True)
            ws.cell(row,ci).font=fnt(10,True,INDIGO)
        # Расхождение auto
        ws.cell(row,9).value=f"=IFERROR(C{row}-B{row},0)"
        ws.cell(row,9).font=fnt(10,True,RED); ws.cell(row,9).fill=F(RED_L)
        ws.cell(row,9).border=brd(); ws.cell(row,9).alignment=RA(); ws.cell(row,9).number_format=MONEY
        ws.row_dimensions[row].height=26

# Дополнительно
sec_hdr(ws, 16, "  ДОПОЛНИТЕЛЬНО", 13, AMBER)
for r,(lbl_,ci_start) in enumerate([("Закуп товара (сумма)",1),("Долг поставщику (новый)",1),("Иман (снято хозяином)",1)],17):
    lbl_cell(ws,r,1,4,lbl_)
    inp_cell(ws,r,5,9,money=True)
    ws.row_dimensions[r].height=26

# Итог
sec_hdr(ws, 21, "  ИТОГО ЗА ДЕНЬ", 13, NAVY)
ws.merge_cells("A22:D22"); ws.cell(22,1).value="Общая выручка по Z-отчётам:"; ws.cell(22,1).font=fnt(10); ws.cell(22,1).fill=F(LGRAY); ws.cell(22,1).border=brd(); ws.cell(22,1).alignment=LA()
calc_cell(ws,22,5,9,"=IFERROR(SUM(B12:B14),0)",col=GREEN,bg=GREEN_L)
ws.merge_cells("A23:D23"); ws.cell(23,1).value="Итого расхождений:"; ws.cell(23,1).font=fnt(10); ws.cell(23,1).fill=F(LGRAY); ws.cell(23,1).border=brd(); ws.cell(23,1).alignment=LA()
calc_cell(ws,23,5,9,"=IFERROR(SUM(I12:I14),0)",col=RED,bg=RED_L)
ws.merge_cells("A24:M24"); ws.cell(24,1).value="После заполнения нажмите кнопку  [СОХРАНИТЬ КАССУ]  (макрос VBA)"
ws.cell(24,1).font=fnt(10,it=True,col=BLUE); ws.cell(24,1).fill=F(BLUE_L); ws.cell(24,1).alignment=CA(); ws.row_dimensions[24].height=24

cw(ws,{"A":14,"B":14,"C":13,"D":14,"E":14,"F":12,"G":10,"H":12,"I":14,"J":12,"K":6,"L":6,"M":6})
ws.freeze_panes="A3"; ws.sheet_properties.tabColor="FF3B82F6"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ ВВОД_КАССА")

# ════════════════════════════════════════════════════════════
# 4. ВВОД_РАСХОДЫ
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_РАСХОДЫ"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД РАСХОДОВ — закуп, зарплата, прочие", "A1:J1", RED)
ws.merge_cells("A2:J2")
ws.cell(2,1).value="1. Выберите дату и кассира  2. Введите расходы по категориям  3. Нажмите СОХРАНИТЬ РАСХОДЫ"
ws.cell(2,1).font=fnt(10,it=True,col=RED); ws.cell(2,1).fill=F(RED_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

# Дата
sec_hdr(ws, 4, "  ДАТА И КАССИР", 10, INDIGO)
lbl_cell(ws,5,1,3,"Дата (ДД.ММ.ГГГГ)"); c=inp_cell(ws,5,4,6,money=False,fmt=DATE_F); c.value=today
lbl_cell(ws,5,7,8,"Кассир")
c=inp_cell(ws,5,9,10,money=False)
dv_k2=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$44:$A$79"); ws.add_data_validation(dv_k2); dv_k2.add(c)

# Расходы по категориям
sec_hdr(ws, 7, "  РАСХОДЫ ПО КАТЕГОРИЯМ", 10, RED)
hrow(ws,8,["Категория","Способ оплаты","Сумма","Комментарий","—","—","—","—","—","—"],RED,24)
dv_cat2=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$44:$C$55"); ws.add_data_validation(dv_cat2)
dv_pay2=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$49"); ws.add_data_validation(dv_pay2)
for r in range(9,25):
    alt=r%2==0
    ws.cell(r,1).fill=F(INP if not alt else LGRAY); ws.cell(r,1).border=brd(); ws.cell(r,1).font=fnt(10,True,INDIGO)
    ws.cell(r,1).alignment=LA(); ws.cell(r,1).protection=prot(False); dv_cat2.add(ws.cell(r,1))
    ws.cell(r,2).fill=F(INP if not alt else LGRAY); ws.cell(r,2).border=brd(); ws.cell(r,2).font=fnt(10,True,INDIGO)
    ws.cell(r,2).alignment=CA(); ws.cell(r,2).protection=prot(False); dv_pay2.add(ws.cell(r,2))
    ws.merge_cells(start_row=r,start_column=3,end_row=r,end_column=4)
    c=ws.cell(r,3); c.fill=F(INP); c.border=brd(); c.font=fnt(11,True,INDIGO)
    c.alignment=RA(); c.number_format=MONEY; c.protection=prot(False)
    ws.merge_cells(start_row=r,start_column=5,end_row=r,end_column=10)
    c=ws.cell(r,5); c.fill=F(LGRAY if alt else WHITE); c.border=brd(); c.font=fnt(10)
    c.alignment=LA(); c.protection=prot(False)
    ws.row_dimensions[r].height=24

# Итого
sec_hdr(ws, 26, "  ИТОГО РАСХОДОВ ЗА ДЕНЬ", 10, NAVY)
calc_cell(ws,27,1,4,"=IFERROR(SUM(C9:C24),0)",col=RED,bg=RED_L)
ws.merge_cells("E27:J27"); ws.cell(27,5).value="После заполнения нажмите  [СОХРАНИТЬ РАСХОДЫ]"
ws.cell(27,5).font=fnt(10,it=True,col=BLUE); ws.cell(27,5).fill=F(BLUE_L); ws.cell(27,5).alignment=CA()

cw(ws,{"A":22,"B":14,"C":16,"D":16,"E":20,"F":10,"G":10,"H":10,"I":10,"J":10})
ws.freeze_panes="A3"; ws.sheet_properties.tabColor="FFEF4444"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ ВВОД_РАСХОДЫ")

# ════════════════════════════════════════════════════════════
# 5. ЗАПИСЬ_НА_ВЫПЛАТУ
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ЗАПИСЬ_НА_ВЫПЛАТУ"); ws.sheet_view.showGridLines = False
banner(ws, "ЗАПИСЬ НА ВЫПЛАТУ — контроль задолженностей", "A1:J1", AMBER)
ws.merge_cells("A2:J2")
ws.cell(2,1).value="Внесите информацию о выплате поставщику или сотруднику. Нажмите СОХРАНИТЬ ВЫПЛАТУ."
ws.cell(2,1).font=fnt(10,it=True,col=AMBER); ws.cell(2,1).fill=F(AMBER_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

fields=[("Дата выплаты",4,"date"),("Получатель / Поставщик",4,"text"),("Тип выплаты",4,"paytype"),
        ("Сумма (₽)",4,"money"),("Способ оплаты",4,"payway"),("Комментарий",4,"text")]
for i,(lbl_,colspan,t) in enumerate(fields,4):
    lbl_cell(ws,i,1,3,lbl_)
    c=inp_cell(ws,i,4,3+colspan,money=(t=="money"))
    if t=="date": c.number_format=DATE_F; c.value=today
    if t=="paytype":
        dv=DataValidation(type="list",formula1='"Поставщик,Зарплата,Аренда,Налог,Прочее"')
        ws.add_data_validation(dv); dv.add(c)
    if t=="payway":
        dv=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$49")
        ws.add_data_validation(dv); dv.add(c)
    ws.row_dimensions[i].height=28

ws.merge_cells("A11:J11"); ws.cell(11,1).value="Нажмите  [СОХРАНИТЬ ВЫПЛАТУ]  для записи в базу"
ws.cell(11,1).font=fnt(11,True,AMBER); ws.cell(11,1).fill=F(AMBER_L); ws.cell(11,1).alignment=CA(); ws.row_dimensions[11].height=32

cw(ws,{"A":20,"B":12,"C":12,"D":14,"E":14,"F":12,"G":12,"H":12,"I":12,"J":12})
ws.sheet_properties.tabColor="FFF59E0B"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ ЗАПИСЬ_НА_ВЫПЛАТУ")

# ════════════════════════════════════════════════════════════
# 6. КАЛЕНДАРЬ_ВЫПЛАТ (умная таблица tblВыплаты)
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("КАЛЕНДАРЬ_ВЫПЛАТ"); ws.sheet_view.showGridLines = False
banner(ws, "КАЛЕНДАРЬ ВЫПЛАТ — план vs факт", "A1:H1", AMBER)
ws.merge_cells("A2:H2")
ws.cell(2,1).value="Умная таблица tblВыплаты. Фильтруйте по получателю, типу, статусу оплаты."
ws.cell(2,1).font=fnt(10,it=True,col=AMBER); ws.cell(2,1).fill=F(AMBER_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

hdrs_v=["Дата план","Получатель","Тип","Сумма план","Дата факт","Сумма факт","Статус","Комментарий"]
hrow(ws,3,hdrs_v,AMBER,28)
dv_st=DataValidation(type="list",formula1='"Ожидается,Оплачено,Просрочено,Частично"')
ws.add_data_validation(dv_st)
for r in range(4,1004):
    alt=r%2==0
    for ci in range(1,9):
        c=ws.cell(r,ci); c.border=brd(); c.fill=F(AMBER_L if alt else WHITE); c.font=fnt(10)
        c.alignment=CA() if ci in [3,7] else LA() if ci in [2,8] else RA() if ci in [4,6] else CA()
        c.protection=prot(False)
    ws.cell(r,1).number_format=DATE_F; ws.cell(r,4).number_format=MONEY
    ws.cell(r,5).number_format=DATE_F; ws.cell(r,6).number_format=MONEY
    dv_st.add(ws.cell(r,7)); ws.row_dimensions[r].height=20

for st,fill_,font_ in [("Оплачено",GREEN_L,GREEN),("Просрочено",RED_L,RED),("Частично",AMBER_L,AMBER)]:
    ws.conditional_formatting.add("G4:G1003",FormulaRule(formula=[f'$G4="{st}"'],fill=F(fill_),font=fnt(10,True,font_)))
ws.conditional_formatting.add("A4:A1003",FormulaRule(formula=['AND($G4="Ожидается",$A4<TODAY())'],fill=F(RED_L),font=fnt(10,True,RED)))

tbl_v=Table(displayName="tblВыплаты",ref="A3:H1003")
tbl_v.tableStyleInfo=TableStyleInfo(name="TableStyleMedium7",showRowStripes=True)
ws.add_table(tbl_v)
cw(ws,{"A":12,"B":22,"C":16,"D":14,"E":12,"F":14,"G":12,"H":28})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FFF59E0B"
print("✓ КАЛЕНДАРЬ_ВЫПЛАТ")

# ════════════════════════════════════════════════════════════
# 7. ДАННЫЕ (hidden sheet for chart data)
# ════════════════════════════════════════════════════════════
ws_d = wb.create_sheet("ДАННЫЕ"); ws_d.sheet_view.showGridLines = False
ws_d.sheet_state = "hidden"

# Monthly aggregates table (rows 2-14): header + 12 months
hrow(ws_d, 1, ["Месяц","Выручка","Расходы","Закуп","Прибыль","Долг"], NAVY, 20)
month_names_short = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]
for mi,mon in enumerate(month_names_short,1):
    r=mi+1; yr=today.year
    start_d=f"DATE({yr},{mi},1)"
    end_d=f"EOMONTH(DATE({yr},{mi},1),0)"
    ws_d.cell(r,1).value=mon
    ws_d.cell(r,2).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$D$4:$D$3003="Доход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,3).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$D$4:$D$3003="Расход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,4).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$E$4:$E$3003="Закуп товара")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,5).value=f"=B{r}-C{r}"
    ws_d.cell(r,6).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$D$4:$D$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003)'
    for ci in range(2,7): ws_d.cell(r,ci).number_format=MONEY
    ws_d.row_dimensions[r].height=18

# Shift data (rows 17-20): label + 3 shifts
hrow(ws_d, 16, ["Смена","Выручка","Записей"], NAVY, 20)
for si,(sname) in enumerate(["День","Вечер","Ночь"],1):
    r=16+si
    ws_d.cell(r,1).value=sname
    ws_d.cell(r,2).value=f'=SUMPRODUCT((БАЗА_ДДС!$B$4:$B$3003="{sname}")*(БАЗА_ДДС!$D$4:$D$3003="Доход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,3).value=f'=SUMPRODUCT((БАЗА_ДДС!$B$4:$B$3003="{sname}")*(БАЗА_ДДС!$D$4:$D$3003="Доход")*(БАЗА_ДДС!$G$4:$G$3003<>""))'
    ws_d.cell(r,2).number_format=MONEY; ws_d.row_dimensions[r].height=18

# Top expense categories (rows 24-35)
hrow(ws_d, 23, ["Категория","Сумма"], NAVY, 20)
exp_cats=["Закуп товара","Зарплата","Аренда","Коммунальные","Налог","ГСМ","Расходный материал","Маркетинг","Охрана","Прочие расходы"]
for ei,cat in enumerate(exp_cats,1):
    r=23+ei
    ws_d.cell(r,1).value=cat
    ws_d.cell(r,2).value=f'=SUMPRODUCT((БАЗА_ДДС!$E$4:$E$3003="{cat}")*(БАЗА_ДДС!$D$4:$D$3003="Расход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,2).number_format=MONEY; ws_d.row_dimensions[r].height=18

# Last 30 days (rows 38-68)
hrow(ws_d, 37, ["День","Выручка","Расходы"], NAVY, 20)
ws_d.cell(38,1).value="=TODAY()-29"; ws_d.cell(38,1).number_format=DATE_F
for i in range(1,30):
    ws_d.cell(38+i,1).value=f"=A{37+i}+1"; ws_d.cell(38+i,1).number_format=DATE_F
for r in range(38,68):
    ws_d.cell(r,2).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003=A{r})*(БАЗА_ДДС!$D$4:$D$3003="Доход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,3).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003=A{r})*(БАЗА_ДДС!$D$4:$D$3003="Расход")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,2).number_format=MONEY; ws_d.cell(r,3).number_format=MONEY; ws_d.row_dimensions[r].height=16

# Debt dynamics (rows 71-82): monthly debt totals
hrow(ws_d, 70, ["Месяц","Долг взят","Долг погашен","Баланс"], NAVY, 20)
for mi,mon in enumerate(month_names_short,1):
    r=70+mi; yr=today.year
    start_d=f"DATE({yr},{mi},1)"; end_d=f"EOMONTH(DATE({yr},{mi},1),0)"
    ws_d.cell(r,1).value=mon
    ws_d.cell(r,2).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$D$4:$D$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,3).value=f'=SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=({start_d}))*(БАЗА_ДДС!$A$4:$A$3003<=({end_d}))*(БАЗА_ДДС!$D$4:$D$3003="Оплата долга")*БАЗА_ДДС!$G$4:$G$3003)'
    ws_d.cell(r,4).value=f"=B{r}-C{r}"
    for ci in range(2,5): ws_d.cell(r,ci).number_format=MONEY
    ws_d.row_dimensions[r].height=16

cw(ws_d,{"A":14,"B":16,"C":16,"D":16,"E":16,"F":16})
print("✓ ДАННЫЕ (hidden)")

# ════════════════════════════════════════════════════════════
# 8. ДАШБОРД — main dashboard with 26 KPIs + 6 charts
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ДАШБОРД"); ws.sheet_view.showGridLines = False
ws.sheet_view.zoomScale = 90

# Row 1: Banner
banner(ws, "WAY MARKET — ДАШБОРД УПРАВЛЕНЧЕСКОГО УЧЁТА", "A1:L1", NAVY, 16)

# Row 2: Store info
ws.merge_cells("A2:E2")
ws.cell(2,1).value='=НАСТРОЙКИ!E5&"  |  Данные с: "&TEXT(НАСТРОЙКИ!E6,"DD.MM.YYYY")'
ws.cell(2,1).font=fnt(11,False,GRAY); ws.cell(2,1).fill=F(LGRAY); ws.cell(2,1).alignment=LA()
ws.merge_cells("F2:L2")
ws.cell(2,6).value='="Всего записей: "&COUNTA(БАЗА_ДДС!$A$4:$A$3003)&"  |  Последнее обновление: "&TEXT(NOW(),"DD.MM.YYYY HH:MM")'
ws.cell(2,6).font=fnt(10,False,GRAY); ws.cell(2,6).fill=F(LGRAY); ws.cell(2,6).alignment=RA()
ws.row_dimensions[2].height=24

# Row 3: spacer
ws.row_dimensions[3].height=6

# Row 4: Filter bar
ws.merge_cells("A4:A4")
ws.cell(4,1).value="ПЕРИОД:"; ws.cell(4,1).font=fnt(10,True,"FFFFFFFF"); ws.cell(4,1).fill=F(INDIGO); ws.cell(4,1).alignment=CA()

# B4: Month dropdown
ws.merge_cells("B4:C4")
c_month = ws.cell(4,2); c_month.value = MONTHS_RU[today.month-1]
c_month.font=fnt(12,True,INDIGO); c_month.fill=F(INP); c_month.border=brd_med(); c_month.alignment=CA()
c_month.protection=prot(False)
dv_mon_dash=DataValidation(type="list",formula1='"Январь,Февраль,Март,Апрель,Май,Июнь,Июль,Август,Сентябрь,Октябрь,Ноябрь,Декабрь"')
ws.add_data_validation(dv_mon_dash); dv_mon_dash.add("B4:C4")

ws.cell(4,4).value="ГОД:"; ws.cell(4,4).font=fnt(10,True,"FFFFFFFF"); ws.cell(4,4).fill=F(INDIGO); ws.cell(4,4).alignment=CA()

# E4: Year dropdown
ws.merge_cells("E4:F4")
c_year = ws.cell(4,5); c_year.value = today.year
c_year.font=fnt(12,True,INDIGO); c_year.fill=F(INP); c_year.border=brd_med(); c_year.alignment=CA()
c_year.protection=prot(False)
dv_yr_dash=DataValidation(type="list",formula1='"2024,2025,2026,2027,2028"')
ws.add_data_validation(dv_yr_dash); dv_yr_dash.add("E4:F4")

# Period info
ws.merge_cells("G4:I4")
ws.cell(4,7).value='=TEXT(A5,"DD.MM.YYYY")&" — "&TEXT(B5,"DD.MM.YYYY")'
ws.cell(4,7).font=fnt(10,False,GRAY); ws.cell(4,7).fill=F(LGRAY); ws.cell(4,7).alignment=CA()

# Tip
ws.merge_cells("J4:L4")
ws.cell(4,10).value='[ОБНОВИТЬ] — кнопка VBA  |  Ctrl+Shift+D'
ws.cell(4,10).font=fnt(9,it=True,col=GRAY); ws.cell(4,10).fill=F(LGRAY); ws.cell(4,10).alignment=CA()
ws.row_dimensions[4].height=32

# Row 5: Hidden helper date cells
ws.row_dimensions[5].height=0  # hide by setting height to 0

# A5: period start
ws.cell(5,1).value='=DATE($E$4,MATCH($B$4,{"Январь";"Февраль";"Март";"Апрель";"Май";"Июнь";"Июль";"Август";"Сентябрь";"Октябрь";"Ноябрь";"Декабрь"},0),1)'
ws.cell(5,1).number_format=DATE_F
# B5: period end
ws.cell(5,2).value='=EOMONTH($A$5,0)'
ws.cell(5,2).number_format=DATE_F
# C5: prev period start
ws.cell(5,3).value='=EOMONTH($A$5,-2)+1'
ws.cell(5,3).number_format=DATE_F
# D5: prev period end
ws.cell(5,4).value='=EOMONTH($A$5,-1)'
ws.cell(5,4).number_format=DATE_F

# Row 6: spacer
ws.merge_cells("A6:L6")
ws.cell(6,1).value="  ОСНОВНЫЕ ПОКАЗАТЕЛИ"
ws.cell(6,1).font=fnt(10,True,"FFFFFFFF"); ws.cell(6,1).fill=F(NAVY); ws.cell(6,1).alignment=LA()
ws.row_dimensions[6].height=22

# ── KPI Layout: 12 columns (A-L), 3 cols per card = 4 cards per row ──────────
# Each block: row N=section header, rows N+1,N+2 = KPI cards (label+value)

def dash_section(ws, row, title, bg):
    ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=12)
    c=ws.cell(row,1); c.value=title
    c.font=fnt(10,True,"FFFFFFFF"); c.fill=F(bg); c.alignment=LA()
    ws.row_dimensions[row].height=20

def kpi_block(ws, label_row, val_row, cards, bg_hdr=LGRAY, bg_val=WHITE, val_col=NAVY):
    """cards = [(label, val_formula, prev_formula, money_fmt), ...] up to 4"""
    ncards=len(cards); cols_per=12//max(ncards,1)
    for i,(label,val_f,prev_f,mfmt) in enumerate(cards):
        c1=i*cols_per+1; c2=c1+cols_per-1
        if i==ncards-1: c2=12  # last card takes remaining space
        trend_col=c2  # trend in last cell of merge
        val_c2=c2-1 if ncards>1 else c2

        # Label row
        ws.merge_cells(start_row=label_row,start_column=c1,end_row=label_row,end_column=c2)
        lc=ws.cell(label_row,c1); lc.value=label
        lc.font=fnt(9,False,GRAY); lc.fill=F(bg_hdr); lc.border=brd(); lc.alignment=CA()
        ws.row_dimensions[label_row].height=20

        # Value row
        ws.merge_cells(start_row=val_row,start_column=c1,end_row=val_row,end_column=val_c2)
        vc=ws.cell(val_row,c1); vc.value=val_f
        vc.font=fnt(16,True,val_col); vc.fill=F(bg_val); vc.border=brd(); vc.alignment=CA(wrap=False)
        if mfmt: vc.number_format=MONEY

        # Trend cell
        tc=ws.cell(val_row,c2)
        if prev_f and val_f:
            # Formula: ▲ if current > prev
            vref=val_f.lstrip("=") if val_f.startswith("=") else val_f
            pref=prev_f.lstrip("=") if prev_f.startswith("=") else prev_f
            tc.value=f'=IF(({vref})>({pref}),"▲","▼")'
            tc.font=fnt(12,True,GREEN)
        else:
            tc.value=""
        tc.fill=F(bg_val); tc.border=brd(); tc.alignment=CA()

        # Conditional formatting on trend cell
        addr_t=f"{get_column_letter(c2)}{val_row}"
        ws.conditional_formatting.add(addr_t,FormulaRule(formula=[f'{addr_t}="▲"'],font=fnt(12,True,GREEN)))
        ws.conditional_formatting.add(addr_t,FormulaRule(formula=[f'{addr_t}="▼"'],font=fnt(12,True,RED)))

        ws.row_dimensions[val_row].height=38

# Helper SUMIFS fragments using hidden row 5 dates
def sumifs_periodo(tipo=None, cat=None, pay=None, fld="$G$4:$G$3003"):
    """Returns formula fragment for current period"""
    base=f"БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)"
    conds=[base]
    if tipo: conds.append(f'(БАЗА_ДДС!$D$4:$D$3003="{tipo}")')
    if cat: conds.append(f'(БАЗА_ДДС!$E$4:$E$3003="{cat}")')
    if pay: conds.append(f'(БАЗА_ДДС!$F$4:$F$3003="{pay}")')
    return "=IFERROR(SUMPRODUCT(("+")*(".join(conds)+f")*БАЗА_ДДС!{fld}),0)"

def sumifs_prev(tipo=None, cat=None, pay=None, fld="$G$4:$G$3003"):
    """Returns formula fragment for previous period"""
    base=f"БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)"
    conds=[base]
    if tipo: conds.append(f'(БАЗА_ДДС!$D$4:$D$3003="{tipo}")')
    if cat: conds.append(f'(БАЗА_ДДС!$E$4:$E$3003="{cat}")')
    if pay: conds.append(f'(БАЗА_ДДС!$F$4:$F$3003="{pay}")')
    return "=IFERROR(SUMPRODUCT(("+")*(".join(conds)+f")*БАЗА_ДДС!{fld}),0)"

def countifs_periodo(tipo=None):
    base=f"БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)"
    conds=[base]
    if tipo: conds.append(f'(БАЗА_ДДС!$D$4:$D$3003="{tipo}")')
    conds.append(f'(БАЗА_ДДС!$G$4:$G$3003<>"")')
    return "=IFERROR(SUMPRODUCT(("+")*(".join(conds)+")*(1)),0)"

# Revenues
v_выручка = sumifs_periodo("Доход")
p_выручка = sumifs_prev("Доход")

v_days = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$D$4:$D$3003="Доход")*(БАЗА_ДДС!$G$4:$G$3003<>"")*(1/COUNTIFS(БАЗА_ДДС!$A$4:$A$3003,БАЗА_ДДС!$A$4:$A$3003,БАЗА_ДДС!$D$4:$D$3003,"Доход"))),0)'
p_days = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Доход")*(БАЗА_ДДС!$G$4:$G$3003<>"")*(1/COUNTIFS(БАЗА_ДДС!$A$4:$A$3003,БАЗА_ДДС!$A$4:$A$3003,БАЗА_ДДС!$D$4:$D$3003,"Доход"))),0)'
v_выр_день = f'=IFERROR(({v_выручка[1:]})/MAX(1,{v_days[1:]}),0)'
p_выр_день = f'=IFERROR(({p_выручка[1:]})/MAX(1,{p_days[1:]}),0)'

cnt_smeny = countifs_periodo("Доход")
v_выр_смену = f'=IFERROR(({v_выручка[1:]})/MAX(1,{cnt_smeny[1:]}),0)'
p_cnt_smeny = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Доход")*(БАЗА_ДДС!$G$4:$G$3003<>"")*(1)),0)'
p_выр_смену = f'=IFERROR(({p_выручка[1:]})/MAX(1,{p_cnt_smeny[1:]}),0)'

v_макс_день = '=IFERROR(MAXIFS(БАЗА_ДДС!$G$4:$G$3003,БАЗА_ДДС!$A$4:$A$3003,">="&$A$5,БАЗА_ДДС!$A$4:$A$3003,"<="&$B$5,БАЗА_ДДС!$D$4:$D$3003,"Доход"),0)'
p_макс_день = '=IFERROR(MAXIFS(БАЗА_ДДС!$G$4:$G$3003,БАЗА_ДДС!$A$4:$A$3003,">="&$C$5,БАЗА_ДДС!$A$4:$A$3003,"<="&$D$5,БАЗА_ДДС!$D$4:$D$3003,"Доход"),0)'

# Cash control
v_выплаты = sumifs_periodo("Расход", "Выплата с кассы")
p_выплаты = sumifs_prev("Расход", "Выплата с кассы")
v_расх = sumifs_periodo("Расхождение")
p_расх = sumifs_prev("Расхождение")
v_расх_кол = countifs_periodo("Расхождение")
p_расх_кол = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Расхождение")*(БАЗА_ДДС!$G$4:$G$3003<>"")*(1)),0)'
v_kasса_ост = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$D$4:$D$3003="Касса")*БАЗА_ДДС!$G$4:$G$3003),0)'
p_kasса_ост = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Касса")*БАЗА_ДДС!$G$4:$G$3003),0)'

# Debt
v_долг_тек = '=IFERROR(НАСТРОЙКИ!E9+SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$D$4:$D$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003)-SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$D$4:$D$3003="Оплата долга")*БАЗА_ДДС!$G$4:$G$3003),0)'
p_долг_тек = '=IFERROR(НАСТРОЙКИ!E9+SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003)-SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$D$4:$D$3003="Оплата долга")*БАЗА_ДДС!$G$4:$G$3003),0)'
v_долг_взят = sumifs_periodo("Долг")
p_долг_взят = sumifs_prev("Долг")
v_долг_выпл = sumifs_periodo("Оплата долга")
k_oplate = f'=IFERROR(({v_долг_тек[1:]}),0)'

# Profit
v_закуп = sumifs_periodo("Расход", "Закуп товара")
p_закуп = sumifs_prev("Расход", "Закуп товара")
v_расходы = sumifs_periodo("Расход")
p_расходы = sumifs_prev("Расход")
v_прибыль = f'=IFERROR(({v_выручка[1:]})-({v_расходы[1:]}),0)'
p_прибыль = f'=IFERROR(({p_выручка[1:]})-({p_расходы[1:]}),0)'
v_рент = f'=IFERROR(({v_прибыль[1:]})/MAX(1,({v_выручка[1:]}))*100,0)'
p_рент = f'=IFERROR(({p_прибыль[1:]})/MAX(1,({p_выручка[1:]}))*100,0)'

# Efficiency
v_маржа = f'=IFERROR((({v_выручка[1:]})-({v_закуп[1:]}))/MAX(1,({v_выручка[1:]}))*100,0)'
p_маржа = f'=IFERROR((({p_выручка[1:]})-({p_закуп[1:]}))/MAX(1,({p_выручка[1:]}))*100,0)'
v_эфф_закупа = f'=IFERROR(({v_выручка[1:]})/MAX(1,({v_закуп[1:]})),0)'
p_эфф_закупа = f'=IFERROR(({p_выручка[1:]})/MAX(1,({p_закуп[1:]})),0)'
v_нагр_долга = f'=IFERROR(({v_долг_тек[1:]})/MAX(1,({v_выручка[1:]}))*100,0)'
p_нагр_долга = f'=IFERROR(({p_долг_тек[1:]})/MAX(1,({p_выручка[1:]}))*100,0)'
v_ср_расх_день = f'=IFERROR(({v_расходы[1:]})/MAX(1,({v_days[1:]})),0)'
p_ср_расх_день = f'=IFERROR(({p_расходы[1:]})/MAX(1,{p_days[1:]}),0)'

# Operations
v_просроч = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$A$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$B$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$G$4:$G$1003="Просрочено")*КАЛЕНДАРЬ_ВЫПЛАТ!$D$4:$D$1003),0)'
p_просроч = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$C$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$D$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$G$4:$G$1003="Просрочено")*КАЛЕНДАРЬ_ВЫПЛАТ!$D$4:$D$1003),0)'
v_просроч_кол = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$A$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$B$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$G$4:$G$1003="Просрочено")*(КАЛЕНДАРЬ_ВЫПЛАТ!$D$4:$D$1003<>"")*(1)),0)'
p_просроч_кол = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$C$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$D$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$G$4:$G$1003="Просрочено")*(КАЛЕНДАРЬ_ВЫПЛАТ!$D$4:$D$1003<>"")*(1)),0)'
v_vypl_plan = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$A$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$B$5)*КАЛЕНДАРЬ_ВЫПЛАТ!$D$4:$D$1003),0)'
v_vypl_fakt = '=IFERROR(SUMPRODUCT((КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003>=$A$5)*(КАЛЕНДАРЬ_ВЫПЛАТ!$A$4:$A$1003<=$B$5)*КАЛЕНДАРЬ_ВЫПЛАТ!$F$4:$F$1003),0)'
v_vypl_pct = f'=IFERROR(({v_vypl_fakt[1:]})/MAX(1,({v_vypl_plan[1:]}))*100,0)'
p_vypl_pct = '=50'  # placeholder for previous
v_zakup_dolg = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$E$4:$E$3003="Закуп товара")*(БАЗА_ДДС!$F$4:$F$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003),0)'
p_zakup_dolg = '=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$C$5)*(БАЗА_ДДС!$A$4:$A$3003<=$D$5)*(БАЗА_ДДС!$E$4:$E$3003="Закуп товара")*(БАЗА_ДДС!$F$4:$F$3003="Долг")*БАЗА_ДДС!$G$4:$G$3003),0)'
v_zakup_dolg_pct = f'=IFERROR(({v_zakup_dolg[1:]})/MAX(1,({v_закуп[1:]}))*100,0)'

# Statistics
v_дней = v_days
v_записей = countifs_periodo("Доход")
v_макс = v_макс_день
v_мин = '=IFERROR(MINIFS(БАЗА_ДДС!$G$4:$G$3003,БАЗА_ДДС!$A$4:$A$3003,">="&$A$5,БАЗА_ДДС!$A$4:$A$3003,"<="&$B$5,БАЗА_ДДС!$D$4:$D$3003,"Доход"),0)'
v_иман = sumifs_periodo("Иман")
p_иман = sumifs_prev("Иман")
v_списания = sumifs_periodo("Списание")
p_списания = sumifs_prev("Списание")

# ── KPI Blocks ────────────────────────────────────────────────────────────────
row = 7

dash_section(ws, row, "  ВЫРУЧКА", BLUE); row+=1
kpi_block(ws, row, row+1, [
    ("Общая выручка", v_выручка, p_выручка, True),
    ("Среднее в день",v_выр_день, p_выр_день, True),
    ("Среднее за смену", v_выр_смену, p_выр_смену, True),
    ("Лучший день", v_макс_день, p_макс_день, True),
], BLUE_L, WHITE, BLUE); row+=2

dash_section(ws, row, "  КОНТРОЛЬ КАССЫ", TEAL); row+=1
kpi_block(ws, row, row+1, [
    ("Выплаты из кассы", v_выплаты, p_выплаты, True),
    ("Расхождений сумма", v_расх, p_расх, True),
    ("Кол-во расхождений", v_расх_кол, p_расх_кол, False),
    ("Остаток кассы", v_kasса_ост, p_kasса_ост, True),
], TEAL_L, WHITE, TEAL); row+=2

dash_section(ws, row, "  ДОЛГИ И ОБЯЗАТЕЛЬСТВА", RED); row+=1
kpi_block(ws, row, row+1, [
    ("Текущий долг", v_долг_тек, p_долг_тек, True),
    ("Взято в долг", v_долг_взят, p_долг_взят, True),
    ("Выплачено долгов", v_долг_выпл, p_долг_тек, True),
    ("К оплате (=долг)", k_oplate, p_долг_тек, True),
], RED_L, WHITE, RED); row+=2

dash_section(ws, row, "  ПРИБЫЛЬ", GREEN); row+=1
kpi_block(ws, row, row+1, [
    ("Закуп товара", v_закуп, p_закуп, True),
    ("Все расходы", v_расходы, p_расходы, True),
    ("Чистая прибыль", v_прибыль, p_прибыль, True),
    ("Рентабельность %", v_рент, p_рент, False),
], GREEN_L, WHITE, GREEN); row+=2

dash_section(ws, row, "  ЭФФЕКТИВНОСТЬ", PURPLE); row+=1
kpi_block(ws, row, row+1, [
    ("Маржа %", v_маржа, p_маржа, False),
    ("Эффект. закупа (x)", v_эфф_закупа, p_эфф_закупа, False),
    ("Нагрузка долга %", v_нагр_долга, p_нагр_долга, False),
    ("Ср. расход/день", v_ср_расх_день, p_ср_расх_день, True),
], PURP_L, WHITE, PURPLE); row+=2

dash_section(ws, row, "  ОПЕРАЦИИ И ВЫПЛАТЫ", AMBER); row+=1
kpi_block(ws, row, row+1, [
    ("Просроч. выплаты", v_просроч, p_просроч, True),
    ("Просроч. кол-во", v_просроч_кол, p_просроч_кол, False),
    ("Выплачено %", v_vypl_pct, p_vypl_pct, False),
    ("Закуп в долг %", v_zakup_dolg_pct, p_vypl_pct, False),
], AMBER_L, WHITE, AMBER); row+=2

dash_section(ws, row, "  СТАТИСТИКА ПЕРИОДА", GRAY); row+=1
kpi_block(ws, row, row+1, [
    ("Дней с данными", v_дней, None, False),
    ("Всего операций", v_записей, None, False),
    ("Макс. выручка/день", v_макс, v_мин, True),
    ("Мин. выручка/день", v_мин, None, True),
], LGRAY, WHITE, NAVY); row+=2

# Second statistics row
kpi_block(ws, row, row+1, [
    ("Иман (хозяин)", v_иман, p_иман, True),
    ("Списания+Возвраты", v_списания, p_списания, True),
    ("", "=0", None, False),
    ("", "=0", None, False),
], LGRAY, WHITE, NAVY); row+=2

# Row spacer
ws.merge_cells(f"A{row}:L{row}")
ws.cell(row,1).fill=F(LGRAY); ws.row_dimensions[row].height=10; row+=1

# ── Expense Detail Section ─────────────────────────────────────────────────────
dash_section(ws, row, "  ДЕТАЛИЗАЦИЯ РАСХОДОВ ЗА ПЕРИОД", INDIGO); row+=1
hrow(ws, row, ["Категория","Сумма","Доля %","Гистограмма","—","—","—","—","—","—","—","—"], INDIGO, 22); row+=1

exp_cats_list=["Закуп товара","Зарплата","Аренда","Коммунальные","Налог","ГСМ","Расходный материал","Маркетинг","Охрана","Прочие расходы"]
exp_start_row=row
for ei,cat in enumerate(exp_cats_list):
    bg=LGRAY if ei%2==0 else WHITE
    ws.cell(row,1).value=cat; ws.cell(row,1).font=fnt(10); ws.cell(row,1).fill=F(bg); ws.cell(row,1).border=brd(); ws.cell(row,1).alignment=LA()
    sf=f'=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$E$4:$E$3003="{cat}")*БАЗА_ДДС!$G$4:$G$3003),0)'
    ws.cell(row,2).value=sf; ws.cell(row,2).font=fnt(10,True,RED if ei==0 else NAVY); ws.cell(row,2).fill=F(bg); ws.cell(row,2).border=brd(); ws.cell(row,2).alignment=RA(); ws.cell(row,2).number_format=MONEY
    pct_f=f'=IFERROR(B{row}/{v_расходы[1:]}*100,0)'
    ws.cell(row,3).value=pct_f; ws.cell(row,3).font=fnt(9,False,GRAY); ws.cell(row,3).fill=F(bg); ws.cell(row,3).border=brd(); ws.cell(row,3).alignment=CA(); ws.cell(row,3).number_format="0.0%"
    ws.merge_cells(start_row=row,start_column=4,end_row=row,end_column=12)
    bar_f=f'=IFERROR(REPT("|",MAX(1,INT(B{row}/MAX($B${exp_start_row}:$B${exp_start_row+9})*20))),"")'
    ws.cell(row,4).value=bar_f; ws.cell(row,4).font=Font(name="Calibri",size=9,color=INDIGO); ws.cell(row,4).fill=F(BLUE_L if ei%2==0 else WHITE); ws.cell(row,4).border=brd(); ws.cell(row,4).alignment=LA()
    ws.row_dimensions[row].height=22; row+=1

ws.merge_cells(f"A{row}:L{row}")
ws.cell(row,1).fill=F(LGRAY); ws.row_dimensions[row].height=8; row+=1

# ── Charts Section ─────────────────────────────────────────────────────────────
charts_start_row = row

dash_section(ws, row, "  ГРАФИКИ И ДИАГРАММЫ", NAVY); row+=1

# Chart 1: Выручка по месяцам (Line)
chart1 = LineChart()
chart1.title = "Выручка по месяцам"
chart1.style = 10; chart1.height = 10; chart1.width = 16
data1 = Reference(ws_d, min_col=2, max_col=2, min_row=1, max_row=13)
cats1 = Reference(ws_d, min_col=1, min_row=2, max_row=13)
chart1.add_data(data1, titles_from_data=True)
chart1.set_categories(cats1)
chart1.series[0].graphicalProperties.line.solidFill = "3B82F6"
chart1.series[0].graphicalProperties.line.width = 20000
ws.add_chart(chart1, f"A{row}")

# Chart 2: Выручка по сменам (Bar)
chart2 = BarChart()
chart2.title = "Выручка по сменам"
chart2.style = 10; chart2.height = 10; chart2.width = 14
chart2.type = "col"
data2 = Reference(ws_d, min_col=2, max_col=2, min_row=16, max_row=19)
cats2 = Reference(ws_d, min_col=1, min_row=17, max_row=19)
chart2.add_data(data2, titles_from_data=True)
chart2.set_categories(cats2)
chart2.series[0].graphicalProperties.solidFill = "10B981"
ws.add_chart(chart2, f"G{row}")

row += 20

# Chart 3: Структура расходов (Pie)
chart3 = PieChart()
chart3.title = "Структура расходов"
chart3.style = 10; chart3.height = 10; chart3.width = 16
data3 = Reference(ws_d, min_col=2, min_row=23, max_row=33)
cats3 = Reference(ws_d, min_col=1, min_row=24, max_row=33)
chart3.add_data(data3, titles_from_data=False)
chart3.set_categories(cats3)
ws.add_chart(chart3, f"A{row}")

# Chart 4: ТОП расходов (Bar horizontal)
chart4 = BarChart()
chart4.title = "ТОП категорий расходов"
chart4.style = 10; chart4.height = 10; chart4.width = 14
chart4.type = "bar"  # horizontal
data4 = Reference(ws_d, min_col=2, min_row=23, max_row=33)
cats4 = Reference(ws_d, min_col=1, min_row=24, max_row=33)
chart4.add_data(data4, titles_from_data=False)
chart4.set_categories(cats4)
chart4.series[0].graphicalProperties.solidFill = "EF4444"
ws.add_chart(chart4, f"G{row}")

row += 20

# Chart 5: Последние 30 дней (Line)
chart5 = LineChart()
chart5.title = "Выручка за последние 30 дней"
chart5.style = 10; chart5.height = 10; chart5.width = 16
data5 = Reference(ws_d, min_col=2, max_col=3, min_row=37, max_row=67)
chart5.add_data(data5, titles_from_data=True)
chart5.series[0].graphicalProperties.line.solidFill = "3B82F6"
chart5.series[1].graphicalProperties.line.solidFill = "EF4444"
ws.add_chart(chart5, f"A{row}")

# Chart 6: Динамика долга (Line 2 series)
chart6 = LineChart()
chart6.title = "Динамика долга по месяцам"
chart6.style = 10; chart6.height = 10; chart6.width = 14
data6 = Reference(ws_d, min_col=2, max_col=3, min_row=70, max_row=82)
cats6 = Reference(ws_d, min_col=1, min_row=71, max_row=82)
chart6.add_data(data6, titles_from_data=True)
chart6.set_categories(cats6)
chart6.series[0].graphicalProperties.line.solidFill = "F59E0B"
chart6.series[1].graphicalProperties.line.solidFill = "10B981"
ws.add_chart(chart6, f"G{row}")

cw(ws,{"A":10,"B":10,"C":10,"D":10,"E":10,"F":10,"G":10,"H":10,"I":10,"J":10,"K":10,"L":10})
ws.freeze_panes="A7"
ws.sheet_properties.tabColor="FF4F46E5"
ws.protection.sheet = True; ws.protection.password = ""
print("✓ ДАШБОРД")

# ════════════════════════════════════════════════════════════
# 9. ОТЧЁТ_РУКОВОДИТЕЛЮ
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ОТЧЁТ_РУКОВОДИТЕЛЮ"); ws.sheet_view.showGridLines = False
banner(ws, "ОТЧЁТ РУКОВОДИТЕЛЮ — сводные данные за месяц", "A1:J1", NAVY)
ws.merge_cells("A2:J2")
ws.cell(2,1).value=f'=НАСТРОЙКИ!E5&" | "&TEXT(TODAY(),"MMMM YYYY")'
ws.cell(2,1).font=fnt(12,True,NAVY); ws.cell(2,1).fill=F(LGRAY); ws.cell(2,1).alignment=LA(); ws.row_dimensions[2].height=26

sec_hdr(ws, 4, "  ВЫРУЧКА И ПРИБЫЛЬ", 10, BLUE)
rpt_rows=[
    ("Общая выручка за месяц", v_выручка),
    ("Расходы за месяц", v_расходы),
    ("Чистая прибыль", v_прибыль),
    ("Рентабельность %", v_рент),
    ("Маржа %", v_маржа),
]
for i,(lbl_,f_) in enumerate(rpt_rows,5):
    lbl_cell(ws,i,1,5,lbl_)
    calc_cell(ws,i,6,10,f_,col=GREEN if i!=6 else RED,bg=GREEN_L if i!=6 else RED_L)
    ws.row_dimensions[i].height=26

sec_hdr(ws, 11, "  ДОЛГИ И ВЫПЛАТЫ", 10, AMBER)
debt_rows=[
    ("Текущий долг", v_долг_тек),
    ("Взято в долг за месяц", v_долг_взят),
    ("Выплачено за месяц", v_долг_выпл),
    ("Просроченные выплаты", v_просроч),
]
for i,(lbl_,f_) in enumerate(debt_rows,12):
    lbl_cell(ws,i,1,5,lbl_)
    calc_cell(ws,i,6,10,f_,col=RED,bg=RED_L)
    ws.row_dimensions[i].height=26

sec_hdr(ws, 17, "  ТОП РАСХОДОВ", 10, RED)
for i,cat in enumerate(exp_cats_list[:5],18):
    lbl_cell(ws,i,1,5,cat)
    f_=f'=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=$B$5)*(БАЗА_ДДС!$E$4:$E$3003="{cat}")*БАЗА_ДДС!$G$4:$G$3003),0)'
    # Note: references $A$5 and $B$5 which are on ДАШБОРД sheet - use ДАШБОРД!$A$5
    f_rpt=f'=IFERROR(SUMPRODUCT((БАЗА_ДДС!$A$4:$A$3003>=ДАШБОРД!$A$5)*(БАЗА_ДДС!$A$4:$A$3003<=ДАШБОРД!$B$5)*(БАЗА_ДДС!$E$4:$E$3003="{cat}")*БАЗА_ДДС!$G$4:$G$3003),0)'
    calc_cell(ws,i,6,10,f_rpt,col=RED,bg=RED_L)
    ws.row_dimensions[i].height=26

ws.merge_cells("A24:J24")
ws.cell(24,1).value="Для экспорта в PDF нажмите  [ЭКСПОРТ PDF]  (макрос VBA)"
ws.cell(24,1).font=fnt(11,True,INDIGO); ws.cell(24,1).fill=F(BLUE_L); ws.cell(24,1).alignment=CA(); ws.row_dimensions[24].height=32

# Sync filter cells from ДАШБОРД
ws.cell(3,1).value="=ДАШБОРД!$B$4"; ws.cell(3,2).value="=ДАШБОРД!$E$4"
ws.row_dimensions[3].height=0  # hide

cw(ws,{"A":22,"B":14,"C":14,"D":14,"E":14,"F":16,"G":16,"H":14,"I":14,"J":14})
ws.sheet_properties.tabColor="FF111827"
print("✓ ОТЧЁТ_РУКОВОДИТЕЛЮ")

# ════════════════════════════════════════════════════════════
# 10. ИНСТРУКЦИЯ
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ИНСТРУКЦИЯ"); ws.sheet_view.showGridLines = False
banner(ws, "WAY MARKET v9 — ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ", "A1:J1", INDIGO, 14)

steps=[
    ("1. НАСТРОЙКИ", INDIGO,
     ["Откройте лист НАСТРОЙКИ",
      "Введите название магазина, дату начала учёта, начальный долг",
      "Настройте смены (ДЕНЬ/ВЕЧЕР/НОЧЬ)",
      "Заполните справочник кассиров в столбце A (строки 44-79)",
      "Добавьте категории расходов в столбец C при необходимости"]),
    ("2. ЕЖЕДНЕВНЫЙ ВВОД ДАННЫХ", BLUE,
     ["Лист ВВОД_КАССА: выберите дату, кассира, введите Z-отчёты смен",
      "Нажмите кнопку СОХРАНИТЬ КАССУ (или Alt+F8 → СохранитьКассу)",
      "Лист ВВОД_РАСХОДЫ: укажите дату и кассира, введите расходы по категориям",
      "Нажмите СОХРАНИТЬ РАСХОДЫ для записи в базу",
      "Данные сохраняются в БАЗА_ДДС автоматически"]),
    ("3. ВЫПЛАТЫ ПОСТАВЩИКАМ", AMBER,
     ["Лист ЗАПИСЬ_НА_ВЫПЛАТУ: заполните получателя, сумму, способ оплаты",
      "Нажмите СОХРАНИТЬ ВЫПЛАТУ",
      "Контролируйте статусы в листе КАЛЕНДАРЬ_ВЫПЛАТ",
      "Просроченные выплаты подсвечиваются красным автоматически"]),
    ("4. ДАШБОРД", GREEN,
     ["Лист ДАШБОРД: выберите месяц и год в фильтре (строка 4)",
      "Все 26 показателей пересчитаются автоматически",
      "Стрелки ▲▼ показывают динамику vs предыдущий месяц",
      "Нажмите ОБНОВИТЬ для принудительного пересчёта"]),
    ("5. ОТЧЁТ РУКОВОДИТЕЛЮ", PURPLE,
     ["Лист ОТЧЁТ_РУКОВОДИТЕЛЮ: сводные данные за текущий период",
      "Нажмите ЭКСПОРТ PDF для сохранения отчёта",
      "Отчёт синхронизирован с фильтром дашборда"]),
]

r=3
for title,bg,items in steps:
    sec_hdr(ws, r, f"  {title}", 10, bg); r+=1
    for item in items:
        ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=10)
        c=ws.cell(r,1); c.value=f"• {item}"
        c.font=fnt(10); c.fill=F(LGRAY if r%2==0 else WHITE); c.border=brd(); c.alignment=LA()
        ws.row_dimensions[r].height=22; r+=1
    ws.row_dimensions[r].height=8; r+=1

ws.merge_cells(f"A{r}:J{r}")
ws.cell(r,1).value="Горячие клавиши: Ctrl+Shift+S — Сохранить кассу | Ctrl+Shift+R — Сохранить расходы | Ctrl+Shift+D — Обновить дашборд"
ws.cell(r,1).font=fnt(10,True,INDIGO); ws.cell(r,1).fill=F(BLUE_L); ws.cell(r,1).alignment=CA(); ws.row_dimensions[r].height=30

cw(ws,{"A":30,"B":16,"C":14,"D":14,"E":14,"F":14,"G":14,"H":14,"I":14,"J":14})
ws.sheet_properties.tabColor="FF4F46E5"
print("✓ ИНСТРУКЦИЯ")

# ════════════════════════════════════════════════════════════
# 11. КАК_СДЕЛАТЬ_ДАШБОРД
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("КАК_СДЕЛАТЬ_ДАШБОРД"); ws.sheet_view.showGridLines = False
banner(ws, "КАК ПОДКЛЮЧИТЬ МАКРОСЫ VBA", "A1:J1", PURPLE, 14)

steps2=[
    "1. Откройте Excel и нажмите Alt+F11 (Редактор VBA)",
    "2. В меню: Файл → Импорт файла → выберите Модуль_WM9.bas",
    "3. Закройте редактор VBA (Alt+Q)",
    "4. Перейдите на лист ВВОД_КАССА → Alt+F8 → УстановитьВсеКнопки → Run",
    "5. На листах появятся кнопки для сохранения данных",
    "6. Если появится 'Предупреждение безопасности' — нажмите 'Включить содержимое'",
    "",
    "ВАЖНО: Файл нужно сохранить в формате .xlsm (Книга Excel с поддержкой макросов)",
    "ВАЖНО: Защита листов установлена. Редактировать можно только синие ячейки.",
    "",
    "Для LibreOffice Calc: импорт Basic-модуля через Сервис → Макросы → Редактор Basic",
]
for i,txt in enumerate(steps2,3):
    ws.merge_cells(start_row=i,start_column=1,end_row=i,end_column=10)
    c=ws.cell(i,1); c.value=txt
    if txt.startswith("ВАЖНО"):
        c.font=fnt(10,True,RED); c.fill=F(RED_L)
    elif txt=="":
        c.fill=F(LGRAY)
    else:
        c.font=fnt(10); c.fill=F(LGRAY if i%2==0 else WHITE)
    c.border=brd(); c.alignment=LA(); ws.row_dimensions[i].height=24

cw(ws,{"A":60,"B":14,"C":14,"D":14,"E":14,"F":14,"G":14,"H":14,"I":14,"J":14})
ws.sheet_properties.tabColor="FF8B5CF6"
print("✓ КАК_СДЕЛАТЬ_ДАШБОРД")

# ════════════════════════════════════════════════════════════
# Reorder sheets
# ════════════════════════════════════════════════════════════
desired_order=["ИНСТРУКЦИЯ","КАК_СДЕЛАТЬ_ДАШБОРД","ВВОД_КАССА","ВВОД_РАСХОДЫ",
               "ЗАПИСЬ_НА_ВЫПЛАТУ","КАЛЕНДАРЬ_ВЫПЛАТ","БАЗА_ДДС","ДАННЫЕ","ДАШБОРД",
               "ОТЧЁТ_РУКОВОДИТЕЛЮ","НАСТРОЙКИ"]
sheet_dict={ws_.title: ws_ for ws_ in wb.worksheets}
for i,title in enumerate(desired_order):
    if title in sheet_dict:
        wb._sheets.remove(sheet_dict[title])
        wb._sheets.insert(i, sheet_dict[title])

# ════════════════════════════════════════════════════════════
# Save
# ════════════════════════════════════════════════════════════
out_path="/home/user/Auron/WAY_MARKET_v9.xlsx"
wb.save(out_path)
import os
size=os.path.getsize(out_path)
print(f"\n✅ WAY_MARKET_v9.xlsx saved — {size//1024} KB, {len(wb.worksheets)} sheets")
