// Filters operate only on already authorized rows returned by the server.
export const normalizeListText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').replace(/\s+/gu,' ').trim();
export function selectListRows(rows, {status='all',query=''} = {}) {
  const terms = normalizeListText(query).split(' ').filter(Boolean);
  return rows.filter(row => (status === 'all' || row.status === status) && terms.every(term => normalizeListText(row.searchText).includes(term)));
}
export function createListControls({node,button,rows,state,label,placeholder,statuses,scope,emptyTitle,emptyDetail,renderRow}) {
  const root=node('div',null,'wm-list-controls'),tools=node('div',null,'wm-list-toolbar');
  const searchLabel=node('label',label,'wm-list-search'),input=node('input');
  input.type='search';input.placeholder=placeholder;input.value=state.query;input.autocomplete='off';input.maxLength=200;searchLabel.append(input);
  const filters=node('div',null,'wm-status-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Фильтр по статусу');
  const choices=[];
  for(const [value,title] of statuses) {
    const count=value==='all'?rows.length:rows.filter(r=>r.status===value).length;
    const choice=button(`${title} · ${count}`,()=>{state.status=value;draw();},'wm-status-filter');
    choice.setAttribute('aria-pressed',String(state.status===value));choice.dataset.status=value;choices.push(choice);filters.append(choice);
  }
  const reset=button('Сбросить фильтры',()=>{state.status='all';state.query='';input.value='';draw();input.focus();},'secondary');
  const info=node('p','', 'fine wm-list-count');info.setAttribute('role','status');info.setAttribute('aria-live','polite');
  const list=node('div',null,'wm-filtered-list');tools.append(searchLabel,filters);root.append(tools,info,list,node('p',scope,'fine wm-list-scope'));
  function draw(){
    const selected=selectListRows(rows,state);
    for(const choice of choices)choice.setAttribute('aria-pressed',String(state.status===choice.dataset.status));
    info.textContent=`Показано ${selected.length} из ${rows.length} загруженных записей`;
    list.replaceChildren();
    if(!selected.length){
      const empty=node('div',null,'wm-guided-empty');
      empty.append(node('strong',rows.length?'По этим условиям ничего не найдено':emptyTitle),node('p',rows.length?'Измените запрос или сбросьте фильтры.':emptyDetail,'fine'));
      if(rows.length)empty.append(reset);list.append(empty);
    } else for(const row of selected)list.append(renderRow(row));
  }
  input.addEventListener('input',()=>{state.query=input.value;draw();});
  // Native search clear affordance can emit search independently in some browsers.
  input.addEventListener('search',()=>{state.query=input.value;draw();});
  draw();return root;
}
