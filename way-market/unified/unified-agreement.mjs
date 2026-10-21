import {parseDealText} from './reference/telegram-original/supabase/functions/_shared/parse.ts';
import {InputError} from './workspace/domain.mjs';
export function parseUnifiedAgreement(w,token,p,{clock=Date.now}={}) {
 return w.accounts.command(token,'finance.read',()=>({}),()=>{
  if(typeof p?.text!=='string'||!p.text.trim()||p.text.length>500||/[\x00-\x1f]/.test(p.text))throw new InputError('Введите договорённость одной строкой, до 500 символов');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(clock()));
  const parsed=parseDealText(p.text,today);
  if(parsed.amountMinor!==null&&(!Number.isSafeInteger(parsed.amountMinor)||parsed.amountMinor<1||parsed.amountMinor>99999999999))throw new InputError('Сумма вне допустимого диапазона');
  return {...parsed,requiresReview:true};
 });
}
