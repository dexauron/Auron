export function businessDate(now=new Date()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(now);
}
export function businessRange(period,now=new Date()){
 const today=businessDate(now),date=new Date(today+'T12:00:00Z');
 if(period==='week'){date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return {from:date.toISOString().slice(0,10),to:today};}
 if(period==='month')return {from:today.slice(0,7)+'-01',to:today};
 if(period==='year')return {from:today.slice(0,4)+'-01-01',to:today};
 return {from:today,to:today};
}
export function businessMoney(kopecks){
 if(!Number.isSafeInteger(kopecks))return '—';
 return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(kopecks/100);
}
