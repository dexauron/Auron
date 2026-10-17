import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, verifyStorageChoice } from './config.mjs';

const windows = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Adam\\AppData\\Local', ProgramData: 'C:\\ProgramData' }, home: 'C:\\Users\\Adam' };
test('previous launch still uses the same personal test DB', () => {
  assert.equal(runtimeConfig([], windows).databasePath, 'C:\\Users\\Adam\\AppData\\Local\\WayMarket-Test\\cash-test.sqlite');
});
test('server mode storage is independent of interactive Windows user', () => {
  const a = runtimeConfig(['--server-test'], windows);
  const b = runtimeConfig(['--server-test'], { ...windows, env: { ...windows.env, LOCALAPPDATA: 'C:\\Users\\Other\\AppData\\Local' }, home: 'C:\\Users\\Other' });
  assert.equal(a.databasePath, 'C:\\ProgramData\\WayMarket-Test\\cash-test.sqlite');
  assert.equal(a.databasePath, b.databasePath);
  assert.equal(a.host, '127.0.0.1'); assert.equal(a.port, 3210);
});
test('server mode rejects missing/relative/network ProgramData', () => {
  for (const ProgramData of ['', 'relative', '\\\\server\\share']) assert.throws(() => runtimeConfig(['--server-test'], { ...windows, env: { ProgramData } }));
  assert.throws(() => runtimeConfig(['--server-test'], { platform: 'linux', env: {}, home: '/tmp' }));
});
test('unsupported args cannot open the service on LAN', () => {
  for (const args of [['--host', '0.0.0.0'], ['--port', '80'], ['--server-test', '--recovered-test', 'C:\\copy.sqlite'], ['--recovered-test', 'relative.sqlite'], ['--recovered-test', '\\\\server\\copy.sqlite']]) assert.throws(() => runtimeConfig(args, windows));
});
test('old test data must not be silently replaced by a new empty server DB', () => {
  const c = runtimeConfig(['--server-test'], windows);
  assert.throws(() => verifyStorageChoice(c, p => p === c.legacyDatabasePath), /прежняя/);
  assert.doesNotThrow(() => verifyStorageChoice(c, () => false));
  assert.doesNotThrow(() => verifyStorageChoice(c, () => true));
});
test('recovered database path is explicit and must exist', () => {
  const c = runtimeConfig(['--recovered-test', 'C:\\test\\restored.sqlite'], windows);
  assert.equal(c.databasePath, 'C:\\test\\restored.sqlite'); assert.equal(c.recovered, true);
  assert.throws(() => verifyStorageChoice(c, () => false));
  assert.doesNotThrow(() => verifyStorageChoice(c, () => true));
});
