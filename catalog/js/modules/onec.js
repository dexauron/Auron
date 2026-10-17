// Выгрузка списка покупок в 1С — по шаблону «Загрузки из файла»

/* Владелец прислал шаблон своей 1С: один лист, одна строка заголовков, девять
 * колонок в строгом порядке. Любое отклонение — и «Заполнить → Загрузить из
 * файла» либо не найдёт колонку, либо подставит не туда, а на выходе будет
 * неверный расходник. Поэтому заголовки живут здесь ОДНОЙ константой и
 * повторяются во всех способах выгрузки.
 *
 * Два способа нарочно:
 *   • «Скопировать» — строки уходят в буфер через табуляцию. Такое вставляется
 *     в Excel прямо по колонкам, без «импорта текста». Это главный способ:
 *     владелец работает в 1С за компьютером, а список собирается на телефоне.
 *   • «Скачать файл» — настоящий .xlsx. Нужен, когда 1С просит именно файл.
 *     Разборщик Excel у нас уже есть (им читаются выгрузки), он же умеет и
 *     писать; качается он только по требованию, первый заход не задерживает.
 *
 * Колонку «Всего» НЕ заполняем: в шаблоне она последняя и, что в неё кладёт
 * 1С, по одному заголовку не понять. Пустая колонка импорту не мешает, а
 * выдуманное число превратилось бы в неверный документ. */

import { state } from './store.js';
import { toast } from './core.js';
import { loadScript } from './scanner.js';

// Порядок и написание — ровно как в шаблоне владельца. Не менять на глаз.
export const ONEC_COLUMNS = ['Код', 'Штрих-код', 'Наименование номенклатуры', 'Артикул',
  'Наименование единицы', 'Количество', 'Розничная цена', 'Розничная сумма', 'Всего'];

/* Строка товара для 1С. Берём из самого товара, а чего нет — из записи списка:
 * товар мог уйти из каталога после очередной выгрузки, а заявка должна
 * остаться читаемой и через полгода. */
export function onecRow(item) {
  const p = (state.products || []).find((x) => x.id === item.id) || {};
  const qty = Number(item.qty) || 0;
  const price = Number(item.price != null && item.price !== '' ? item.price : p.retail_price) || 0;
  const unit = item.unit || (p.is_weighted ? 'кг' : (p.unit || 'шт'));
  return [
    item.code || p.code || '',
    item.barcode || (p.barcodes || [])[0] || '',
    item.name || p.name || '',
    item.article || p.article || '',
    unit,
    qty,
    price || '',
    price ? Math.round(price * qty * 100) / 100 : '',
    '',                                  // «Всего» — см. пояснение выше
  ];
}

const rowsOf = (items) => items.filter((x) => Number(x.qty) > 0).map(onecRow);

/* Для буфера обмена: табуляция между колонками, перевод строки между строками.
 * Числа пишем с запятой — в русском Excel точка в «89.5» превращается в дату. */
function toTsv(items) {
  const num = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : String(v));
  return [ONEC_COLUMNS.join('\t'), ...rowsOf(items).map((r) => r.map(num).join('\t'))].join('\n');
}

export async function copyForOnec(items) {
  const rows = rowsOf(items);
  if (!rows.length) { toast('Нечего копировать — в списке нет количества'); return false; }
  try {
    await navigator.clipboard.writeText(toTsv(items));
    toast(`Скопировано ${rows.length} строк — вставь в Excel или сразу в 1С`);
    return true;
  } catch (e) { toast('Браузер не дал скопировать. Открой список на компьютере'); return false; }
}

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return loadScript('vendor/xlsx.min.js')
    .catch(() => loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'));
}

// Имя файла с датой: в папке «Загрузки» их будет много, и они не должны слипнуться
const fileName = (title) => `${title} ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');

export async function downloadForOnec(items, title = 'Список покупок') {
  const rows = rowsOf(items);
  if (!rows.length) { toast('Нечего выгружать — в списке нет количества'); return false; }
  try {
    await loadXlsx();
    const ws = window.XLSX.utils.aoa_to_sheet([ONEC_COLUMNS, ...rows]);
    // ширины колонок: иначе названия товаров слипаются в один столбик
    ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 46 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Лист_1');   // лист назван как в шаблоне
    window.XLSX.writeFile(wb, fileName(title));
    toast(`Файл на ${rows.length} строк сохранён`);
    return true;
  } catch (e) { toast('Не получилось собрать файл: ' + (e && e.message ? e.message : 'ошибка')); return false; }
}
