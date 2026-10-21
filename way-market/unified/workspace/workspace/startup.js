// A visible first paint and a diagnostic screen even if the ES module graph fails.
(() => {
 const panel=document.getElementById('boot-state'),message=document.getElementById('boot-message'),detail=document.getElementById('boot-detail');
 document.getElementById('boot-retry').addEventListener('click',()=>location.reload());
 const timer=setTimeout(()=>{message.textContent='Загрузка занимает больше времени. Убедитесь, что окно сервера Way Market открыто, затем повторите загрузку.';},15000);
 import('/workspace.mjs').then(()=>{
  clearTimeout(timer);
  if(!document.getElementById('entry').hidden||!document.getElementById('app').hidden)panel.hidden=true;
  else message.textContent='Не удалось получить экран входа. Проверьте, что окно сервера открыто, и повторите загрузку.';
 }).catch(error=>{
  clearTimeout(timer);panel.hidden=false;message.textContent='Не удалось загрузить интерфейс Way Market. Повторите загрузку. Если ошибка останется, пришлите текст ниже.';detail.textContent=error.message||String(error);
 });
})();
