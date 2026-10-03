// Публикация по частям: каталог режется на куски, обновляются только изменившиеся

/* Раньше любая мелочь (одна цена, одно фото) переписывала каталог целиком —
 * витрину на 4,7 МБ и два зашифрованных файла по 17 МБ. Теперь каталог лежит
 * кусками: у каждого куска есть короткая подпись содержимого, и на GitHub
 * уезжают только те куски, чья подпись изменилась. */

// Стабильный номер куска: зависит ТОЛЬКО от id товара, не от порядка в списке
// и не от соседей. Поэтому добавление товара трогает один кусок, а не сдвигает
// границы всех остальных (иначе «по частям» не дало бы никакой экономии).
function partIndex(id, n) {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}

// разложить список по n кускам
export function shard(list, n, key) {
  const out = Array.from({ length: n }, () => []);
  for (const it of list || []) out[partIndex(key(it), n)].push(it);
  return out;
}

export const partName = (i) => String(i).padStart(2, '0');

// Короткая подпись содержимого. По ней сравниваем «что лежит на GitHub» и «что
// получилось сейчас»: совпало — кусок не трогаем.
export async function digest(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < 8; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

// Выполняем задачи пачками: по одной — долго (десятки кусков подряд), все разом
// — GitHub отвечает ошибкой и обрывает публикацию.
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
