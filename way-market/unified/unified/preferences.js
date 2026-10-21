export const defaults=Object.freeze({theme:'system',textSize:'normal',lastModule:'workspace'});
export function preferenceValues(value,fallback=defaults){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return {theme:['system','light','dark'].includes(v.theme)?v.theme:fallback.theme,textSize:['normal','large'].includes(v.textSize)?v.textSize:fallback.textSize,lastModule:['workspace','catalog','finance'].includes(v.lastModule)?v.lastModule:fallback.lastModule,_version:Number.isSafeInteger(v._version)&&v._version>=0?v._version:0};
}
export function samePrincipal(a,b){return Boolean(a&&b&&a.id===b.id&&a.version===b.version);}
export function browserStorage(host=globalThis){return {
 get(key){try{return host.localStorage?.getItem(key)??null;}catch{return null;}},
 set(key,value){try{host.localStorage?.setItem(key,value);return true;}catch{return false;}},
 remove(key){try{host.localStorage?.removeItem(key);}catch{}},
 keys(){try{return Object.keys(host.localStorage||{});}catch{return [];}}
};}
export function deviceIdentifier(storage,serverId,randomUUID){
 const saved=storage.get('way_device_id');
 const id=typeof saved==='string'&&/^(?:[a-f0-9]{32}|[a-f0-9-]{36})$/.test(saved)?saved:serverId||randomUUID();
 storage.set('way_device_id',id);return id;
}
export function rememberedModule(prefs,user,url){
 if(url.pathname!=='/'||url.search)return null;
 if(prefs.lastModule==='catalog')return '/catalog/';
 if(prefs.lastModule==='finance'&&['owner','accountant'].includes(user.role))return '/finance/';
 return null;
}
