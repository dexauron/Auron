// Окно публикации: человек должен понимать, что делать, а не искать кнопку.
/* Кнопку «Опубликовать» раньше прятали, пока нет ключа. Владелец открыл этот
 * экран и спросил: «а где кнопка публиковать?» — спрятанная кнопка ничего не
 * объясняет. Теперь она на месте всегда, но без ключа не нажимается и прямо
 * говорит, чего не хватает. */
const { chromium, newPage, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОКНО ПУБЛИКАЦИИ');
  const { page, errs } = await newPage(b, { products: [], groups: [] });

  const openPub = async (token) => page.evaluate(async (t) => {
    const P = window.WM_PUBLISH;
    P.ghSetToken(t || '');
    // окно открывается по СМЕНЕ адреса, поэтому сначала уводим его прочь
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    window.location.hash = '';
    await new Promise((r) => setTimeout(r, 200));
    window.location.hash = '#publish';
    await new Promise((r) => setTimeout(r, 700));
    const pub = document.getElementById('ghPublishNow');
    return {
      status: document.getElementById('publishStatus').innerText.replace(/\s+/g, ' '),
      hidden: pub.hidden, disabled: pub.disabled, label: pub.textContent,
      clear: document.getElementById('ghTokenClear').hidden,
    };
  }, token);

  // ── 1. Ключа нет ──
  const no = await openPub('');
  chk(!no.hidden, 'кнопка «Опубликовать» на месте, даже когда ключа нет');
  chk(no.disabled, 'но нажать её нельзя — публиковать пока некуда');
  chk(/вставь ключ/i.test(no.label), `на самой кнопке написано, чего не хватает (${no.label})`);
  chk(/Ключа на этом телефоне нет/.test(no.status) && /кнопка «Опубликовать» заработает/.test(no.status),
    `объяснено словами, а не молчанием (${no.status.slice(0, 60)})`);
  chk(no.clear, 'кнопки «удалить ключ» нет — удалять нечего');

  // ── 2. Ключ вставлен ──
  const yes = await openPub('tok');
  chk(!yes.hidden && !yes.disabled, 'с ключом кнопка работает');
  chk(/Опубликовать витрину сейчас/.test(yes.label), `подпись обычная (${yes.label})`);
  chk(/Ключ на месте/.test(yes.status), 'сказано, что всё в порядке');
  chk(!yes.clear, 'появилась кнопка «удалить ключ с устройства»');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();
