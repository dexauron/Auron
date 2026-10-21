// Native select is bounded to 30 results; the full directory stays on the server.
export function productPicker({box,api,node,field,select,initial=null,query=''}){
 const search=field(box,'Найти по названию или штрихкоду','',{value:query,maxLength:150,autocomplete:'off'});
 const product=select(box,'Товар общей базы','product',[['','Выберите товар'],...(initial?[[initial.id,initial.name]]:[])],initial?.id||'');product.required=true;
 const note=node('p','','fine');box.append(note);let revision=0,timer;
 product.addEventListener('change',()=>{revision++;});
 async function load(autoSelect=false){
  const issued=++revision,q=search.value;note.textContent='Ищем…';
  try{const r=await api('/api/unified/product-options?q='+encodeURIComponent(q));if(issued!==revision||!box.isConnected)return;
   const previous=product.value;if(initial?.id===previous&&!r.products.some(p=>p.id===initial.id))r.products.push(initial);product.replaceChildren();for(const [id,label]of [['','Выберите товар'],...r.products.map(p=>[p.id,p.name+(p.barcode?' · '+p.barcode:'')])]){const o=node('option',label);o.value=id;product.append(o);}
   const exact=r.products.filter(p=>p.name.toLocaleLowerCase('ru')===q.toLocaleLowerCase('ru')||p.barcode&&p.barcode===q);
   product.value=r.products.some(p=>p.id===previous)?previous:autoSelect&&exact.length===1?exact[0].id:'';
   note.textContent=r.hasMore?'Показано 30 товаров. Уточните поиск.':r.products.length?'Выберите нужный товар из найденных.':'Товар не найден. Уточните название или штрихкод.';
  }catch(error){if(issued===revision)note.textContent=error.message;}
 }
 search.addEventListener('input',()=>{revision++;product.value='';clearTimeout(timer);timer=setTimeout(()=>load(true),180);});
 // The form is attached by modal() after the current event finishes.
 queueMicrotask(()=>{if(box.isConnected)load(true);});return product;
}
