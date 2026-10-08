#!/usr/bin/env python3
"""Нейтральные значки для заготовки: однотонный квадрат цвета ACCENT.
Своих библиотек для картинок в контейнере нет, поэтому PNG пишем сами —
это полтора десятка строк и ноль зависимостей. Человек потом положит свой."""
import struct, zlib, sys, os

def png(path, size, rgb):
    raw = b''
    row = bytes(rgb) * size
    for _ in range(size):
        raw += b'\x00' + row                      # 0 = фильтр «без фильтра»
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)   # 8 бит, truecolor
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

if __name__ == '__main__':
    out = sys.argv[1]
    rgb = (0x2F, 0x6F, 0xED)        # тот же цвет, что ACCENT в заготовке
    os.makedirs(out, exist_ok=True)
    for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
        png(os.path.join(out, name), size, rgb)
    print('значки собраны:', out)
