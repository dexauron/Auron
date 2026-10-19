import { isIP } from 'node:net';
import { createServer as tlsServer, connect, createSecureContext, checkServerIdentity } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute,dirname } from 'node:path';

export function privateIPv4(value) {
  if (typeof value !== 'string' || isIP(value) !== 4) return false;
  const [a,b] = value.split('.').map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}
const loopback = value => value === '127.0.0.1';
export function validateNetworkConfig(raw) {
  const keys = ['version','bindAddress','port','publicOrigin','clientAddresses','pfxPath','certificatePath','caPath','maxBackupAgeMinutes'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== keys.length || !keys.every(k => Object.hasOwn(raw,k)) || raw.version !== 1) throw new Error('Неверная конфигурация HTTPS');
  if ((!privateIPv4(raw.bindAddress) && !loopback(raw.bindAddress)) || !Number.isSafeInteger(raw.port) || raw.port < 1024 || raw.port > 65535) throw new Error('Укажите конкретный локальный IPv4 и порт 1024–65535');
  let url; try { url = new URL(raw.publicOrigin); } catch { throw new Error('Неверный адрес HTTPS'); }
  if (url.protocol !== 'https:' || url.hostname !== raw.bindAddress || Number(url.port || 443) !== raw.port || url.origin !== raw.publicOrigin) throw new Error('Адрес HTTPS должен точно соответствовать IP и порту');
  if (!Array.isArray(raw.clientAddresses) || raw.clientAddresses.length < 1 || raw.clientAddresses.length > 32 || new Set(raw.clientAddresses).size !== raw.clientAddresses.length || raw.clientAddresses.some(a => !privateIPv4(a) && !loopback(a))) throw new Error('Укажите от 1 до 32 отдельных локальных IP устройств; подсети не допускаются');
  for (const key of ['pfxPath','certificatePath','caPath']) if (typeof raw[key] !== 'string' || !isAbsolute(raw[key]) || /[\x00-\x1f]/.test(raw[key])) throw new Error('Пути сертификатов должны быть абсолютными');
  if (dirname(raw.pfxPath) !== dirname(raw.certificatePath) || dirname(raw.pfxPath) !== dirname(raw.caPath) || new Set([raw.pfxPath,raw.certificatePath,raw.caPath]).size !== 3) throw new Error('TLS-файлы должны быть разными и находиться в одной защищённой папке');
  if (!Number.isSafeInteger(raw.maxBackupAgeMinutes) || raw.maxBackupAgeMinutes < 10 || raw.maxBackupAgeMinutes > 10080) throw new Error('Проверьте предельный возраст проверенной копии');
  return Object.freeze({ ...raw, clientAddresses: Object.freeze([...raw.clientAddresses]) });
}
export function allowedNetworkPeer(address, config) {
  const ip = address?.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === config.bindAddress || loopback(ip) || config.clientAddresses.includes(ip);
}
async function boundedFile(path, limit, secret = false) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > limit) throw new Error('Неверный тип или размер файла настройки HTTPS');
  if (secret && process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Закройте доступ других пользователей к PFX и настройке HTTPS');
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('Файл HTTPS изменён во время чтения');
  return bytes;
}
export async function readNetworkConfig(path) {
  if (!isAbsolute(path)) throw new Error('Укажите абсолютный путь конфигурации HTTPS');
  let raw; try { raw = JSON.parse((await boundedFile(path,16384,true)).toString('utf8')); } catch { throw new Error('Не удалось прочитать закрытую конфигурацию HTTPS'); }
  return validateNetworkConfig(raw);
}
function certificateDate(cert, now) {
  const from = Date.parse(cert.validFrom), until = Date.parse(cert.validTo);
  if (!Number.isSafeInteger(now) || !Number.isFinite(from) || !Number.isFinite(until) || now < from || now + 86400000 >= until) throw new Error('Сертификат ещё не действует, истёк или требует замены в течение суток');
}
export async function loadNetworkTransport(config, passphrase, { clock = Date.now } = {}) {
  config = validateNetworkConfig(config);
  if (typeof passphrase !== 'string' || [...passphrase].length < 15 || [...passphrase].length > 128 || /[\x00-\x1f]/.test(passphrase)) throw new Error('Пароль PFX: 15–128 символов');
  const pfx = await boundedFile(config.pfxPath,1048576,true);
  const leaf = new X509Certificate(await boundedFile(config.certificatePath,65536));
  const ca = new X509Certificate(await boundedFile(config.caPath,65536));
  const now = clock(); certificateDate(leaf,now); certificateDate(ca,now);
  if (leaf.ca || !ca.ca || !ca.verify(ca.publicKey) || !leaf.verify(ca.publicKey) || !leaf.checkIssued(ca) || !leaf.checkIP(config.bindAddress) || !leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) throw new Error('Нужна цепочка локального центра и серверного сертификата для выбранного IP');
  for (const c of [leaf,ca]) {
    const key = c.publicKey, detail = key.asymmetricKeyDetails;
    if (!(key.asymmetricKeyType === 'rsa' && detail.modulusLength >= 2048 || key.asymmetricKeyType === 'ec' && ['prime256v1','secp384r1'].includes(detail.namedCurve))) throw new Error('Неподдерживаемый или слабый ключ сертификата');
  }
  const tlsOptions = { pfx, passphrase, minVersion:'TLSv1.2', handshakeTimeout:10000 };
  try { createSecureContext(tlsOptions); } catch { throw new Error('PFX не открыт: проверьте файл и пароль'); }
  // Prove that the PFX actually serves this leaf and trusted chain, before LAN bind.
  const probe = tlsServer(tlsOptions, socket => socket.end());
  probe.on('tlsClientError', () => {});
  await new Promise((resolve,reject) => { probe.once('error',reject); probe.listen(0,'127.0.0.1',resolve); });
  let client;
  try {
    await new Promise((resolve,reject) => {
      client = connect({host:'127.0.0.1',port:probe.address().port,ca:ca.toString(),rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_,cert)=>checkServerIdentity(config.bindAddress,cert)}, () => {
        if (!client.authorized || client.getPeerX509Certificate()?.fingerprint256 !== leaf.fingerprint256) return reject(new Error('Сертификат PFX не совпадает с проверенным серверным сертификатом'));
        resolve();
      });
      client.once('error',reject); client.setTimeout(5000,()=>{ client.destroy(); reject(new Error('Проверка PFX превысила время ожидания')); });
    });
  } catch { throw new Error('PFX, сертификат, доверенный центр или IP не прошли пробное TLS-соединение'); }
  finally { client?.destroy(); await new Promise(r=>probe.close(r)); }
  return { config, tlsOptions, certificateFingerprint:leaf.fingerprint256, caFingerprint:ca.fingerprint256, expiresAt:leaf.validTo };
}
