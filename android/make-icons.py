# -*- coding: utf-8 -*-
"""Значок приложения Auron — во всех размерах, которые нужны Android.

Почему рисуем, а не берём готовый: старый значок был тёмно-зелёный, а
приложение с тех пор стало лаймовым. Значок — первое, что человек видит
при установке; если он не совпадает с приложением, это выглядит как
чужая программа.

Замысел: тёмная плитка (как фон приложения), на ней лаймовая буква «A»,
перечёркнутая восходящей линией — учёт денег, который растёт. Мотив
взят от прежнего значка, чтобы приложение осталось узнаваемым.

Запуск:  python3 android/make-icons.py
"""
from PIL import Image, ImageDraw
import os, math

BG    = (10, 10, 14, 255)      # фон приложения
LIME  = (197, 248, 42, 255)    # фирменный лайм
LIME2 = (150, 220, 30, 255)    # тень лайма, чтобы знак не был плоским
OUT   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')

def rounded(size, radius_ratio=0.234):
    """Скруглённый квадрат — форма значков в Android."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=BG)
    return img

def draw_mark(img, size, pad_ratio=0.26):
    """Буква «A» — и больше ничего.

    Две попытки до этого были сложнее: сначала линия графика поверх
    буквы, потом нога, уходящая стрелкой вверх. Обе читались на большом
    экране и разваливались на 48 точках — размере значка в списке
    приложений: первая в лаймовое пятно, вторая в «AV».

    Значок обязан узнаваться размером с ноготь. Поэтому здесь один
    знак, крупно и без украшений. Смысл несёт цвет: лайм на чёрном —
    то же, что человек видит, открыв приложение.
    """
    d = ImageDraw.Draw(img)
    p = size * pad_ratio
    w = size - 2*p
    h = size - 2*p
    thick = max(2, int(w * 0.19))

    apex  = (size/2,      p)
    left  = (p,           size - p)
    right = (size - p,    size - p)

    d.line([apex, left],  fill=LIME, width=thick, joint='curve')
    d.line([apex, right], fill=LIME, width=thick, joint='curve')

    # Перекладина. Ставим на 64% высоты и с отступом от ног: вплотную
    # к краям она сливается с ними в сплошной треугольник.
    ty = p + h*0.64
    k  = (ty - apex[1]) / (left[1] - apex[1])
    x1 = apex[0] + (left[0]  - apex[0]) * k
    x2 = apex[0] + (right[0] - apex[0]) * k
    inset = (x2 - x1) * 0.16
    d.line([(x1+inset, ty), (x2-inset, ty)], fill=LIME, width=max(2, int(thick*0.66)))

def make(size, adaptive=False):
    if adaptive:
        # Для «живых» значков Android обрезает края под форму телефона:
        # круг, квадрат, каплю. Поэтому рисунок держим в центре, с запасом,
        # иначе на части телефонов буква окажется срезанной.
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img); d.rectangle([0, 0, size, size], fill=BG)
        inner = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw_mark(inner, size, pad_ratio=0.30)
        img.alpha_composite(inner)
        return img
    img = rounded(size)
    draw_mark(img, size)
    return img

os.makedirs(OUT, exist_ok=True)
# Размеры, которые Android спрашивает у приложения
for name, px in [('mdpi',48), ('hdpi',72), ('xhdpi',96), ('xxhdpi',144), ('xxxhdpi',192)]:
    make(px).save(os.path.join(OUT, 'ic_launcher_%s.png' % name))
make(512).save(os.path.join(OUT, 'icon-512.png'))          # витрина и установка
make(432, adaptive=True).save(os.path.join(OUT, 'ic_launcher_foreground.png'))
make(1024).save(os.path.join(OUT, 'icon-1024.png'))        # запас на будущее
print('значков собрано:', len(os.listdir(OUT)))
