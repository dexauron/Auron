/* Разбор файла Excel в отдельном потоке.
 *
 * Файл выгрузки из 1С на 17 000 строк разбирается несколько секунд. Раньше это
 * происходило в том же потоке, что рисует экран: приложение на это время
 * замирало — не прокручивалось, не отвечало на нажатия, и владелец видел
 * «каталог завис». Здесь та же работа идёт в стороне, и экран остаётся живым.
 *
 * Поток классический (не модуль): нужен importScripts, чтобы подтянуть
 * разборщик из vendor/ — тот самый файл, который лежит рядом, а не на чужом
 * сайте. Ошибки не глотаем: отправляем обратно, чтобы показать понятный текст. */
self.onmessage = (e) => {
  const { buf, vendor } = e.data || {};
  try {
    if (!self.XLSX) self.importScripts(vendor);
    const wb = self.XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = self.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    self.postMessage({ rows });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
