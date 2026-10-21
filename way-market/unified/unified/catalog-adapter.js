import { newRequestId } from '/request-id.mjs';
import {state,ui,$} from '/catalog/js/modules/store.js';
import {buildIndex} from '/catalog/js/modules/catalog.js';
import {renderAll} from '/catalog/js/modules/render.js';
import {toast} from '/catalog/js/modules/core.js';
let session,saving=false,baseline=new Map(),productVersions=new Map(),supplierBaseline=new Map();
let groupsSignature='',supplementSignature='',groupsVersion=0,supplementVersion=0;
const clone=value=>JSON.parse(JSON.stringify(value));
async function request(path,data){
 const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json','X-Way-Token':session.csrf,'X-Way-Account':session.user.id},body:JSON.stringify(data)}:{cache:'no-store'});
 const out=await r.json();if(!r.ok)throw Error(out.error||'Не удалось сохранить');return out;
}
function signature(p){const out={};for(const k of Object.keys(p).sort())if(!k.startsWith('_'))out[k]=p[k];return JSON.stringify(out);}
function supplement(){return {orders:state.orders||[],competitors:state.competitors||[],compPrices:state.compPrices||[],unitCoef:state.unitCoef||{},orderRules:state.orderRules||null};}
async function refresh(){
 if(saving)throw Error('Дождитесь окончания сохранения перед обновлением');
 const d=await request('/api/unified/catalog');groupsVersion=d.groupsVersion||0;supplementVersion=d.supplementVersion||0;
 state.products=d.products;state.groups=d.groups;state.suppliers=d.suppliers;state.contacts=d.contacts||{};
 supplierBaseline=new Map(d.suppliers.map(s=>[s.id,{name:s.name,contact:clone(state.contacts[s.id]||{}),version:s._version}]));
 const shared=d.supplement||{};for(const [key,value]of Object.entries({orders:[],competitors:[],compPrices:[],unitCoef:{},orderRules:null}))state[key]=shared[key]??value;
 supplementSignature=JSON.stringify(supplement());state.lastFetch=Date.now();baseline=new Map(d.products.map(p=>[p.id,signature(p)]));productVersions=new Map(d.products.map(p=>[p.id,p._version]));groupsSignature=JSON.stringify(d.groups);
 buildIndex();if($('loader'))$('loader').hidden=true;renderAll();
}
async function saveChanges(message){
 if(saving)throw Error('Сохранение уже выполняется. Дождитесь ответа');saving=true;
 let completed=0,savedSuppliers=0,archived=0;
 try{
  // Detach every outgoing value from editable form state before the first await.
  const present=new Set(state.products.map(p=>p.id)),removed=[...baseline.keys()].filter(id=>!present.has(id));
  const changed=state.products.filter(p=>baseline.get(p.id)!==signature(p)).map(clone),groups=clone(state.groups),shared=clone(supplement());
  const groupsChanged=JSON.stringify(groups)!==groupsSignature,sharedChanged=JSON.stringify(shared)!==supplementSignature;
  const supplierChanges=state.suppliers.filter(s=>{const b=supplierBaseline.get(s.id);return !b||b.name!==s.name||JSON.stringify(b.contact)!==JSON.stringify(state.contacts[s.id]||{});}).map(s=>({id:s.id,name:s.name,contact:clone(state.contacts[s.id]||{}),version:supplierBaseline.get(s.id)?.version||0,active:true}));
  const supplierIds=new Set(state.suppliers.map(s=>s.id));for(const [id,b]of supplierBaseline)if(!supplierIds.has(id))supplierChanges.push({id,name:b.name,contact:clone(b.contact),version:b.version,active:false});
  for(let i=0;i<supplierChanges.length;i+=50){
   const batch=supplierChanges.slice(i,i+50),r=await request('/api/unified/catalog-save',{requestId:newRequestId(),products:[],suppliers:batch});
   for(let j=0;j<batch.length;j++){const e=batch[j];if(e.active)supplierBaseline.set(e.id,{name:e.name,contact:e.contact,version:r.suppliers[j].version});else supplierBaseline.delete(e.id);}savedSuppliers+=batch.length;
  }
  for(let i=0;i<changed.length;i+=50){
   const batch=changed.slice(i,i+50),withGroups=i===0&&groupsChanged;
   const reply=await request('/api/unified/catalog-save',{requestId:newRequestId(),products:batch,...(withGroups?{groups,groupsVersion}:{})});
   if(withGroups){groupsVersion=reply.groupsVersion;groupsSignature=JSON.stringify(groups);}
   for(let j=0;j<batch.length;j++){const sent=batch[j],version=reply.products[j].version;productVersions.set(sent.id,version);baseline.set(sent.id,signature(sent));const live=state.products.find(p=>p.id===sent.id);if(live)live._version=version;}completed+=batch.length;
  }
  for(let i=0;i<removed.length;i+=50){
   const ids=removed.slice(i,i+50);await request('/api/unified/catalog-save',{requestId:newRequestId(),products:[],archives:ids.map(id=>({id,expectedVersion:productVersions.get(id)}))});
   for(const id of ids){baseline.delete(id);productVersions.delete(id);}archived+=ids.length;
  }
  if(!changed.length&&groupsChanged){const reply=await request('/api/unified/catalog-save',{requestId:newRequestId(),products:[],groups,groupsVersion});groupsVersion=reply.groupsVersion;groupsSignature=JSON.stringify(groups);}
  if(sharedChanged){const reply=await request('/api/unified/catalog-save',{requestId:newRequestId(),products:[],supplement:shared,supplementVersion});supplementVersion=reply.supplementVersion;supplementSignature=JSON.stringify(shared);}
  const unsavedSuppliers=state.suppliers.some(s=>{const b=supplierBaseline.get(s.id);return !b||b.name!==s.name||JSON.stringify(b.contact)!==JSON.stringify(state.contacts[s.id]||{});})||[...supplierBaseline.keys()].some(id=>!state.suppliers.some(s=>s.id===id));
  const unsaved=unsavedSuppliers||state.products.some(p=>baseline.get(p.id)!==signature(p))||JSON.stringify(state.groups)!==groupsSignature||JSON.stringify(supplement())!==supplementSignature;
  buildIndex();renderAll();toast(unsaved?'Отправленные изменения сохранены. Более поздние правки ещё нужно сохранить.':message||'Сохранено в Way Market');
 }catch(error){toast('Подтверждено: товаров '+completed+', поставщиков '+savedSuppliers+', архивировано '+archived+'. '+error.message);throw error;}
 finally{saving=false;}
}
export async function initialize(){
 session=await (await fetch('/api/session',{cache:'no-store'})).json();if(!session.user){location.replace('/');return;}
 if(session.user.role==='owner')await request('/api/unified/seed',{});
 state.serverless=true;state.session={user:{id:session.user.id,email:session.user.login},unified:true};
 state.isAdmin=['owner','administrator'].includes(session.user.role);state.role=state.isAdmin?'admin':'cashier';state.canPurchase=['owner','accountant'].includes(session.user.role);state.canSales=session.user.role==='owner';if($('fabAdd'))$('fabAdd').hidden=!state.isAdmin;
 ui.unifiedRefresh=refresh;ui.unifiedSave=saveChanges;await refresh();
 document.addEventListener('click',event=>{
  const target=event.target.closest('#menuLogout,#menuOwnerPass,#menuStaffPass,#btnLogoutStaff');if(!target)return;event.preventDefault();event.stopImmediatePropagation();
  if(target.id==='menuLogout'){if(window.wayLogout)window.wayLogout();else toast('Профиль загружается. Повторите выход.');return;}
  location.assign(target.id==='menuOwnerPass'?'/?account=1':'/?view=users');
 },{capture:true});
}
