// Flatpickr 4.6.13, locally vendored. Canonical ISO values remain on named inputs.
const activeDateWidgets=new Set();
function positionDialogCalendar(instance){
 const dialog=instance.input.closest('dialog');if(!dialog)return;
 const panel=instance.calendarContainer,anchor=instance.altInput.getBoundingClientRect(),box=dialog.getBoundingClientRect();
 const width=panel.offsetWidth,height=panel.offsetHeight,left=Math.max(box.left+12,Math.min(anchor.left,box.right-width-12));
 const bottom=Math.min(box.bottom-12,innerHeight-12),topLimit=Math.max(box.top+12,12);
 let top=anchor.bottom+6;if(top+height>bottom)top=anchor.top-height-6;top=Math.max(topLimit,Math.min(top,bottom-height));
 panel.style.left=(left-box.left-dialog.clientLeft+dialog.scrollLeft)+'px';panel.style.top=(top-box.top-dialog.clientTop+dialog.scrollTop)+'px';panel.style.right='auto';
}
document.querySelector('#modal').addEventListener('scroll',()=>{for(const fp of activeDateWidgets)if(fp.isOpen&&fp.input.closest('dialog'))positionDialogCalendar(fp)},{passive:true});
document.querySelector('#modal').addEventListener('cancel',event=>{const open=[...activeDateWidgets].filter(fp=>fp.isOpen&&fp.input.closest('dialog'));if(open.length){event.preventDefault();open.forEach(fp=>fp.close())}});
document.querySelector('#modal').addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=[...activeDateWidgets].filter(fp=>fp.isOpen&&fp.input.closest('dialog'));if(open.length){event.preventDefault();event.stopPropagation();open.forEach(fp=>fp.close())}},true);
function installDateWidgets(root=document){
 if(!window.flatpickr)return;
 for(const fp of activeDateWidgets){if(!fp.input.isConnected){fp.destroy();activeDateWidgets.delete(fp)}}
 root.querySelectorAll('input[type="date"],input[type="month"]').forEach(input=>{
  if(input._flatpickr||input.disabled)return;
  const month=input.type==='month',filter=input.id.startsWith('filter-'),dialog=input.closest('dialog');
  const label=input.getAttribute('aria-label')||input.labels?.[0]?.textContent.trim()||'选择日期';
  const fp=flatpickr(input,{
   locale:flatpickr.l10ns.zh,disableMobile:true,animate:false,allowInput:false,
   altInput:true,dateFormat:month?'Y-m':'Y-m-d',altFormat:month?'Y年m月':'Y年m月d日',ariaDateFormat:'Y年m月d日',
   defaultDate:input.value||null,plugins:month?[new monthSelectPlugin({dateFormat:'Y-m',altFormat:'Y年m月'})]:[],
   ...(dialog?{appendTo:dialog,position:positionDialogCalendar}:{}),
   onReady:(_,__,instance)=>{
    const visible=instance.altInput;visible.placeholder=filter?(month?'全部月份':'全部日期'):(month?'请选择月份':'请选择日期');
    visible.setAttribute('aria-label',label);visible.id=input.id?input.id+'-display':'';visible.classList.add('date-display');
    for(const oldLabel of [...(input.labels||[])])if(oldLabel.htmlFor&&visible.id)oldLabel.htmlFor=visible.id;
    const footer=document.createElement('div');footer.className='calendar-actions';
    for(const [text,action] of [[month?'本月':'今天',()=>{instance.setDate(new Date(),true);instance.close()}],...(input.id==='month'?[]:[['清空',()=>{instance.clear();instance.close()}]]),['关闭',()=>instance.close()]]){
     const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;footer.append(b);
    }
    instance.calendarContainer.append(footer);
   },
   onOpen:(_,__,instance)=>{instance.setDate(input.value||null,false);instance.calendarContainer.setAttribute('aria-label',month?'选择月份':'选择日期')}
  });
  input.addEventListener('change',()=>{if(fp.input.isConnected)fp.setDate(input.value||null,false)});
  fp.altInput.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fp.open()}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();fp.close();fp.altInput.focus()}});
  activeDateWidgets.add(fp);
 });
}
document.querySelector('#modal').addEventListener('close',()=>{for(const fp of activeDateWidgets)if(fp.input.closest('dialog'))fp.close()});
