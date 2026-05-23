#!/usr/bin/env python3
"""Stage 5: Full rebuild of НАСТРОЙКИ (9 sections) + cascade DV/formula updates."""
import sys, re

src_path = "/home/user/Auron/build_wm9.py"
with open(src_path, encoding="utf-8") as f:
    src = f.read()

# ═══════════════════════════════════════════════════════════════════════
# PATCH 1 — Replace entire НАСТРОЙКИ section
# ═══════════════════════════════════════════════════════════════════════

OLD_N_START = '''# ════════════════════════════════════════════════════════════
# 1. НАСТРОЙКИ
# ════════════════════════════════════════════════════════════
ws = wb.active; ws.title = "НАСТРОЙКИ"; ws.sheet_view.showGridLines = False
banner(ws, "⚙  НАСТРОЙКИ МАГАЗИНА — заполните один раз", "A1:H1", INDIGO)'''

OLD_N_END = 'print("✓ НАСТРОЙКИ")'

NEW_NASTROYKI = '''# ════════════════════════════════════════════════════════════
# 1. НАСТРОЙКИ — центр управления шаблоном (9 разделов)
# ════════════════════════════════════════════════════════════
ws = wb.active; ws.title = "НАСТРОЙКИ"; ws.sheet_view.showGridLines = False
cw(ws,{"A":28,"B":3,"C":20,"D":3,"E":18,"F":3,"G":26,"H":16})

banner(ws, "⚙  НАСТРОЙКИ — ЦЕНТР УПРАВЛЕНИЯ ШАБЛОНОМ", "A1:H1", INDIGO)
ws.merge_cells("A2:H2")
ws.cell(2,1).value="Все настройки магазина — только здесь. Остальные листы подстраиваются автоматически."
ws.cell(2,1).font=fnt(10,it=True,col=GRAY); ws.cell(2,1).fill=F(LGRAY); ws.cell(2,1).alignment=CA(); ws.row_dimensions[2].height=22

# Helpers scoped to НАСТРОЙКИ
def n_sec(r_,title_,clr_=INDIGO):
    ws.merge_cells(f"A{r_}:H{r_}")
    ws.cell(r_,1).value=title_; ws.cell(r_,1).font=fnt(11,True,"FFFFFFFF")
    ws.cell(r_,1).fill=F(clr_); ws.cell(r_,1).alignment=LA()
    ws.row_dimensions[r_].height=28

def n_colhdr(r_,cols_,clr_):
    for ci_,tx_ in cols_:
        ws.cell(r_,ci_).value=tx_; ws.cell(r_,ci_).font=fnt(9,True,"FFFFFFFF")
        ws.cell(r_,ci_).fill=F(clr_); ws.cell(r_,ci_).border=brd(); ws.cell(r_,ci_).alignment=CA()
    ws.row_dimensions[r_].height=22

def n_param(r_,label_,val_,typ_="text",hint_=""):
    ws.cell(r_,1).value=label_; ws.cell(r_,1).font=fnt(10); ws.cell(r_,1).fill=F(LGRAY)
    ws.cell(r_,1).border=brd(); ws.cell(r_,1).alignment=LA()
    ws.cell(r_,5).value=val_; ws.cell(r_,5).font=fnt(11,True,INDIGO); ws.cell(r_,5).fill=F(INP)
    ws.cell(r_,5).border=brd_med(); ws.cell(r_,5).alignment=CA(); ws.cell(r_,5).protection=prot(False)
    if typ_=="date": ws.cell(r_,5).number_format=DATE_F
    elif typ_=="pct": ws.cell(r_,5).number_format="0%"
    elif typ_=="money": ws.cell(r_,5).number_format=MONEY
    if hint_:
        ws.cell(r_,7).value=hint_; ws.cell(r_,7).font=fnt(8,it=True,col=GRAY)
        ws.cell(r_,7).fill=F(LGRAY); ws.cell(r_,7).alignment=LA()
    ws.row_dimensions[r_].height=24

def n_toggle(r_,label_,default_="Вкл",hint_=""):
    ws.cell(r_,1).value=label_; ws.cell(r_,1).font=fnt(10); ws.cell(r_,1).fill=F(LGRAY)
    ws.cell(r_,1).border=brd(); ws.cell(r_,1).alignment=LA()
    ws.cell(r_,5).value=default_; ws.cell(r_,5).font=fnt(11,True)
    ws.cell(r_,5).fill=F(GREEN_L if default_=="Вкл" else RED_L)
    ws.cell(r_,5).border=brd_med(); ws.cell(r_,5).alignment=CA(); ws.cell(r_,5).protection=prot(False)
    if hint_:
        ws.cell(r_,7).value=hint_; ws.cell(r_,7).font=fnt(8,it=True,col=GRAY)
        ws.cell(r_,7).fill=F(LGRAY); ws.cell(r_,7).alignment=LA()
    ws.row_dimensions[r_].height=24

# ── РАЗДЕЛ 1: ПАРАМЕТРЫ МАГАЗИНА (E5–E11) ───────────────────
n_sec(4, "  РАЗДЕЛ 1 — ПАРАМЕТРЫ МАГАЗИНА")
n_colhdr(4, [], INDIGO)  # header already set above
n_param(5,  "Название магазина",           "WAY MARKET №2", "text",  "Отображается в заголовках отчётов")
n_param(6,  "Дата начала учёта",            today,          "date",  "Точка отсчёта для дашборда")
n_param(7,  "Доля в фонд (маржа %)",        0.25,           "pct",   "Выручка × Доля = маржинальная прибыль")
n_param(8,  "Лимит на закуп (%)",           0.75,           "pct",   "Максимум на закуп от выручки")
n_param(9,  "Начальный долг поставщикам",   500000,         "money", "Долг поставщикам на старте учёта")
n_param(10, "Округление сумм",              "до 100 ₽",     "text",  "Подсказка при вводе данных")
n_param(11, "Период сравнения",             "Прошлый месяц","text",  "Используется в отчёте руководителю")

# ── РАЗДЕЛ 2: АКТИВНЫЕ СМЕНЫ (E15–E17) ──────────────────────
n_sec(12, "  РАЗДЕЛ 2 — АКТИВНЫЕ СМЕНЫ", TEAL)
n_colhdr(13, [(1,"Смена"),(5,"Вкл / Выкл"),(7,"Эффект")], TEAL)
ws.merge_cells("A14:H14")
ws.cell(14,1).value=" Включите только те смены, которые работают в вашем магазине"
ws.cell(14,1).font=fnt(9,it=True,col=TEAL); ws.cell(14,1).fill=F(TEAL_L); ws.row_dimensions[14].height=20
n_toggle(15, "Смена ДЕНЬ",  "Вкл", "Показывает/скрывает блок ДЕНЬ на форме ввода")
n_toggle(16, "Смена ВЕЧЕР", "Вкл", "Показывает/скрывает блок ВЕЧЕР на форме ввода")
n_toggle(17, "Смена НОЧЬ",  "Вкл", "Показывает/скрывает блок НОЧЬ на форме ввода")

# ── РАЗДЕЛ 3: Z-ОТЧЁТ (E20–E24) ─────────────────────────────
n_sec(18, "  РАЗДЕЛ 3 — Z-ОТЧЁТ (источники выручки)", BLUE)
n_colhdr(19, [(1,"Источник"),(5,"Вкл / Выкл"),(7,"Описание")], BLUE)
n_toggle(20, "Эквайринг",              "Вкл",  "Терминал безналичной оплаты")
n_toggle(21, "Перевод (СБП / банк)",   "Вкл",  "Оплата по QR-коду или банковским переводом")
n_toggle(22, "Онлайн",                 "Выкл", "Онлайн-заказы, доставка")
n_toggle(23, "Иман (хозяин)",          "Вкл",  "Личные средства владельца, внесённые в кассу")
n_toggle(24, "Выплата с кассы",        "Вкл",  "Расходы, выданные напрямую из кассы")

# ── РАЗДЕЛ 4: КОНТРОЛЬ КАССЫ (E27–E29) ──────────────────────
n_sec(25, "  РАЗДЕЛ 4 — КОНТРОЛЬ КАССЫ (сверка Z vs факт)", RED)
n_colhdr(26, [(1,"Вид сверки"),(5,"Вкл / Выкл"),(7,"Формула расхождения")], RED)
n_toggle(27, "Сверка по наличке",      "Вкл",  "Z-наличка − Выплаты − Факт наличка")
n_toggle(28, "Сверка по эквайрингу",   "Вкл",  "Z-эквайринг − Факт эквайринг")
n_toggle(29, "Сверка по переводу",     "Вкл",  "Z-перевод − Факт перевод")

# ── РАЗДЕЛ 5: ИНВЕНТАРЬ (E32–E34) ───────────────────────────
n_sec(30, "  РАЗДЕЛ 5 — ИНВЕНТАРЬ", AMBER)
n_colhdr(31, [(1,"Функция"),(5,"Вкл / Выкл"),(7,"Где отображается")], AMBER)
n_toggle(32, "Списание товара",         "Выкл", "Поле «Списание» на форме ввода расходов")
n_toggle(33, "Возврат поставщику",      "Выкл", "Поле «Возврат поставщику» на форме ввода")
n_toggle(34, "Касса утром / вечером",   "Выкл", "Поля остатков наличных в кассе")

# ── РАЗДЕЛ 6: ПОРОГИ УВЕДОМЛЕНИЙ (E37–E39) ──────────────────
n_sec(35, "  РАЗДЕЛ 6 — ПОРОГИ УВЕДОМЛЕНИЙ", GRAY)
n_colhdr(36, [(1,"Параметр"),(5,"Значение"),(7,"Где используется")], GRAY)
n_param(37, "Расхождение кассы > (₽)",   5000,    "money", "Подсветка красным на дашборде")
n_param(38, "Общий долг > (₽)",          1000000, "money", "Подсветка долга на дашборде")
n_param(39, "Просрочка > (дней)",        7,       "text",  "Выплаты в КАЛЕНДАРЬ_ВЫПЛАТ")

# ── РАЗДЕЛ 7: СПРАВОЧНИКИ (A44–G79) ─────────────────────────
n_sec(40, "  РАЗДЕЛ 7 — СПРАВОЧНИКИ (выпадающие списки)", INDIGO)
ws.merge_cells("A41:H41")
ws.cell(41,1).value="  Добавляйте значения — они сразу появятся в выпадающих меню на всех листах"
ws.cell(41,1).font=fnt(9,it=True,col=INDIGO); ws.cell(41,1).fill=F(BLUE_L); ws.row_dimensions[41].height=20
ws.row_dimensions[42].height=6

for ci_,nm_,clr_ in [(1,"Кассиры",PURPLE),(3,"Категории расходов",AMBER),(5,"Способы оплаты",BLUE),(7,"Типы операций",NAVY)]:
    ws.cell(43,ci_).value=nm_; ws.cell(43,ci_).font=fnt(10,True,"FFFFFFFF")
    ws.cell(43,ci_).fill=F(clr_); ws.cell(43,ci_).border=brd(); ws.cell(43,ci_).alignment=CA()
ws.row_dimensions[43].height=26

kass_seed=["Сотрудник 1","Сотрудник 2"]
kat_seed =["Закуп","ЗП","Маркетинг","Логистика","Хоз.нужды","Аренда","Коммунальные","Охрана","Реклама","Ремонт"]
spos_seed=["Наличка","Эквайринг","Перевод","Иман","Долг"]
tip_seed =["Доход","Расход","Долг","Оплата долга","Расхождение","Иман","Списание","Возврат","Касса"]

for ri_ in range(44,80):
    alt_=ri_%2==0
    for ci_,seed_,clr_ in [(1,kass_seed,PURP_L),(3,kat_seed,AMBER_L),(5,spos_seed,BLUE_L),(7,tip_seed,BLUE_L)]:
        idx_=ri_-44
        c_=ws.cell(ri_,ci_)
        c_.value=seed_[idx_] if idx_<len(seed_) else None
        c_.font=fnt(10); c_.fill=F(clr_ if alt_ else WHITE)
        c_.border=brd(); c_.alignment=LA(); c_.protection=prot(False)
    ws.row_dimensions[ri_].height=22

tbl_kass=Table(displayName="tblКассиры",ref="A43:A79")
tbl_kass.tableStyleInfo=TableStyleInfo(name="TableStyleLight4",showRowStripes=True); ws.add_table(tbl_kass)
tbl_kat=Table(displayName="tblКатегории",ref="C43:C79")
tbl_kat.tableStyleInfo=TableStyleInfo(name="TableStyleLight3",showRowStripes=True); ws.add_table(tbl_kat)
tbl_spos=Table(displayName="tblСпособыОплаты",ref="E43:E79")
tbl_spos.tableStyleInfo=TableStyleInfo(name="TableStyleLight9",showRowStripes=True); ws.add_table(tbl_spos)
tbl_tip=Table(displayName="tblТипыОпераций",ref="G43:G79")
tbl_tip.tableStyleInfo=TableStyleInfo(name="TableStyleLight2",showRowStripes=True); ws.add_table(tbl_tip)

# ── РАЗДЕЛ 8: ПОСТОЯННЫЕ РАСХОДЫ ПО МЕСЯЦАМ (rows 81–94) ───
n_sec(80, "  РАЗДЕЛ 8 — ПОСТОЯННЫЕ РАСХОДЫ ПО МЕСЯЦАМ (справочно)", TEAL)
hrow(ws,81,["Месяц","ЗП","Аренда","Налоги","Интернет","Охрана","Другое","ИТОГО"],TEAL,26)
for ri_,mon_ in enumerate(MONTHS_RU,82):
    ws.cell(ri_,1).value=mon_; ws.cell(ri_,1).font=fnt(10); ws.cell(ri_,1).fill=F(LGRAY)
    ws.cell(ri_,1).border=brd(); ws.cell(ri_,1).alignment=LA()
    for ci_ in range(2,8):
        c_=ws.cell(ri_,ci_); c_.font=fnt(10); c_.fill=F(INP); c_.border=brd()
        c_.alignment=RA(); c_.number_format=MONEY; c_.protection=prot(False)
    ws.cell(ri_,8).value=f"=IFERROR(SUM(B{ri_}:G{ri_}),0)"
    ws.cell(ri_,8).font=fnt(10,True,TEAL); ws.cell(ri_,8).fill=F(TEAL_L)
    ws.cell(ri_,8).border=brd(); ws.cell(ri_,8).alignment=RA(); ws.cell(ri_,8).number_format=MONEY
    ws.row_dimensions[ri_].height=22
ws.cell(94,1).value="ИТОГО (год)"; ws.cell(94,1).font=fnt(10,True,TEAL); ws.cell(94,1).fill=F(TEAL_L)
ws.cell(94,1).border=brd(); ws.cell(94,1).alignment=LA(); ws.row_dimensions[94].height=24
for ci_,cl_ in enumerate("BCDEFGH",2):
    ws.cell(94,ci_).value=f"=IFERROR(SUM({cl_}82:{cl_}93),0)"
    ws.cell(94,ci_).font=fnt(10,True,TEAL); ws.cell(94,ci_).fill=F(TEAL_L)
    ws.cell(94,ci_).border=brd(); ws.cell(94,ci_).alignment=RA(); ws.cell(94,ci_).number_format=MONEY
tbl_post=Table(displayName="tblПостоянные",ref="A81:H94")
tbl_post.tableStyleInfo=TableStyleInfo(name="TableStyleLight6",showRowStripes=True); ws.add_table(tbl_post)

# ── РАЗДЕЛ 9: СПРАВОЧНИК ПОСТАВЩИКОВ (ТП) (rows 98–1098) ────
ws.row_dimensions[95].height=8
n_sec(96, "  РАЗДЕЛ 9 — СПРАВОЧНИК ПОСТАВЩИКОВ / ТОРГОВЫХ ПРЕДСТАВИТЕЛЕЙ", PURPLE)
ws.merge_cells("A97:H97")
ws.cell(97,1).value="  Добавляйте ТП — они появятся в выпадающем списке на листе ЗАПИСЬ_НА_ВЫПЛАТУ"
ws.cell(97,1).font=fnt(9,it=True,col=PURPLE); ws.cell(97,1).fill=F(PURP_L); ws.row_dimensions[97].height=20
hrow(ws,98,["№","Название ТП / Поставщика","Телефон / Контакт","","","","",""],PURPLE,26)
for ri_ in range(99,1099):
    alt_=ri_%2==0; bg_=PURP_L if alt_ else WHITE
    ws.cell(ri_,1).value=f'=IF(B{ri_}="","",ROW()-98)'
    ws.cell(ri_,1).font=fnt(9,col=GRAY); ws.cell(ri_,1).fill=F(bg_)
    ws.cell(ri_,1).border=brd(); ws.cell(ri_,1).alignment=CA()
    ws.cell(ri_,2).font=fnt(10); ws.cell(ri_,2).fill=F(INP if ri_<=101 else bg_)
    ws.cell(ri_,2).border=brd(); ws.cell(ri_,2).alignment=LA(); ws.cell(ri_,2).protection=prot(False)
    ws.cell(ri_,3).font=fnt(10); ws.cell(ri_,3).fill=F(bg_)
    ws.cell(ri_,3).border=brd(); ws.cell(ri_,3).alignment=LA(); ws.cell(ri_,3).protection=prot(False)
    ws.row_dimensions[ri_].height=20
tbl_tp=Table(displayName="tblПоставщики",ref="A98:C1098")
tbl_tp.tableStyleInfo=TableStyleInfo(name="TableStyleLight5",showRowStripes=True); ws.add_table(tbl_tp)

# ── DataValidation: Вкл/Выкл на всех переключателях ─────────
dv_vv=DataValidation(type="list",formula1='"Вкл,Выкл"'); ws.add_data_validation(dv_vv)
for rng_ in ["E15:E17","E20:E24","E27:E29","E32:E34"]:
    dv_vv.add(rng_)

# ── CF: Вкл → зелёный, Выкл → красный ───────────────────────
for rng_,anch_ in [("E15:E17","$E15"),("E20:E24","$E20"),("E27:E29","$E27"),("E32:E34","$E32")]:
    ws.conditional_formatting.add(rng_,FormulaRule(formula=[f'{anch_}="Вкл"'],  fill=F(GREEN_L),font=fnt(11,True,GREEN)))
    ws.conditional_formatting.add(rng_,FormulaRule(formula=[f'{anch_}="Выкл"'], fill=F(RED_L),  font=fnt(11,True,RED)))

ws.freeze_panes="A3"
ws.sheet_properties.tabColor="FF374151"
print("✓ НАСТРОЙКИ (9 разделов)")'''

# Locate old section boundaries
start_idx = src.find(OLD_N_START)
if start_idx == -1:
    print("ERROR: НАСТРОЙКИ start anchor not found")
    sys.exit(1)

end_idx = src.find(OLD_N_END, start_idx)
if end_idx == -1:
    print("ERROR: НАСТРОЙКИ end anchor not found")
    sys.exit(1)

end_idx += len(OLD_N_END)
src = src[:start_idx] + NEW_NASTROYKI + src[end_idx:]
print("✓ PATCH 1: НАСТРОЙКИ section replaced (9 sections)")

# ═══════════════════════════════════════════════════════════════════════
# PATCH 2 — БАЗА_ДДС: update DV references to new справочник locations
# ═══════════════════════════════════════════════════════════════════════

old_dvs = {
    'dv_pay=DataValidation(type="list",formula1="=НАСТРОЙКИ!$H$24:$H$33"); ws.add_data_validation(dv_pay); dv_pay.add("F4:F3003")':
    'dv_pay=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$79"); ws.add_data_validation(dv_pay); dv_pay.add("F4:F3003")',

    'dv_cat=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$24:$E$33"); ws.add_data_validation(dv_cat); dv_cat.add("E4:E3003")':
    'dv_cat=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$44:$C$79"); ws.add_data_validation(dv_cat); dv_cat.add("E4:E3003")',

    'dv_ksr=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$24:$C$33"); ws.add_data_validation(dv_ksr); dv_ksr.add("C4:C3003")':
    'dv_ksr=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$44:$A$79"); ws.add_data_validation(dv_ksr); dv_ksr.add("C4:C3003")',
}
for old, new in old_dvs.items():
    if old not in src:
        print(f"ERROR: БАЗА_ДДС DV anchor not found:\n  {old[:60]}")
        sys.exit(1)
    src = src.replace(old, new, 1)
print("✓ PATCH 2: БАЗА_ДДС DV references updated")

# ═══════════════════════════════════════════════════════════════════════
# PATCH 3 — ВВОД_КАССА: Смена→static list, Кассир→new address
# ═══════════════════════════════════════════════════════════════════════

old_k = 'dv_sm_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$24:$A$33"); ws.add_data_validation(dv_sm_k)\ndv_ks_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$24:$C$33"); ws.add_data_validation(dv_ks_k)'
new_k = 'dv_sm_k=DataValidation(type="list",formula1=\'"День,Вечер,Ночь,-"\'             ); ws.add_data_validation(dv_sm_k)\ndv_ks_k=DataValidation(type="list",formula1="=НАСТРОЙКИ!$A$44:$A$79"        ); ws.add_data_validation(dv_ks_k)'

if old_k not in src:
    print("ERROR: ВВОД_КАССА DV anchor not found")
    sys.exit(1)
src = src.replace(old_k, new_k, 1)
print("✓ PATCH 3: ВВОД_КАССА DV updated (static Смены, new Кассиры address)")

# ═══════════════════════════════════════════════════════════════════════
# PATCH 4 — ВВОД_РАСХОДЫ: Категория→C44, Способ→E44
# ═══════════════════════════════════════════════════════════════════════

old_r = 'dv_cat_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$24:$E$33"); ws.add_data_validation(dv_cat_r)\ndv_pay_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$H$24:$H$33"); ws.add_data_validation(dv_pay_r)'
new_r = 'dv_cat_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$C$44:$C$79"); ws.add_data_validation(dv_cat_r)\ndv_pay_r=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$79"); ws.add_data_validation(dv_pay_r)'

if old_r not in src:
    print("ERROR: ВВОД_РАСХОДЫ DV anchor not found")
    sys.exit(1)
src = src.replace(old_r, new_r, 1)
print("✓ PATCH 4: ВВОД_РАСХОДЫ DV updated")

# ═══════════════════════════════════════════════════════════════════════
# PATCH 5 — ЗАПИСЬ_НА_ВЫПЛАТУ: add Поставщик DV, update Способ DV
# ═══════════════════════════════════════════════════════════════════════

old_z = 'dv_sp_z=DataValidation(type="list",formula1=\'"Наличка,Эквайринг,Перевод"\',allow_blank=True)\nws.add_data_validation(dv_sp_z); dv_sp_z.add("G4:G503")'
new_z = ('dv_tp_z=DataValidation(type="list",formula1="=НАСТРОЙКИ!$B$99:$B$1098",allow_blank=True)\n'
         'ws.add_data_validation(dv_tp_z); dv_tp_z.add("C4:C503")\n'
         'dv_sp_z=DataValidation(type="list",formula1="=НАСТРОЙКИ!$E$44:$E$79",allow_blank=True)\n'
         'ws.add_data_validation(dv_sp_z); dv_sp_z.add("G4:G503")')

if old_z not in src:
    print("ERROR: ЗАПИСЬ_НА_ВЫПЛАТУ DV anchor not found")
    sys.exit(1)
src = src.replace(old_z, new_z, 1)
print("✓ PATCH 5: ЗАПИСЬ_НА_ВЫПЛАТУ — Поставщик DV added, Способ DV updated")

# ═══════════════════════════════════════════════════════════════════════
# PATCH 6 — ОТЧЁТ_РУКОВОДИТЕЛЮ: B5→E5, B7→E7, B8→E8, B9→E9
# ═══════════════════════════════════════════════════════════════════════

otch_fixes = [
    ("=НАСТРОЙКИ!B5&",   "=НАСТРОЙКИ!E5&"),
    ("НАСТРОЙКИ!$B$7",   "НАСТРОЙКИ!$E$7"),
    ("НАСТРОЙКИ!$B$8",   "НАСТРОЙКИ!$E$8"),
    ("НАСТРОЙКИ!$B$9",   "НАСТРОЙКИ!$E$9"),
    ('"НАСТРОЙКИ!B9"',   '"НАСТРОЙКИ!E9"'),  # fallback reference string in block3
]
for old, new in otch_fixes:
    count = src.count(old)
    if count == 0:
        print(f"  WARN: '{old}' not found — skipping")
    else:
        src = src.replace(old, new)
        print(f"  ✓ {old} → {new}  ({count}×)")
print("✓ PATCH 6: ОТЧЁТ_РУКОВОДИТЕЛЮ НАСТРОЙКИ references updated")

# ═══════════════════════════════════════════════════════════════════════
# Write result
# ═══════════════════════════════════════════════════════════════════════
with open(src_path, "w", encoding="utf-8") as f:
    f.write(src)
print("\n✅ All patches applied — build_wm9.py updated")
