// Стенд для проверок входа и шифрования: настоящий Web Crypto, никакой сети и
// никаких данных магазина. Модули publish.js запускаются в изолированном
// контексте (vm), а GitHub, localStorage и база устройства — подставные.
//
// Живёт отдельным файлом, потому что им пользуются два набора: security-node
// (границы данных) и session-keep (вход держится, пока сам не выйдешь).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

const root = path.join(__dirname, '..', '..');
function harness() {
  const files = new Map(), blobs = new Map(), disk = new Map();
  const state = { isAdmin: true, serverless: true, products: [{ id: 'p1', name: 'Товар', code: '001',
    barcodes: ['00123'], photos: [], stock: 7, supplier_ids: ['s1'] }], groups: [],
    suppliers: [{ id: 's1', name: 'Поставщик' }], prices: [{ product_id: 'p1', price: 123 }],
    sales: [], contacts: { s1: { phone: 'fixture' } }, orders: [], requests: [{ private: 'owner-only' }],
    staffPassword: 'fixture-staff-password', popularity: {} };
  let n = 0;
  const local = new Map();
  const ctx = { state, ui: { secretPw: 'fixture-owner-password' },
    CFG: { DATA_PATH: 'data', STATIC_URL: 'data/', GITHUB_OWNER: 'fixture', GITHUB_REPO: 'fixture' },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, URL, Blob, Response,
    CompressionStream, DecompressionStream, AbortController, setTimeout, clearTimeout, networkDown: false,
    console, structuredClone, requestIdleCallback: () => {},
    $: () => ({ hidden: false, classList: { toggle() {} } }),
    localStorage: { getItem: k => local.get(k) || null, setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) },
    idbGet: async k => disk.get(k), idbSet: async (k,v) => disk.set(k, structuredClone(v)), idbDelete: async k => disk.delete(k),
    CACHE_KEY: 'fixture-public', norm: x => String(x || '').toLowerCase(), toast() {}, buildIndex() {}, renderAll() {},
    tidyMemory() {}, autoDedup() {}, saveCache() {}, byName: (a,b) => a.name.localeCompare(b.name),
    partName: i => String(i).padStart(2,'0'), digest: async s => createHash('sha256').update(s).digest('hex'),
    shard: (a,n) => Array.from({length:n}, (_,i) => i===0 ? a : []),
    pool: async (a,n,fn) => Promise.all(a.map(fn)),
    fetch: async (url, opts = {}) => {
      if (ctx.networkDown) throw new TypeError('fixture offline');
      const response = (s,v) => ({ status:s, ok:s>=200&&s<300, text:async()=>typeof v==='string'?v:JSON.stringify(v), json:async()=>typeof v==='string'?JSON.parse(v):v });
      const u = String(url);
      if (u.includes('api.github.com')) {
        const body = opts.body ? JSON.parse(opts.body) : {};
        if (u.includes('/git/ref/heads/')) return response(200,{object:{sha:'base'}});
        if (u.includes('/git/commits/') && !opts.method) return response(200,{tree:{sha:'tree'}});
        if (u.endsWith('/git/blobs')) { const sha='b'+(++n); blobs.set(sha,body.content); return response(200,{sha}); }
        if (u.endsWith('/git/trees')) { for(const e of body.tree) e.sha===null?files.delete(e.path):files.set(e.path,blobs.get(e.sha)); return response(200,{sha:'tree'}); }
        return response(200,{sha:'commit'});
      }
      const key = 'data/' + u.split('data/').pop().split('?')[0];
      return files.has(key) ? response(200,files.get(key)) : response(404,'missing');
    },
  };
  vm.createContext(ctx);
  for (const file of ['publication-data.js','catalog-crypto.js','publish.js']) {
    const p = path.join(root,'js/modules',file);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p,'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+/g,''),ctx,{filename:file});
  }
  vm.runInContext('globalThis.api = { publishFull, unlockAny, unlockSecret, unlockStaff, buildPublicProducts, encryptJSON, decryptJSON, applyServerless, applyStaff, clearSvAuth, rememberSession, restoreSession, restoreFast, recheckAccess, keepStorage }; globalThis.cryptoTest = { unwrapCatalogKey, importCatalogKey, keyDecrypt, keyEncrypt };',ctx);
  return {ctx,files,disk,local,state,api:ctx.api};
}

module.exports = { harness };
