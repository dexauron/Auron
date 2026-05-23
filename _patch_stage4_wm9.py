#!/usr/bin/env python3
"""Stage 4 patch: replace ВВОД_КАССА (10-col) and ВВОД_РАСХОДЫ (5-col) in build_wm9.py"""
import sys

src_path = "/home/user/Auron/build_wm9.py"
with open(src_path, encoding="utf-8") as f:
    src = f.read()

# ── PATCH 1: ВВОД_КАССА ─────────────────────────────────────────────────────
OLD_KASSA = '''# ════════════════════════════════════════════════════════════
# 3. ВВОД_КАССА
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_КАССА"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД ДАННЫХ КАССЫ  |  ► кнопки: СОХРАНИТЬ / СЕГОДНЯ / ВЧЕРА — см. строку 1", "A1:M1", BLUE)
ws.merge_cells("A2:M2")
ws.cell(2,1).value="Заполните таблицу. Расхождение = Факт.Касса − Выручка.Z (авто). Нажмите СОХРАНИТЬ КАССУ."
ws.cell(2,1).font=fnt(10,it=True,col=BLUE); ws.cell(2,1).fill=F(BLUE_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22
# Smart table tblВводКасса
hdrs_k=["Дата","Смена","Кассир","Выручка.Z","Факт.Касса","Эквайринг","Перевод","Иман","Выплаты","Закуп","Долг.ТП","Расхождение","Остаток"]
hrow(ws,3,hdrs_k,BLUE,30)
ws.row_dimensions[3].height=30
dv_sm_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$24:$A$33"); ws.add_data_validation(dv_sm_k)
dv_ks_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$24:$C$33"); ws.add_data_validation(dv_ks_k)
for r in range(4,504):
    alt=r%2==0; bg=LGRAY if alt else WHITE; seed=r<=6
    ws.cell(r,1).font=fnt(10); ws.cell(r,1).fill=F(INP if seed else bg); ws.cell(r,1).border=brd()
    ws.cell(r,1).alignment=CA(); ws.cell(r,1).number_format=DATE_F; ws.cell(r,1).protection=prot(False)
    if seed: ws.cell(r,1).value=today
    if r==4: ws.cell(r,2).value="День"
    elif r==5: ws.cell(r,2).value="Вечер"
    elif r==6: ws.cell(r,2).value="Ночь"
    ws.cell(r,2).font=fnt(10); ws.cell(r,2).fill=F(INP if seed else bg); ws.cell(r,2).border=brd()
    ws.cell(r,2).alignment=CA(); ws.cell(r,2).protection=prot(False)
    ws.cell(r,3).font=fnt(10); ws.cell(r,3).fill=F(INP if seed else bg); ws.cell(r,3).border=brd()
    ws.cell(r,3).alignment=LA(); ws.cell(r,3).protection=prot(False)
    for ci in range(4,12):
        c=ws.cell(r,ci); c.font=fnt(10,True,INDIGO); c.fill=F(INP if seed else bg)
        c.border=brd(); c.alignment=RA(); c.number_format=MONEY; c.protection=prot(False)
    ws.cell(r,12).value=f"=IFERROR(E{r}-D{r},0)"
    ws.cell(r,12).font=fnt(10,True,RED); ws.cell(r,12).fill=F(RED_L if seed else bg)
    ws.cell(r,12).border=brd(); ws.cell(r,12).alignment=RA(); ws.cell(r,12).number_format=MONEY
    ws.cell(r,13).font=fnt(10); ws.cell(r,13).fill=F(INP if seed else bg)
    ws.cell(r,13).border=brd(); ws.cell(r,13).alignment=RA()
    ws.cell(r,13).number_format=MONEY; ws.cell(r,13).protection=prot(False)
    ws.row_dimensions[r].height=22
dv_sm_k.add("B4:B503"); dv_ks_k.add("C4:C503")
tbl_vk=Table(displayName="tblВводКасса",ref="A3:M503")
tbl_vk.tableStyleInfo=TableStyleInfo(name="TableStyleMedium2",showRowStripes=True,showFirstColumn=False)
ws.add_table(tbl_vk)
cw(ws,{"A":12,"B":10,"C":16,"D":14,"E":13,"F":12,"G":10,"H":10,"I":12,"J":12,"K":12,"L":14,"M":12})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FF3B82F6"
print("✓ ВВОД_КАССА")'''

NEW_KASSA = '''# ════════════════════════════════════════════════════════════
# 3. ВВОД_КАССА  (10 колонок, Stage 4)
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_КАССА"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД ДАННЫХ КАССЫ  |  ► кнопки: СОХРАНИТЬ / СЕГОДНЯ / ВЧЕРА", "A1:J1", BLUE)
ws.merge_cells("A2:J2")
ws.cell(2,1).value="Введите Z-отчёты и фактику по трём каналам. Расхождение рассчитывается автоматически."
ws.cell(2,1).font=fnt(10,it=True,col=BLUE); ws.cell(2,1).fill=F(BLUE_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22
# Smart table tblВводКасса — 10 колонок
hdrs_k=["Дата","Смена","Кассир","Выручка (Z-отчёт)","Эквайринг (Z)","Перевод (Z)","Факт.наличка","Факт.эквайринг","Факт.перевод","Расхождение"]
hrow(ws,3,hdrs_k,BLUE,30)
ws.row_dimensions[3].height=30
dv_sm_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$24:$A$33"); ws.add_data_validation(dv_sm_k)
dv_ks_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$24:$C$33"); ws.add_data_validation(dv_ks_k)
for r in range(4,504):
    alt=r%2==0; bg=LGRAY if alt else WHITE; seed=r<=6
    ws.cell(r,1).font=fnt(10); ws.cell(r,1).fill=F(INP if seed else bg); ws.cell(r,1).border=brd()
    ws.cell(r,1).alignment=CA(); ws.cell(r,1).number_format=DATE_F; ws.cell(r,1).protection=prot(False)
    if seed: ws.cell(r,1).value=today
    if r==4: ws.cell(r,2).value="День"
    elif r==5: ws.cell(r,2).value="Вечер"
    elif r==6: ws.cell(r,2).value="Ночь"
    ws.cell(r,2).font=fnt(10); ws.cell(r,2).fill=F(INP if seed else bg); ws.cell(r,2).border=brd()
    ws.cell(r,2).alignment=CA(); ws.cell(r,2).protection=prot(False)
    ws.cell(r,3).font=fnt(10); ws.cell(r,3).fill=F(INP if seed else bg); ws.cell(r,3).border=brd()
    ws.cell(r,3).alignment=LA(); ws.cell(r,3).protection=prot(False)
    # cols 4-9: Z-отчёты (D-F) + фактика (G-I)
    for ci in range(4,10):
        c=ws.cell(r,ci); c.font=fnt(10,True,INDIGO); c.fill=F(INP if seed else bg)
        c.border=brd(); c.alignment=RA(); c.number_format=MONEY; c.protection=prot(False)
    # col 10: Расхождение = (G+H+I) - (D+E+F)
    ws.cell(r,10).value=f"=IFERROR((G{r}+H{r}+I{r})-(D{r}+E{r}+F{r}),0)"
    ws.cell(r,10).font=fnt(10,True,RED); ws.cell(r,10).fill=F(RED_L if seed else bg)
    ws.cell(r,10).border=brd(); ws.cell(r,10).alignment=RA(); ws.cell(r,10).number_format=MONEY
    ws.row_dimensions[r].height=22
dv_sm_k.add("B4:B503"); dv_ks_k.add("C4:C503")
tbl_vk=Table(displayName="tblВводКасса",ref="A3:J503")
tbl_vk.tableStyleInfo=TableStyleInfo(name="TableStyleMedium2",showRowStripes=True,showFirstColumn=False)
ws.add_table(tbl_vk)
cw(ws,{"A":12,"B":10,"C":16,"D":17,"E":14,"F":13,"G":14,"H":15,"I":14,"J":14})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FF3B82F6"
print("✓ ВВОД_КАССА")'''

# ── PATCH 2: ВВОД_РАСХОДЫ ───────────────────────────────────────────────────
OLD_RASXODY = '''# ════════════════════════════════════════════════════════════
# 4. ВВОД_РАСХОДЫ
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_РАСХОДЫ"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД РАСХОДОВ  |  ► кнопка СОХРАНИТЬ РАСХОДЫ — см. строку 1", "A1:F1", RED)
ws.merge_cells("A2:F2")
ws.cell(2,1).value="Заполните таблицу расходов. Нажмите СОХРАНИТЬ РАСХОДЫ."
ws.cell(2,1).font=fnt(10,it=True,col=RED); ws.cell(2,1).fill=F(RED_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22
# Smart table tblВводРасходы
hdrs_r=["Дата","Кассир","Категория","Способ","Сумма","Комментарий"]
hrow(ws,3,hdrs_r,RED,30)
ws.row_dimensions[3].height=30
dv_ks_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$24:$C$33"); ws.add_data_validation(dv_ks_r)
dv_cat_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$24:$E$33"); ws.add_data_validation(dv_cat_r)
dv_pay_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$H$24:$H$33"); ws.add_data_validation(dv_pay_r)
for r in range(4,504):
    alt=r%2==0; bg=LGRAY if alt else WHITE; seed=r==4
    if seed: ws.cell(r,1).value=today
    ws.cell(r,1).font=fnt(10); ws.cell(r,1).fill=F(INP if seed else bg)
    ws.cell(r,1).border=brd(); ws.cell(r,1).alignment=CA()
    ws.cell(r,1).number_format=DATE_F; ws.cell(r,1).protection=prot(False)
    ws.cell(r,2).font=fnt(10); ws.cell(r,2).fill=F(INP if seed else bg)
    ws.cell(r,2).border=brd(); ws.cell(r,2).alignment=LA(); ws.cell(r,2).protection=prot(False)
    ws.cell(r,3).font=fnt(10); ws.cell(r,3).fill=F(INP if seed else bg)
    ws.cell(r,3).border=brd(); ws.cell(r,3).alignment=LA(); ws.cell(r,3).protection=prot(False)
    ws.cell(r,4).font=fnt(10); ws.cell(r,4).fill=F(INP if seed else bg)
    ws.cell(r,4).border=brd(); ws.cell(r,4).alignment=CA(); ws.cell(r,4).protection=prot(False)
    ws.cell(r,5).font=fnt(11,True,INDIGO); ws.cell(r,5).fill=F(INP if seed else bg)
    ws.cell(r,5).border=brd(); ws.cell(r,5).alignment=RA()
    ws.cell(r,5).number_format=MONEY; ws.cell(r,5).protection=prot(False)
    ws.cell(r,6).font=fnt(10); ws.cell(r,6).fill=F(bg)
    ws.cell(r,6).border=brd(); ws.cell(r,6).alignment=LA(); ws.cell(r,6).protection=prot(False)
    ws.row_dimensions[r].height=22
dv_ks_r.add("B4:B503"); dv_cat_r.add("C4:C503"); dv_pay_r.add("D4:D503")
tbl_vr=Table(displayName="tblВводРасходы",ref="A3:F503")
tbl_vr.tableStyleInfo=TableStyleInfo(name="TableStyleMedium3",showRowStripes=True,showFirstColumn=False)
ws.add_table(tbl_vr)
cw(ws,{"A":12,"B":16,"C":20,"D":14,"E":16,"F":30})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FFEF4444"
print("✓ ВВОД_РАСХОДЫ")'''

NEW_RASXODY = '''# ════════════════════════════════════════════════════════════
# 4. ВВОД_РАСХОДЫ  (5 колонок без Кассира, Stage 4)
# ════════════════════════════════════════════════════════════
ws = wb.create_sheet("ВВОД_РАСХОДЫ"); ws.sheet_view.showGridLines = False
banner(ws, "ВВОД РАСХОДОВ  |  ► кнопка СОХРАНИТЬ РАСХОДЫ", "A1:E1", RED)
ws.merge_cells("A2:E2")
ws.cell(2,1).value="Заполните таблицу расходов. Нажмите СОХРАНИТЬ РАСХОДЫ."
ws.cell(2,1).font=fnt(10,it=True,col=RED); ws.cell(2,1).fill=F(RED_L); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22
# Smart table tblВводРасходы — 5 колонок (без Кассира)
hdrs_r=["Дата","Категория","Способ оплаты","Сумма","Комментарий"]
hrow(ws,3,hdrs_r,RED,30)
ws.row_dimensions[3].height=30
dv_cat_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$24:$E$33"); ws.add_data_validation(dv_cat_r)
dv_pay_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$H$24:$H$33"); ws.add_data_validation(dv_pay_r)
for r in range(4,504):
    alt=r%2==0; bg=LGRAY if alt else WHITE; seed=r==4
    if seed: ws.cell(r,1).value=today
    ws.cell(r,1).font=fnt(10); ws.cell(r,1).fill=F(INP if seed else bg)
    ws.cell(r,1).border=brd(); ws.cell(r,1).alignment=CA()
    ws.cell(r,1).number_format=DATE_F; ws.cell(r,1).protection=prot(False)
    ws.cell(r,2).font=fnt(10); ws.cell(r,2).fill=F(INP if seed else bg)
    ws.cell(r,2).border=brd(); ws.cell(r,2).alignment=LA(); ws.cell(r,2).protection=prot(False)
    ws.cell(r,3).font=fnt(10); ws.cell(r,3).fill=F(INP if seed else bg)
    ws.cell(r,3).border=brd(); ws.cell(r,3).alignment=CA(); ws.cell(r,3).protection=prot(False)
    ws.cell(r,4).font=fnt(11,True,INDIGO); ws.cell(r,4).fill=F(INP if seed else bg)
    ws.cell(r,4).border=brd(); ws.cell(r,4).alignment=RA()
    ws.cell(r,4).number_format=MONEY; ws.cell(r,4).protection=prot(False)
    ws.cell(r,5).font=fnt(10); ws.cell(r,5).fill=F(bg)
    ws.cell(r,5).border=brd(); ws.cell(r,5).alignment=LA(); ws.cell(r,5).protection=prot(False)
    ws.row_dimensions[r].height=22
dv_cat_r.add("B4:B503"); dv_pay_r.add("C4:C503")
tbl_vr=Table(displayName="tblВводРасходы",ref="A3:E503")
tbl_vr.tableStyleInfo=TableStyleInfo(name="TableStyleMedium3",showRowStripes=True,showFirstColumn=False)
ws.add_table(tbl_vr)
cw(ws,{"A":12,"B":22,"C":16,"D":16,"E":34})
ws.freeze_panes="A4"; ws.sheet_properties.tabColor="FFEF4444"
print("✓ ВВОД_РАСХОДЫ")'''

# Apply patches
if OLD_KASSA not in src:
    print("ERROR: ВВОД_КАССА anchor not found")
    sys.exit(1)
src = src.replace(OLD_KASSA, NEW_KASSA, 1)

if OLD_RASXODY not in src:
    print("ERROR: ВВОД_РАСХОДЫ anchor not found")
    sys.exit(1)
src = src.replace(OLD_RASXODY, NEW_RASXODY, 1)

with open(src_path, "w", encoding="utf-8") as f:
    f.write(src)
print("✓ build_wm9.py patched — ВВОД_КАССА (10-col) + ВВОД_РАСХОДЫ (5-col)")
