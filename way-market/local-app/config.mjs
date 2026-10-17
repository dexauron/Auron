import path from 'node:path';

// Explicit modes avoid silently moving an existing per-user test database.
export function runtimeConfig(args, { platform, env, home }) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const personalDir = paths.join(env.LOCALAPPDATA || home, 'WayMarket-Test');
  if (args.length === 0) return {
    mode: 'personal-test', dataDir: personalDir,
    databasePath: paths.join(personalDir, 'cash-test.sqlite'),
    legacyDatabasePath: null, recovered: false, host: '127.0.0.1', port: 3210
  };
  if (args.length === 1 && args[0] === '--server-test') {
    if (platform !== 'win32') throw new Error('Серверный режим этого этапа предназначен для Windows');
    if (!env.ProgramData || !paths.isAbsolute(env.ProgramData) || /^[/\\]{2}/.test(env.ProgramData)) throw new Error('Не найден локальный абсолютный путь ProgramData');
    const dataDir = paths.join(env.ProgramData, 'WayMarket-Test');
    return { mode: 'server-test', dataDir, databasePath: paths.join(dataDir, 'cash-test.sqlite'),
      legacyDatabasePath: paths.join(personalDir, 'cash-test.sqlite'), recovered: false, host: '127.0.0.1', port: 3210 };
  }
  if (args.length === 2 && args[0] === '--recovered-test' && paths.isAbsolute(args[1]) && !/^[/\\]{2}/.test(args[1])) {
    return { mode: 'recovered-test', dataDir: paths.dirname(args[1]), databasePath: args[1],
      legacyDatabasePath: null, recovered: true, host: '127.0.0.1', port: 3210 };
  }
  throw new Error('Допустимы: без параметров; --server-test; --recovered-test "абсолютный локальный путь.sqlite"');
}

export function verifyStorageChoice(config, exists) {
  if (config.recovered && !exists(config.databasePath)) throw new Error('Не найден файл восстановленной базы');
  if (config.mode === 'server-test' && !exists(config.databasePath) && exists(config.legacyDatabasePath)) {
    throw new Error('Найдена прежняя пользовательская тестовая база. Сначала создайте и проверьте архив, восстановите его в серверную папку. Пустая база вместо старых данных автоматически не создаётся.');
  }
}
