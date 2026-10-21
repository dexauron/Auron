import { newRequestId } from '/request-id.mjs';
import {installLayout,removeLayout} from '/unified/layout.js';
import {defaults,preferenceValues,samePrincipal,browserStorage,deviceIdentifier,rememberedModule} from '/unified/preferences.js';
const storage=browserStorage(window);
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('way-workspace-session'):null;
const current=location.pathname.startsWith('/catalog/')?'catalog':location.pathname.startsWith('/finance/')?'finance':'workspace';
let session=null,deviceId=null,prefs=preferenceValues(null),disposeLayout=null,mountPromise=null,mountAgain=false,generation=0;
const media=matchMedia('(prefers-color-scheme:dark)');
function showError(error){
 let note=document.getElementById('wm-state-note');
 if(!note){note=document.createElement('p');note.id='wm-state-note';note.className='wm-state-note';note.setAttribute('role','alert');document.body.append(note);}
 note.textContent=error.message||'Нет связи с сервером. Сохранение не подтверждено.';
}
function clearError(){document.getElementById('wm-state-note')?.remove();}
function clearPrivate(){
 for(const key of storage.keys())if(/^(wm_|auron_)/.test(key))storage.remove(key);
 try{window.indexedDB?.deleteDatabase('wm_catalog_db');}catch{}
}
function detach(){generation++;disposeLayout?.();disposeLayout=null;removeLayout();document.getElementById('wm-panel')?.remove();document.body.classList.remove('wm-unified');delete document.body.dataset.wmModule;}
async function fetchSession(){const r=await fetch('/api/session',{cache:'no-store'});if(!r.ok)throw Error('Не удалось проверить вход. Повторите после восстановления связи.');return r.json();}
async function api(path,data,principal=session?.user){
 if(!principal||!samePrincipal(principal,session?.user))throw Error('Аккаунт изменился. Откройте профиль заново.');
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Way-Token':session.csrf,'X-Way-Account':principal.id},body:JSON.stringify(data)});
 const out=await r.json();if(!r.ok){const e=Error(out.error||'Сохранение не подтверждено');e.status=r.status;throw e;}return out;
}
function apply(){
 const theme=prefs.theme==='system'?(media.matches?'dark':'light'):prefs.theme;
 document.documentElement.dataset.wmTheme=theme;document.documentElement.dataset.wmSize=prefs.textSize;document.documentElement.style.colorScheme=theme;
 if(current!=='workspace')document.documentElement.dataset.theme=theme;
 if(current==='catalog'){if(prefs.theme==='system')storage.remove('wm_theme');else storage.set('wm_theme',prefs.theme);}
}
async function savePreferences(patch,principal=session?.user){
 const next=preferenceValues({...prefs,...patch,lastModule:current}),issued=generation;
 const value={theme:next.theme,textSize:next.textSize,lastModule:next.lastModule};
 const out=await api('/api/unified/preferences',{deviceId,save:true,expectedVersion:prefs._version,value},principal);
 if(issued!==generation||!samePrincipal(principal,session?.user))throw Error('Аккаунт изменился. Настройки этого экрана не применены.');
 prefs=preferenceValues(out);storage.set('way_preferences_'+principal.id,JSON.stringify(prefs));apply();clearError();return prefs;
}
async function logout(){
 const r=await api('/api/logout',{});if(!r.loggedOut)throw Error('Выход не подтверждён сервером. Повторите попытку.');
 detach();clearPrivate();session=null;channel?.postMessage('changed');location.replace('/');
}
function safeAction(action){return async()=>{try{await action();}catch(e){showError(e);}};}
async function settings(){
 if(!session?.user||document.getElementById('wm-panel'))return;
 const principal=session.user,issued=generation,panel=document.createElement('section'),returnFocus=document.getElementById('wm-profile');
 panel.id='wm-panel';panel.className='wm-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Профиль и настройки');
 panel.innerHTML='<h2>Настройки профиля</h2><p class="wm-person"></p><label>Оформление<select id="wm-theme"><option value="system">Как на устройстве</option><option value="light">Светлое</option><option value="dark">Тёмное</option></select></label><label>Размер текста<select id="wm-size"><option value="normal">Обычный</option><option value="large">Крупный</option></select></label><p>Вход сохранён на этом устройстве. Автоматического выхода по бездействию нет.</p><p class="wm-error" role="alert"></p><p><a href="/?account=1">Пароль и настройки аккаунта</a></p><button id="wm-save">Сохранить</button> <button id="wm-close">Закрыть</button> <button id="wm-logout">Выйти</button>';
 const close=()=>{panel.remove();returnFocus?.focus();};
 document.body.append(panel);panel.querySelector('.wm-person').textContent=principal.name;panel.querySelector('#wm-theme').value=prefs.theme;panel.querySelector('#wm-size').value=prefs.textSize;
 panel.querySelector('#wm-close').onclick=close;panel.querySelector('#wm-logout').onclick=safeAction(logout);
 panel.querySelector('#wm-save').onclick=async()=>{
  const button=panel.querySelector('#wm-save');button.disabled=true;
  try{await savePreferences({theme:panel.querySelector('#wm-theme').value,textSize:panel.querySelector('#wm-size').value},principal);close();}
  catch(e){if(issued!==generation)return;panel.querySelector('.wm-error').textContent=e.message;if(e.status===409){try{const latest=await api('/api/unified/preferences',{deviceId,save:false},principal);prefs=preferenceValues(latest);panel.querySelector('.wm-error').textContent+=' Ваш выбор оставлен в полях. Повторное сохранение применит его к свежей версии.';}catch{}}}
  finally{button.disabled=false;}
 };
 panel.querySelector('select').focus();panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const items=[...panel.querySelectorAll('button,select,a')].filter(x=>!x.disabled),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
}
async function mountInner(){
 const next=await fetchSession();
 if(current!=='workspace'&&(!next.user||(session?.user&&!samePrincipal(next.user,session.user)))){
  document.documentElement.style.visibility='hidden';document.body.replaceChildren();detach();clearPrivate();session=next;location.replace('/?view=home');return;
 }
 if(!next.user){if(session?.user||document.getElementById('wm-topbar')){detach();clearPrivate();}session=next;if(current!=='workspace')location.replace('/');return;}
 if(document.getElementById('wm-topbar')&&samePrincipal(next.user,session?.user)){session=next;return;}
 detach();session=next;const issued=generation,principal=next.user;
 const identity=principal.id+':'+principal.version,previous=storage.get('way_last_identity'),oldUser=storage.get('way_last_user');
 if(previous&&previous!==identity||oldUser&&oldUser!==principal.id)clearPrivate();
 storage.set('way_last_identity',identity);storage.set('way_last_user',principal.id);deviceId=deviceIdentifier(storage,next.deviceId,()=>newRequestId());
 let local=null;try{local=JSON.parse(storage.get('way_preferences_'+principal.id)||'null');}catch{}
 prefs=preferenceValues(local);let loaded=false;
 try{prefs=preferenceValues(await api('/api/unified/preferences',{deviceId,save:false},principal));loaded=true;clearError();}catch(e){showError(e);}
 if(issued!==generation||!samePrincipal(principal,session?.user))return;
 const target=loaded&&rememberedModule(prefs,principal,new URL(location.href));if(target){location.replace(target);return;}
 apply();document.body.classList.add('wm-unified');
 const nav=document.createElement('header');nav.id='wm-topbar';nav.className='wm-topbar';nav.innerHTML='<a class="wm-wordmark" href="/?view=home">way<span>market</span></a><button class="wm-profile-name" id="wm-profile"></button><button class="wm-exit" id="wm-exit">Выйти</button>';
 nav.querySelector('#wm-profile').textContent=principal.name;nav.querySelector('#wm-profile').onclick=safeAction(settings);nav.querySelector('#wm-exit').onclick=safeAction(logout);document.body.prepend(nav);
 disposeLayout=installLayout({user:principal,current,navigate:page=>window.wayNavigate?.(page)});
 if(loaded&&prefs.lastModule!==current){try{await savePreferences({lastModule:current},principal);}catch(e){showError(e);}}
}
function mount(){if(mountPromise){mountAgain=true;return mountPromise;}mountPromise=mountInner().finally(()=>{mountPromise=null;if(mountAgain){mountAgain=false;queueMicrotask(()=>{mount().catch(showError);});}});return mountPromise;}
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,options)=>{
 const response=await nativeFetch(input,options);
 let url;try{url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);}catch{return response;}
 if(response.ok&&url.origin===location.origin&&['/api/logout','/api/password','/api/login','/api/users/update'].includes(url.pathname)){channel?.postMessage('changed');queueMicrotask(()=>{mount().catch(showError);});}
 return response;
};
channel?.addEventListener('message',()=>{mount().catch(showError);});
if(current!=='workspace'){addEventListener('focus',()=>{mount().catch(showError);});setInterval(()=>{if(!document.hidden)mount().catch(showError);},30000);}
addEventListener('pageshow',async event=>{if(!event.persisted)return;const old=document.body.style.visibility;document.body.style.visibility='hidden';try{await mount();}catch(e){showError(e);}finally{document.body.style.visibility=old;}});
media.addEventListener('change',()=>{if(prefs.theme==='system')apply();});
window.waySetTheme=safeAction(async()=>{await savePreferences({theme:prefs.theme==='system'?'dark':prefs.theme==='dark'?'light':'system'});});
document.title=(current==='catalog'?'Каталог':current==='finance'?'Финансы':'Работа')+' · Way Market';
if(current==='workspace'){const observer=new MutationObserver(()=>{if(!document.getElementById('wm-topbar')&&document.getElementById('app')?.hidden===false)mount().catch(showError);});observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:['hidden']});}
await mount().catch(showError);

window.wayLogout=safeAction(logout);
