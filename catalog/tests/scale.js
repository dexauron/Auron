// Штрихкод с магазинных весов: «2 305940 003301».
/* Весы печатают этикетку и сами рисуют штрихкод: внутри лежит код товара и
 * вес. Снаружи такой код никому не известен — каждое взвешивание даёт новый,
 * поэтому обычный поиск по штрихкоду его не находил, хотя товар в каталоге
 * есть. Разобрано по настоящей этикетке владельца:
 *   23 | 05940 (код 5940) | 00330 (330 г) | 1 (контрольная цифра).
 * Здесь проверяем и разбор, и главную защиту: обычный штрихкод, который тоже
 * начинается с двойки, весовым притвориться не должен. */
const { chromium, newPage, runner } = require('./helpers');

const products = [
  // тот самый товар с этикетки: весовой, 550 ₽ за килограмм
  { id: 'w1', name: 'П/К Чеченская В/У', code: '5940', retail_price: 550, is_weighted: true,
    photos: [], barcodes: [], group_id: 'g1', stock_state: 'in' },
  // обычный штучный товар, штрихкод которого НАЧИНАЕТСЯ С ДВОЙКИ
  { id: 'n1', name: 'Кукла Арт.22810', code: '16819', retail_price: 415,
    photos: [], barcodes: ['2800000149956'], group_id: 'g1', stock_state: 'in' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ШТРИХКОД С ВЕСОВ');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Мясное' }] });

  // ── 1. Разбор этикетки ──
  const parsed = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    return {
      real: P._parseScale('2305940003301'),
      badSum: P._parseScale('2305940003302'),   // испорчена контрольная цифра
      notScale: P._parseScale('4600000000011'), // обычный штрихкод
      // «28…» — внутренний штрихкод магазина для товара без своего кода.
      // Он тоже начинается с двойки, но весы его не печатали
      otherPrefix: P._parseScale('2800000149956'),
      short: P._parseScale('23059400033'),      // не 13 цифр
      heavy: P._parseScale(P._ean13('23' + '05940' + '99999')), // 99,999 кг — так не бывает
    };
  });
  chk(parsed.real && parsed.real.code === '5940', `код товара прочитан (${parsed.real && parsed.real.code})`);
  chk(parsed.real && parsed.real.grams === 330, `вес прочитан (${parsed.real && parsed.real.grams} г)`);
  chk(!parsed.badSum, 'штрихкод с неверной контрольной цифрой не принимаем — это мусор от камеры');
  chk(!parsed.notScale, 'обычный штрихкод весовым не считаем');
  chk(!parsed.otherPrefix, 'внутренний штрихкод «28…» за весовой не принимаем — весы печатают «23»');
  chk(!parsed.short, 'обрезанный код не принимаем');
  chk(!parsed.heavy, 'неправдоподобный вес не принимаем');

  // ── 2. Поиск товара по этикетке ──
  const found = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    const scale = P._findByBarcode('2305940003301');
    const plain = P._findByBarcode('2800000149956');
    return {
      scaleName: scale && scale.p.name, scaleGrams: scale && scale.grams,
      plainName: plain && plain.p.name, plainGrams: plain && plain.grams,
    };
  });
  chk(found.scaleName === 'П/К Чеченская В/У', `по этикетке весов товар найден (${found.scaleName})`);
  chk(found.scaleGrams === 330, `вес этой упаковки известен (${found.scaleGrams} г)`);
  /* Главная защита: «2800000149956» тоже начинается с двойки, и если читать
     его как весовой, получится код 00001 и вес 49,956 кг. Товар должен
     находиться по своему настоящему штрихкоду, а не по выдуманному весу. */
  chk(found.plainName === 'Кукла Арт.22810', `обычный штрихкод с двойки находится как обычный (${found.plainName})`);
  chk(found.plainGrams === 0, 'у обычного штрихкода веса нет');

  // ── 3. Ценник: сумма по этикетке ──
  const tag = await page.evaluate(async () => {
    window.WM_PUBLISH._scanPrice('2305940003301');
    await new Promise((r) => setTimeout(r, 250));
    return document.getElementById('scanResult').innerText.replace(/\s+/g, ' ');
  });
  chk(/П\/К Чеченская/.test(tag), `на ценнике нужный товар (${tag.slice(0, 40)})`);
  chk(/550 ₽/.test(tag), 'видна цена за килограмм');
  chk(/0,33 кг/.test(tag), 'виден вес именно этой упаковки');
  chk(/181,5 ₽|181,50 ₽/.test(tag), `посчитана сумма к оплате (${(tag.match(/К оплате [^·]*/) || [''])[0].slice(0, 30)})`);

  /* ── 4. Сотруднику ценник вернули — но только на весовую этикетку ──
     Решение владельца: обычный ценник сотруднику не нужен, а вес и сумму по
     этикетке весов он сверяет постоянно. */
  const staff = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    P.applyServerless('pw');                       // как будто вошли
    document.getElementById('scanResult').innerHTML = '';
    P._scanSearch('2305940003301');                // режим «Товар» у сотрудника
    await new Promise((r) => setTimeout(r, 250));
    const tag = document.getElementById('scanResult').innerText.replace(/\s+/g, ' ');
    document.getElementById('scanResult').innerHTML = '';
    P._scanSearch('2800000149956');                // обычный штрихкод
    await new Promise((r) => setTimeout(r, 350));
    return { tag, card: document.getElementById('sheetName').textContent,
      plainTag: document.getElementById('scanResult').innerText.trim() };
  });
  chk(/К оплате/.test(staff.tag) && /181/.test(staff.tag),
    `сотрудник по весовой этикетке видит сумму (${staff.tag.slice(0, 40)})`);
  chk(/Кукла/.test(staff.card), `по обычному штрихкоду сотруднику открывается карточка (${staff.card})`);
  chk(!staff.plainTag, 'по обычному штрихкоду ценник сотруднику не показывается');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
