import {InputError} from './workspace/domain.mjs';
const norm=s=>s.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
export function productOptions(w,token,q=''){
 if(typeof q!=='string'||q.length>150||/[\x00-\x1f]/.test(q))throw new InputError('Поиск товара: до 150 символов');
 const words=norm(q).split(/\s+/).filter(Boolean);
 return w.accounts.command(token,'catalog.read',()=>({}),db=>{
  const rows=db.prepare('SELECT id,name,barcode FROM workspace_products WHERE active=1 ORDER BY name,id').all();
  const matches=rows.filter(p=>{const haystack=norm(p.name+' '+p.barcode);return words.every(word=>haystack.includes(word));});
  const exact=matches.filter(p=>norm(p.name)===norm(q)||q&&p.barcode===q),exactIds=new Set(exact.map(p=>p.id)),other=matches.filter(p=>!exactIds.has(p.id));
  return {products:[...exact,...other].slice(0,30),hasMore:matches.length>30};
 });
}
