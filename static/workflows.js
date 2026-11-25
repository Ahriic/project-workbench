// Project tools share existing forms, authorization, attachments and audit history.
names.changes='范围变更';names.deliverables='交付清单';icons.changes=icons.issues;icons.deliverables=icons.milestones;
for(const role of Object.keys(menuByRole))for(const kind of ['changes','deliverables'])if(!menuByRole[role].includes(kind))menuByRole[role].push(kind);
if(!menuByRole.boss.includes('issues'))menuByRole.boss.push('issues');
statusTone['待确认']='pending';statusTone['已提出']='neutral';statusTone['已撤销']='neutral';statusTone['已验收']='success';statusTone['待提交']='neutral';
fields.tasks.push(['progress','任务进度（%）','number'],['task_weight','进度权重','number']);
fields.issues.push(['blocker','卡在哪里','textarea'],['waiting_on','等待谁处理'],['followup','下次跟进','date'],['impact','对交期的影响',['待评估','不影响交期','影响交期']]);
fields.projects.push(['template','项目模板（新建时生效）',['','PLC改造','设备调试','故障处理']]);
fields.changes=[['title','变更事项'],['date','提出日期','date'],['original_scope','原工作范围','textarea'],['additional_scope','追加内容','textarea'],['extra_days','预计增加有效工日','number'],['extra_cost','预计追加费用（元）','number'],['status','状态',['已提出','待确认','已确认','已撤销']],['note','客户沟通与确认依据','textarea']];
fields.deliverables=[['title','交付资料名称'],['due','目标日期','date'],['status','状态',['待提交','待验收','已验收']],['note','资料版本、范围与验收要求','textarea']];

const workflowEditBase=edit;
edit=function(r={}){
 const kind=page;if(!r.id&&!r.project&&kind!=='projects')r={...r,project:Number(viewState[kind]?.project)||0};if(kind==='tasks')r={...r,task_weight:r.task_weight??1};workflowEditBase(r);const editor=$('#editor');
 if(kind==='issues'&&!r.followup)editor.querySelector('[name=followup]')?._flatpickr?.clear(false);
 const template=editor.querySelector('[name=template]');if(template){template.options[0].value='';template.options[0].textContent='不使用模板';if(r.id){template.disabled=true;template.parentElement.insertAdjacentHTML('beforeend','<small>已有项目可在项目空间中应用一次模板。</small>')}}
 if(['logs','deliverables'].includes(kind)){
  const relatedKind=kind==='logs'?'issues':'milestones',key=kind==='logs'?'issue':'milestone';
  api(relatedKind).then(rows=>{if($('#editor')!==editor)return;const box=document.createElement('div');box.className='full';box.innerHTML=`<label for="workflow-link">${kind==='logs'?'关联阻塞问题':'关联交付节点'}</label><select name="${key}" id="workflow-link"></select>`;editor.querySelector('.formgrid').append(box);const projectSelect=editor.querySelector('[name=project]');const paint=()=>{const select=box.querySelector('select');select.innerHTML='<option value="">不关联</option>'+rows.filter(x=>x.project==projectSelect.value).map(x=>`<option value="${x.id}" ${x.id==r[key]?'selected':''}>${esc(x.title)}</option>`).join('');select.disabled=!!r.id&&['待验收','已验收'].includes(r.status)};paint();projectSelect.addEventListener('change',paint)}).catch(e=>toast(e.message));
 }
 if(['changes','deliverables'].includes(kind)){
  const initial=kind==='changes'?'已提出':'待提交',state=r.status||initial,status=editor.querySelector('[name=status]');status.innerHTML=`<option value="${esc(state)}">${esc(state)}</option>`;
  const manager=hasRole('admin','manager'),owner=!r.id||r.owner===me.id;
  if(state!==initial||(!manager&&!owner))editor.querySelectorAll('input,select,textarea,button').forEach(el=>{if(el.id!=='cancel')el.disabled=true});
  else if(manager)editor.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);
  if(state===initial&&manager){if($('#attachment-file'))$('#attachment-file').disabled=false;if($('#upload-attachment'))$('#upload-attachment').disabled=false}
  if(state!==initial){$('#attachment-file')?.setAttribute('disabled','');$('#upload-attachment')?.setAttribute('disabled','')}
  if(r.id){
   const actions=[];
   if(kind==='changes'){if(state==='已提出'&&(owner||manager))actions.push(['待确认','提交确认']);if(state==='待确认'&&hasRole('admin','boss'))actions.push(['已确认','确认追加工作'],['已提出','退回补充']);if(state!=='已撤销'&&(hasRole('admin','boss')||(state!=='已确认'&&(owner||manager))))actions.push(['已撤销','撤销变更'])}
   else{if(state==='待提交'&&(owner||manager))actions.push(['待验收','提交资料验收']);if(state==='待验收'&&manager)actions.push(['已验收','确认资料验收'],['待提交','退回补充'])}
   const panel=document.createElement('section');panel.className='calculation-panel';panel.innerHTML=`<h3>流程记录</h3><p>流程针对已保存的记录。变更确认不自动改动预算、工日或奖金；资料需上传附件后提交。</p><label for="workflow-note">处理依据</label><textarea id="workflow-note"></textarea><div class="actions">${actions.map(([target,label])=>`<button type="button" data-workflow-target="${target}">${label}</button>`).join('')}</div>${(r.workflow_history||[]).map(x=>`<p>${esc(x.at)} · ${esc(user(x.by))} · ${esc(x.status)}<br>${esc(x.note)}</p>`).join('')}`;$('#modal').append(panel);
   panel.querySelectorAll('[data-workflow-target]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(kind+'/'+r.id+'/transition',{method:'POST',body:JSON.stringify({status:b.dataset.workflowTarget,note:$('#workflow-note').value})});$('#modal').close();await refresh()}catch(e){toast(e.message);b.disabled=false}});
  }
 }
 const file=$('#attachment-file');if(file)file.accept+=',.zip';
 const pay=$('[data-review=pay]');
 if(pay){
  const panel=document.createElement('section');panel.className='calculation-panel';panel.innerHTML=`<h3>实际付款核对</h3><p>本地登记，不会执行银行转账；当前按一次付清。可先补充付款凭证，再登记。</p><div class="formgrid">${control('paid_date','实际支付日期','date',date())}${control('paid_amount','实际支付金额','number',r.amount)}${control('paid_method','付款方式',['银行转账','现金','其他'],'银行转账')}${control('paid_reference','付款流水 / 核对说明')}</div>`;pay.closest('.review-panel').before(panel);
  if(file)file.disabled=false;if($('#upload-attachment'))$('#upload-attachment').disabled=false;
  pay.onclick=async()=>{pay.disabled=true;try{await api(kind+'/'+r.id+'/review',{method:'POST',body:JSON.stringify({action:'pay',note:$('#review-note')?.value||'',payment_details:{date:panel.querySelector('[name=paid_date]').value,amount:Number(panel.querySelector('[name=paid_amount]').value),method:panel.querySelector('[name=paid_method]').value,reference:panel.querySelector('[name=paid_reference]').value}})});$('#modal').close();await refresh()}catch(e){toast(e.message);pay.disabled=false}};
 }
 if(r.payment){const payment=document.createElement('section');payment.className='calculation-panel';payment.innerHTML=`<h3>付款登记信息</h3><p>支付日期：${esc(r.payment.date||'历史未填')} · 实付金额：${r.payment.amount!==undefined?'¥ '+Number(r.payment.amount).toFixed(2):'历史未填'} · 经办人：${esc(user(r.payment.by))}</p><p>${esc(r.payment.method||'')} ${esc(r.payment.reference||'历史记录未补录付款依据')}</p>`;$('#modal').append(payment)}
 $('#modal').querySelectorAll('label').forEach((label,i)=>{const input=label.parentElement.querySelector('input,select,textarea');if(input&&!label.contains(input)){input.id=input.id||'workflow-field-'+i;label.htmlFor=input.id}});installDateWidgets($('#modal'));
};

const workflowProjectDetail=projectDetail;
projectDetail=async function(){
 const id=detailId;await workflowProjectDetail();if(page!=='projects'||detailId!==id||detailTab!=='overview')return;
 const changes=await api('changes');if(page!=='projects'||detailId!==id||detailTab!=='overview')return;
 const changeRows=changes.filter(r=>r.project===id),project=projects.find(p=>p.id===id);
 const panel=document.createElement('section');panel.className='glass-panel project-operating-panel';panel.innerHTML=`<h2>范围与交付</h2><div class="detail-stats"><div><strong>${changeRows.filter(r=>r.status==='待确认').length}</strong><span>待确认变更</span></div></div><div class="actions"><button data-project-workflow="changes">范围变更</button><button data-project-workflow="deliverables">交付清单</button></div>${hasRole('admin','manager')&&!project.applied_template?'<p>模板按项目开始日期生成初始计划，负责人和日期需按实际调整。只能应用一次。</p><label for="project-template">项目模板</label><select id="project-template"><option>PLC改造</option><option>设备调试</option><option>故障处理</option></select><button id="apply-project-template">生成任务、节点与资料清单</button>':`<p>${project.applied_template?'已应用模板：'+esc(project.applied_template.name):'模板由技术经理或管理员应用。'}</p>`}`;$('#detail-content').append(panel);
 panel.querySelectorAll('[data-project-workflow]').forEach(b=>b.onclick=()=>{const kind=b.dataset.projectWorkflow;viewState[kind]={q:'',owner:'',project:String(id),status:'',month:'',page:1,size:12};navigate(kind)});
 const apply=$('#apply-project-template');if(apply)apply.onclick=async()=>{if(!confirm('生成初始计划和资料清单？后续需调整日期和负责人。'))return;apply.disabled=true;try{await api('projects/'+id+'/apply-template',{method:'POST',body:JSON.stringify({template:$('#project-template').value})});await projectDetail()}catch(e){toast(e.message);apply.disabled=false}};
};
const workflowList=fetchList;
fetchList=async function(){await workflowList();applyDesktopStyle();if(page==='issues')document.querySelectorAll('[data-record^="issues:"]').forEach(button=>{const row=records.find(r=>r.id==button.dataset.record.split(':')[1]);if(!row||button.querySelector('.issue-blocker-summary'))return;const info=document.createElement('div');info.className='issue-blocker-summary';info.innerHTML=`${row.blocker?`<small>阻塞：${esc(row.blocker)}</small>`:''}${row.waiting_on?`<small>等待：${esc(row.waiting_on)}</small>`:''}${row.followup?`<small>下次跟进：${esc(row.followup)}</small>`:''}${row.impact?`<small>${esc(row.impact)}</small>`:''}`;button.append(info)})};
const workflowApprovals=approvals;approvals=async function(){await workflowApprovals();if(page!=='approvals')return;const rows=await api('approvals');if(page!=='approvals')return;const manual=new Set(rows.filter(r=>['pay','confirm_change','accept_delivery'].includes(r.action)).map(r=>String(r.id)));const disable=()=>document.querySelectorAll('[data-batch-id]').forEach(box=>{if(manual.has(box.dataset.batchId)){box.checked=false;box.disabled=true;box.title='需进入详情逐条核对依据'}});disable();const panel=$('#approval-list');if(panel){const observer=new MutationObserver(()=>{if(!panel.isConnected){observer.disconnect();return}disable()});observer.observe(panel,{childList:true,subtree:true});$('#approval-batch-hint')?.remove();const hint=document.createElement('p');hint.id='approval-batch-hint';hint.className='milestone-scope';hint.textContent='付款、变更确认和资料验收需进入详情逐条核对，不参与批量通过。';panel.before(hint)}};
const workflowListLabels=fetchList;fetchList=async function(){await workflowListLabels();if(['changes','deliverables'].includes(page)){
 const kind=page,header=$('#list th:nth-child(6)');if(header)header.textContent=kind==='changes'?'追加工日 / 费用':'验收记录';
 document.querySelectorAll('#list tbody tr').forEach(tr=>{const id=tr.querySelector('[data-edit]')?.dataset.edit,row=records.find(r=>r.id==id);if(!row)return;tr.children[4].innerHTML=statusBadge(row.status);tr.children[5].textContent=kind==='changes'?`${Number(row.extra_days||0)} 工日 / ¥${Number(row.extra_cost||0).toFixed(2)}`:row.workflow_history?.length?user(row.workflow_history.at(-1).by)+' · '+row.workflow_history.at(-1).status:'尚未提交'});
 }if(page==='logs')document.querySelectorAll('.activity-card').forEach(card=>{const id=card.querySelector('[data-record]')?.dataset.record.split(':')[1],row=records.find(r=>r.id==id);if(!row?.issue||card.querySelector('[data-link-issue]'))return;const button=document.createElement('button');button.type='button';button.className='text-button';button.dataset.linkIssue=row.issue;button.textContent='查看关联阻塞问题';card.querySelector('.activity-body').append(button);button.onclick=async()=>{try{const rows=await api('issues'),issue=rows.find(x=>x.id==row.issue);if(!issue)return toast('关联问题不可见或已作废');page='issues';edit(issue)}catch(e){toast(e.message)}}})};
readHash();start();
