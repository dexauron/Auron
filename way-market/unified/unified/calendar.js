export async function calendarPage({api,node,select,surface,rub}) {
 const state=await api('/api/unified/calendar'),root=node('div',null,'wm-calendar-page'),tools=surface('Платежи и поставки');
 tools.append(node('p','Общий календарь сроков обязательств, назначенных платежей, заказов и ожидаемых поставок. Назначение платежа не означает оплату.','fine'));
 const filters=node('div',null,'fields');
 const mode=select(filters,'Показывать','mode',[['upcoming','Предстоящие'],['overdue','Просроченные'],['closed','Закрытые'],['all','Все']]);
 const kind=select(filters,'События','kind',[['all','Все события'],['obligation','Обязательства'],['plan','Назначенные платежи'],['order','Заказы закупки'],['delivery','Ожидаемые поставки']]);
 tools.append(filters);root.append(tools);const list=node('div');root.append(list);
 function draw(){list.replaceChildren();const items=state.items.filter(e=>(kind.value==='all'||e.kind===kind.value)&&(mode.value==='all'||(mode.value==='closed'?e.closed:mode.value==='overdue'?e.overdue:!e.closed&&e.date>=state.today)));
  if(!items.length){list.append(node('p','Событий по выбранным условиям нет.','empty'));return;}
  let day,box;
  for(const e of items){if(e.date!==day){day=e.date;box=surface(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric'}).format(new Date(day+'T12:00:00Z')));list.append(box);}
   const row=node('div',null,'row'),info=node('div',null,'row-main');info.append(node('strong',e.title),node('small',e.detail+(e.overdue?' · Просрочено':e.closed?' · Закрыто':'')));row.append(info);
   if(e.amount!==null)row.append(node('strong',rub(e.amount),'money'));
   const link=node('a','Открыть');link.href=e.href;row.append(link);box.append(row);
  }
 }
 mode.onchange=kind.onchange=draw;draw();return root;
}
