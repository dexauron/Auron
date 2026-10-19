import { emitKeypressEvents } from 'node:readline';

// Interactive console only: no password argument, file, environment or echo.
export function askSecret(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('Для пароля PFX нужно интерактивное окно терминала');
  return new Promise((resolve,reject) => {
    let value = ''; const wasRaw = input.isRaw, wasPaused = input.isPaused();
    const done = (error) => { input.off('keypress',key); input.setRawMode(Boolean(wasRaw)); if (wasPaused) input.pause(); output.write('\n'); error ? reject(error) : resolve(value); value = ''; };
    const key = (text, k = {}) => {
      if (k.ctrl && k.name === 'c') return done(new Error('Запуск отменён'));
      if (k.name === 'return' || k.name === 'enter') return done();
      if (k.name === 'backspace') { value = [...value].slice(0,-1).join(''); return; }
      if (!k.ctrl && !k.meta && text && !/[\x00-\x1f\x7f]/.test(text) && [...value,...text].length <= 128) value += text;
    };
    output.write(prompt); emitKeypressEvents(input); input.setRawMode(true); input.on('keypress',key); input.resume();
  });
}
