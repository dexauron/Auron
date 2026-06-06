#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auron — обработка сырых данных продаж: парсинг CSV/Excel, расчёт себестоимости
(FIFO / скользящая средняя) и P&L.

Деньги — целые копейки (int), чтобы исключить дрейф float.
Хронология обязательна: поступления и продажи обрабатываются в порядке timestamp,
иначе FIFO и средняя дадут неверную себестоимость.

Форматы входа:
  purchases.csv : ts,sku,qty,unit_cost_rub,supplier
  sales.csv     : ts,receipt_id,register,cashier,op_type,sku,qty,price_rub,discount_rub
  opex.csv      : date,cf_item,section,amount_rub        (необязательно; ФОТ/аренда/...)

Запуск:
  python process_sales.py --purchases purchases.csv --sales sales.csv [--opex opex.csv] [--method fifo|avg]
  python process_sales.py --demo        # демонстрация 3 смен закупочной цены
"""
from __future__ import annotations
import argparse, csv, sys
from collections import deque, defaultdict
from dataclasses import dataclass, field
from datetime import datetime

EPS = 1e-9


def to_kop(rub) -> int:
    """'1 234,56' / 1234.56 -> 123456 коп."""
    if rub is None or rub == "":
        return 0
    s = str(rub).replace("\xa0", "").replace(" ", "").replace(",", ".")
    return int(round(float(s) * 100))


def rub(kop: int) -> str:
    return f"{kop/100:,.2f}".replace(",", " ")


def parse_ts(v) -> datetime:
    v = str(v).strip()
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(v, f)
        except ValueError:
            continue
    raise ValueError(f"Не распознан timestamp: {v!r}")


# ── COGS-движок по одному SKU ───────────────────────────────────────────────
@dataclass
class _Batch:
    received_at: datetime
    qty: float       # остаток партии
    unit_cost: int   # коп/ед


@dataclass
class Product:
    sku: str
    method: str = "fifo"             # 'fifo' | 'avg'
    batches: deque = field(default_factory=deque)   # FIFO-очередь
    avg_qty: float = 0.0             # единый пул для скользящей средней
    avg_val: int = 0                 # стоимость пула, коп (внутренне согласовано)
    neg_qty: float = 0.0             # суммарный отрицательный сток (контроль)

    def receive(self, qty: float, unit_cost: int, when: datetime):
        self.batches.append(_Batch(when, qty, unit_cost))
        self.avg_qty += qty
        self.avg_val += int(round(qty * unit_cost))

    def issue(self, qty: float):
        """Списать qty. Возврат: (cogs_kop, [(unit_cost, qty), ...])."""
        if self.method == "avg":
            unit = int(round(self.avg_val / self.avg_qty)) if self.avg_qty > EPS else 0
            cogs = int(round(qty * unit))
            self.avg_qty -= qty
            self.avg_val = max(0, self.avg_val - cogs)
            if self.avg_qty < -EPS:                       # отрицательный сток
                self.neg_qty += -self.avg_qty
                self.avg_qty = 0
            return cogs, [(unit, qty)]

        # FIFO
        left, cogs, allocs = qty, 0, []
        while left > EPS and self.batches:
            b = self.batches[0]
            take = min(b.qty, left)
            cogs += int(round(take * b.unit_cost))
            allocs.append((b.unit_cost, take))
            b.qty -= take
            left -= take
            if b.qty <= EPS:
                self.batches.popleft()
        if left > EPS:                                    # продали больше, чем на складе
            unit = allocs[-1][0] if allocs else 0
            cogs += int(round(left * unit))
            allocs.append((unit, left))
            self.neg_qty += left
        self.avg_qty = max(0, self.avg_qty - qty)
        self.avg_val = max(0, self.avg_val - cogs)
        return cogs, allocs

    def stock_value(self) -> int:
        """Замороженный капитал. AVG — из пула, FIFO — из остатков партий."""
        if self.method == "avg":
            return self.avg_val
        return int(round(sum(b.qty * b.unit_cost for b in self.batches)))


# ── Загрузка ────────────────────────────────────────────────────────────────
def _read(path: str):
    if path.lower().endswith((".xlsx", ".xls")):
        import pandas as pd  # требует openpyxl
        return pd.read_excel(path).to_dict("records")
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# ── Основной расчёт ──────────────────────────────────────────────────────────
def run(purchases_path, sales_path, opex_path=None, method_override=None):
    products: dict[str, Product] = {}

    def prod(sku):
        if sku not in products:
            products[sku] = Product(sku, method_override or "fifo")
        return products[sku]

    events = []  # (ts, kind, row)
    for r in _read(purchases_path):
        events.append((parse_ts(r["ts"]), "buy", r))
    for r in _read(sales_path):
        events.append((parse_ts(r["ts"]), "sell", r))
    events.sort(key=lambda e: e[0])  # строгая хронология

    revenue = cogs = 0
    by_sku = defaultdict(lambda: {"revenue": 0, "cogs": 0, "qty": 0.0})
    receipts = defaultdict(lambda: {"ts": None, "total": 0, "op": "sale"})

    for ts, kind, r in events:
        if kind == "buy":
            prod(r["sku"]).receive(float(r["qty"]), to_kop(r["unit_cost_rub"]), ts)
            continue
        # sell
        op = (r.get("op_type") or "sale").strip()
        qty = float(r["qty"])
        line = qty * to_kop(r["price_rub"]) - to_kop(r.get("discount_rub", 0))
        line = int(round(line))
        sign = -1 if op == "refund" else 1
        if op in ("void",):  # аннулированный чек — в выручку не идёт
            sign = 0
        c, _ = prod(r["sku"]).issue(qty) if op == "sale" else (0, [])
        revenue += sign * line
        cogs += sign * c
        by_sku[r["sku"]]["revenue"] += sign * line
        by_sku[r["sku"]]["cogs"] += sign * c
        by_sku[r["sku"]]["qty"] += sign * qty
        rid = r.get("receipt_id") or f"{ts}-{r['sku']}"
        receipts[rid]["ts"] = ts
        receipts[rid]["op"] = op
        receipts[rid]["total"] += sign * line

    # P&L
    gross = revenue - cogs
    opex = 0
    opex_rows = []
    if opex_path:
        for r in _read(opex_path):
            a = to_kop(r["amount_rub"])
            opex += a
            opex_rows.append((r.get("cf_item", ""), a))
    net = gross - opex

    # Средний чек / трафик
    sale_receipts = [v for v in receipts.values() if v["op"] == "sale"]
    n_receipts = len(sale_receipts)
    avg_check = int(round(sum(v["total"] for v in sale_receipts) / n_receipts)) if n_receipts else 0

    # ── вывод ──
    print("=" * 56)
    print("P&L (Прибыли и убытки)")
    print("=" * 56)
    print(f"Выручка:          ₽ {rub(revenue)}")
    print(f"Себестоимость:    ₽ {rub(cogs)}")
    print(f"Валовая прибыль:  ₽ {rub(gross)}   ({100*gross//revenue if revenue else 0}%)")
    if opex_rows:
        print("-" * 56)
        for name, a in opex_rows:
            print(f"  {name:<24} ₽ {rub(a)}")
        print(f"Опер. расходы:    ₽ {rub(opex)}")
    print(f"ЧИСТАЯ ПРИБЫЛЬ:   ₽ {rub(net)}")
    print("-" * 56)
    print(f"Чеков (продажи): {n_receipts}   Средний чек: ₽ {rub(avg_check)}")

    print("\nВаловая прибыль по SKU:")
    print(f"{'SKU':<14}{'Выручка':>14}{'COGS':>14}{'Валовая':>14}{'Маржа%':>8}")
    for sku, v in sorted(by_sku.items(), key=lambda x: -(x[1]['revenue'] - x[1]['cogs'])):
        g = v["revenue"] - v["cogs"]
        m = (100 * g // v["revenue"]) if v["revenue"] else 0
        print(f"{sku:<14}{rub(v['revenue']):>14}{rub(v['cogs']):>14}{rub(g):>14}{m:>7}%")

    print("\nЗамороженный капитал (остатки × закупка):")
    inv = 0
    for sku, p in products.items():
        sv = p.stock_value()
        inv += sv
        flag = f"  ⚠ отрицательный сток: {p.neg_qty:g}" if p.neg_qty > EPS else ""
        if sv or flag:
            print(f"  {sku:<14} ₽ {rub(sv)}{flag}")
    print(f"  Итого запасов:  ₽ {rub(inv)}")
    return {"revenue": revenue, "cogs": cogs, "gross": gross, "opex": opex, "net": net}


# ── ДЕМО: одна и та же SKU, закупочная цена менялась 3 раза ───────────────────
def demo():
    print("ДЕМО — SKU 'A', закупка менялась 3 раза: 100 / 120 / 150 ₽\n"
          "Поступления: 10@100, 10@120, 10@150.  Продажа: 25 шт по 200 ₽.\n")
    for method in ("fifo", "avg"):
        p = Product("A", method)
        t = parse_ts("2025-01-01")
        p.receive(10, to_kop(100), parse_ts("2025-01-01"))
        p.receive(10, to_kop(120), parse_ts("2025-01-10"))
        p.receive(10, to_kop(150), parse_ts("2025-01-20"))
        cogs, allocs = p.issue(25)
        rev = 25 * to_kop(200)
        print(f"[{method.upper()}] COGS={rub(cogs)}  выручка={rub(rev)}  "
              f"валовая={rub(rev-cogs)}  остаток-капитал={rub(p.stock_value())}")
        print("   списано из партий:",
              ", ".join(f"{q:g}@{rub(uc)}" for uc, q in allocs))
    print("\nFIFO: 10×100 + 10×120 + 5×150 = 2950 ₽; дорогой остаток (5×150) заморожен.")
    print("AVG : средняя (100·10+120·10+150·10)/30 = 123.33 ₽ → 25×123.33 = 3083.33 ₽.")
    print("ОПАСНО (наивный метод): 25 × последняя цена 150 = 3750 ₽ → маржа занижена,"
          " прибыль искажена. Поэтому себестоимость считается по партиям, а не по 'цене товара'.")


def main():
    ap = argparse.ArgumentParser(description="Auron COGS/P&L processor")
    ap.add_argument("--purchases")
    ap.add_argument("--sales")
    ap.add_argument("--opex")
    ap.add_argument("--method", choices=["fifo", "avg"])
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    if a.demo:
        demo(); return
    if not (a.purchases and a.sales):
        ap.error("нужны --purchases и --sales (или --demo)")
    run(a.purchases, a.sales, a.opex, a.method)


if __name__ == "__main__":
    main()
