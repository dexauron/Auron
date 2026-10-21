const iconPaths={onec:'M4 6h16v12H4ZM7 9h10M7 12h6',calendar:'M4 5h16v16H4ZM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2',home:'M3 10 12 3l9 7v10H3ZM9 20v-7h6v7',catalog:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',procurement:'M3 5h3l2 12h11l2-8H7M9 21h.01M18 21h.01',finance:'M3 6h18v14H3ZM3 6l14-3v3M16 12h5v5h-5Z',cash:'M4 4h16v17H4ZM7 8h10M7 12h3M14 12h3M7 16h3M14 16h3',tasks:'M8 5h12v16H4V5h4M8 3h8v4H8ZM8 12l2 2 5-5',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-4',backups:'M4 4h16v16H4ZM8 4v6h8V4M8 20v-6h8v6',security:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-5',menu:'M4 6h16M4 12h16M4 18h16'};
function svg(id){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+iconPaths[id]+'"/></svg>';}
export function removeLayout(doc=document){
 for(const node of doc.querySelectorAll('#wm-topbar,#wm-sidebar,.wm-mobile-nav,.wm-nav-shade,.wm-finance-tabs,.wm-catalog-settings'))node.remove();
}
export function installLayout({user,current,navigate}){
 const scope=new AbortController();
 document.body.dataset.wmModule=current;
 const q=new URLSearchParams(location.search),view=q.get('view')||'home',tab=q.get('tab')||'home';
 const canMoney=['owner','accountant'].includes(user.role),canCash=canMoney||user.role==='cashier';
 const entries=[['home','Главная','/?view=home'],['catalog','Каталог','/catalog/'],...(canMoney?[['procurement','Закупки','/?view=procurement'],['finance','Финансы','/finance/'],['calendar','Календарь','/?view=calendar']]:[]),...(canCash?[['cash','Касса','/?view=cash']]:[]),['tasks','Задачи','/?view=tasks'],...(user.role==='owner'?[['onec','Обмен с 1С','/?view=onec'],['users','Сотрудники','/?view=users'],['backups','Резервные копии','/?view=backups'],['security','История действий','/?view=security']]:[])];
 let active=current==='catalog'?'catalog':current==='finance'?(tab==='kassa'?'cash':'finance'):view;
 const bar=document.getElementById('wm-topbar');bar.querySelector('.wm-modules')?.remove();
 const caption=document.createElement('div');caption.className='wm-page-label';caption.textContent=entries.find(e=>e[0]===active)?.[1]||'Way Market';bar.querySelector('.wm-wordmark').after(caption);
 const sidebar=document.createElement('aside');sidebar.id='wm-sidebar';sidebar.className='wm-sidebar';sidebar.setAttribute('aria-label','Основные разделы');sidebar.innerHTML='<p class="wm-store-label">WAY MARKET <span>Магазин</span></p><nav class="wm-sidebar-links"></nav><div class="wm-sidebar-foot">Единое рабочее пространство</div>';
 const mobile=document.createElement('nav');mobile.className='wm-mobile-nav';mobile.setAttribute('aria-label','Разделы приложения');
 function activate(id){active=id;for(const a of document.querySelectorAll('[data-wm-route]'))a.setAttribute('aria-current',a.dataset.wmRoute===id?'page':'false');caption.textContent=entries.find(e=>e[0]===id)?.[1]||'Way Market';}
 if(current==='workspace')window.addEventListener('way:view',event=>activate(event.detail),{signal:scope.signal});
 function anchor([id,label,url]){const a=document.createElement('a');a.href=url;a.dataset.wmRoute=id;a.innerHTML=svg(id)+'<span></span>';a.querySelector('span').textContent=label;a.setAttribute('aria-current',active===id?'page':'false');a.onclick=async e=>{if(current==='workspace'&&url.startsWith('/?view=')&&window.wayNavigate){e.preventDefault();const next=new URL(url,location.origin).searchParams.get('view');const result=await window.wayNavigate(next);if(result!==false){history.replaceState(null,'',url);activate(id);setDrawer(false);}}};return a;}
 for(const entry of entries)sidebar.querySelector('nav').append(anchor(entry));
 const shade=document.createElement('button');shade.className='wm-nav-shade';shade.hidden=true;shade.setAttribute('aria-label','Закрыть меню');const viewport=matchMedia('(max-width:900px)');let returnFocus=null;
 const setDrawer=open=>{
  const visible=viewport.matches&&open;if(visible)returnFocus=document.activeElement;
  sidebar.classList.toggle('is-open',visible);shade.hidden=!visible;sidebar.inert=viewport.matches&&!visible;sidebar.setAttribute('aria-hidden',String(viewport.matches&&!visible));
  for(const b of document.querySelectorAll('.wm-menu-button,.wm-mobile-nav button')){b.setAttribute('aria-expanded',String(visible));b.setAttribute('aria-controls','wm-sidebar');}
  if(visible){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.querySelector('button,a')?.focus();}
  else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}
 };
 const toggle=()=>setDrawer(!sidebar.classList.contains('is-open'));shade.onclick=toggle;
 const menu=document.createElement('button');menu.className='wm-menu-button';menu.innerHTML=svg('menu');menu.setAttribute('aria-label','Открыть меню');menu.onclick=toggle;bar.prepend(menu);
 for(const id of ['home','catalog',...(canMoney?['finance']:['tasks'])]){const e=entries.find(e=>e[0]===id);if(e)mobile.append(anchor(e));}
 const more=document.createElement('button');more.innerHTML=svg('menu')+'<span>Ещё</span>';more.onclick=toggle;mobile.append(more);document.body.append(shade,sidebar,mobile);
 const closeDrawer=document.createElement('button');closeDrawer.className='wm-drawer-close';closeDrawer.textContent='Закрыть меню';closeDrawer.onclick=()=>setDrawer(false);sidebar.prepend(closeDrawer);setDrawer(false);
 viewport.addEventListener('change',()=>setDrawer(false),{signal:scope.signal});
 document.addEventListener('keydown',e=>{
  if(!viewport.matches||!sidebar.classList.contains('is-open'))return;
  if(e.key==='Escape'){e.preventDefault();setDrawer(false);}
  if(e.key==='Tab'){const items=[...sidebar.querySelectorAll('a,button')].filter(x=>!x.disabled),first=items[0],last=items.at(-1);if(!sidebar.contains(document.activeElement)){e.preventDefault();first?.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 },{signal:scope.signal});
 if(current==='catalog'){
  const tabs=document.getElementById('tabbar'),header=document.querySelector('body > .header');if(tabs&&header){tabs.classList.add('wm-catalog-tabs');header.append(tabs);if(['owner','administrator'].includes(user.role)){const settings=document.createElement('button');settings.className='wm-catalog-settings';settings.textContent='Настройки каталога';settings.onclick=()=>document.getElementById('adminBtn')?.click();tabs.append(settings);}}
 }
 if(current==='finance'){
  const area=document.querySelector('#screen-app .main-area'),tabs=document.createElement('nav');tabs.className='wm-finance-tabs';tabs.setAttribute('aria-label','Разделы финансов');
  for(const [id,label]of [['home','Обзор'],['analytics','Аналитика'],['journal','Журнал'],['settings','Параметры']]){const button=document.createElement('button');button.textContent=label;button.dataset.wmFinanceTab=id;button.setAttribute('aria-current',tab===id?'page':'false');button.disabled=!window.wayFinanceReady;document.addEventListener('way:finance-ready',()=>{button.disabled=false;},{once:true,signal:scope.signal});button.onclick=()=>{window.App?.navigate(id);history.replaceState(null,'','/finance/?tab='+id);for(const b of tabs.querySelectorAll('[data-wm-finance-tab]'))b.setAttribute('aria-current',b===button?'page':'false');activate('finance');};tabs.append(button);}
  const add=document.createElement('button');add.className='wm-add-operation';add.textContent='Добавить операцию';add.disabled=!window.wayFinanceReady;document.addEventListener('way:finance-ready',()=>{add.disabled=false;},{once:true,signal:scope.signal});add.onclick=()=>document.getElementById('fab')?.click();tabs.append(add);area?.prepend(tabs);
  const advanced=document.createElement('a');advanced.href='/?view=finance';advanced.textContent='Счета и расчёты';advanced.className='wm-finance-link';tabs.append(advanced);
  if(tab==='kassa'){const sheet=document.createElement('a');sheet.href='/?view=cash';sheet.textContent='Кассовый лист';tabs.append(sheet);}
 }
 if(current==='workspace'&&q.has('account')){if(window.wayNavigate)document.getElementById('profile-button')?.click();else window.addEventListener('way:ready',()=>document.getElementById('profile-button')?.click(),{once:true,signal:scope.signal});}
 if(current==='workspace'&&q.has('view')){
  if(window.wayNavigate)navigate(view);else window.addEventListener('way:ready',()=>navigate(view),{once:true,signal:scope.signal});
 }
 return ()=>{scope.abort();removeLayout();};
}
