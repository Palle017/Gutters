(function(){
  const menu=document.querySelector('.menu-toggle,.nav-toggle');
  const nav=document.getElementById(menu?.getAttribute('aria-controls')||'site-nav');
  if(menu&&nav){
    const setOpen=open=>{menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);};
    menu.addEventListener('click',()=>setOpen(menu.getAttribute('aria-expanded')!=='true'));
    nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setOpen(false)));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false);});
  }
  const filters=document.querySelectorAll('[data-filter]');
  filters.forEach(button=>button.addEventListener('click',()=>{
    filters.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    document.querySelectorAll('[data-category]').forEach(card=>{card.hidden=button.dataset.filter!=='all'&&card.dataset.category!==button.dataset.filter;});
  }));
  const dialog=document.getElementById('photo-dialog');
  if(dialog){
    let opener;
    document.querySelectorAll('[data-photo]').forEach(button=>button.addEventListener('click',()=>{
      opener=button;const image=document.getElementById('photo-large');image.src=button.dataset.photo;image.alt=button.dataset.caption;
      document.getElementById('photo-caption').textContent=button.dataset.caption;dialog.showModal();
    }));
    dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>opener?.focus());
  }
})();
