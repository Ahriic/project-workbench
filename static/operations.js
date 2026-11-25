names.approvals='审批中心';names.backups='备份与恢复';icons.approvals=icons.check;icons.backups=icons.audit;
for(const role of Object.keys(menuByRole)){if(!menuByRole[role].includes('approvals'))menuByRole[role].push('approvals')}
menuByRole.admin.push('backups');
fields.projects.push(['standard_days','标准有效工日','number'],['delay_reason','延期原因与调整依据','textarea']);
fields.logs.push(['work_days','当日有效工日（半天0.5）','number'],['waiting_days','客观等待工日','number']);
const viewState={};let listTimer,renderingList=false;
// Restore the parent route synchronously before existing save/review handlers refresh it.
let dialogParent=null;const nativeModalClose=$('#modal').close.bind($('#modal'));
$('#modal').close=function(...args){if(dialogParent)page=dialogParent;return nativeModalClose(...args)};
const readHash=()=>{const p=new URLSearchParams(location.hash.slice(1));const key=p.get('page');if(key&&names[key]){page=key;detailId=Number(p.get('project'))||null;detailTab=p.get('tab')||'overview'}};
function routeUrl(){const q=new URLSearchParams({page});if(detailId&&page==='projects'){q.set('project',detailId);q.set('tab',detailTab)}return '#'+q}
function rememberRoute(push=false){const state={page,detailId,detailTab,views:JSON.parse(JSON.stringify(viewState)),scroll:$('main')?.scrollTop||0};history[push?'pushState':'replaceState'](state,'',routeUrl())}
const navigateOriginal=navigate;
navigate=async function(k){rememberRoute();history.pushState({},'', '#page='+k);await navigateOriginal(k)};
const openProjectOriginal=openProject;openProject=async function(id){rememberRoute();history.pushState({},'', '#page=projects&project='+id);await openProjectOriginal(id)};
window.addEventListener('popstate',async e=>{readHash();if(e.state?.views)Object.assign(viewState,e.state.views);await render();$('main')?.scrollTo(0,e.state?.scroll||0)});
const operationalRender=render;
render=async function(){
 await operationalRender();
 if(page==='audit'){
  const items=await api('audit');if(page==='audit')document.querySelectorAll('#content tbody tr').forEach((tr,i)=>{if(!items[i]?.details)return;const cell=tr.children[2];if(cell)cell.insertAdjacentHTML('beforeend',`<details class="audit-changes"><summary>查看修改前后</summary><pre>${esc(JSON.stringify(JSON.parse(items[i].details),null,2))}</pre></details>`)});
 }
 if(fields[page]&&page!=='projects')await installListFilters();
 bindNavigation();rememberRoute();
};
function pagerHtml(d){return `<div class="pagination"><span>共 ${d.total} 条 · 第 ${d.page} / ${d.pages} 页</span><div><button id="prev-page" ${d.page<=1?'disabled':''}>上一页</button><button id="next-page" ${d.page>=d.pages?'disabled':''}>下一页</button></div></div>`}
async function installListFilters(){
 const k=page,s=viewState[k]||{q:'',owner:'',project:'',status:'',month:'',page:1,size:12};viewState[k]=s;
 const toolbar=$('.view-toolbar');if(!toolbar)return;
 $('#search').value=s.q;
 const filters=document.createElement('div');filters.className='record-filters';filters.innerHTML=`<label>人员<select id="filter-owner"><option value="">全部人员</option>${users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label><label>项目<select id="filter-project"><option value="">全部项目</option>${projects.map(p=>`<option value="${p.id}">${esc(cleanTitle(p.title))}</option>`).join('')}</select></label><label>月份<input id="filter-month" type="month"></label><label>状态<select id="filter-status"><option value="">全部状态</option>${[...new Set([...(fields[k].find(f=>f[0]==='status')?.[2]||[]),'已退回','待财务审核','待老板审批','已批准','已支付'])].map(v=>`<option>${esc(v)}</option>`).join('')}</select></label><button id="filter-clear">重置筛选</button>`;toolbar.after(filters);
 for(const key of ['owner','project','month','status']){const el=$('#filter-'+key);el.value=s[key];el.onchange=async()=>{s[key]=el.value;s.page=1;pointStatus='全部';await fetchList()}}
 $('#filter-clear').onclick=async()=>{Object.assign(s,{q:'',owner:'',project:'',month:'',status:'',page:1});$('#search').value='';for(const k of ['owner','project','month','status'])$('#filter-'+k).value='';await fetchList()};
 $('#search').oninput=e=>{s.q=e.target.value;s.page=1;clearTimeout(listTimer);listTimer=setTimeout(()=>fetchList().catch(x=>toast(x.message)),220)};
 await fetchList();
}
const originalDraw=draw;
async function fetchList(){const k=page,s=viewState[k];if(!s||!$('#list'))return;const data=await api('list?'+new URLSearchParams({kind:k,...s}));if(page!==k)return;records=data.items;s.page=data.page;renderingList=true;originalDraw();renderingList=false;$('#list').insertAdjacentHTML('beforeend',pagerHtml(data));$('#prev-page').onclick=()=>{s.page--;fetchList().catch(x=>toast(x.message))};$('#next-page').onclick=()=>{s.page++;fetchList().catch(x=>toast(x.message))};$('.text-link[href*="export"]')?.setAttribute('href','/api/export?'+new URLSearchParams({kind:k,q:s.q,month:s.month,owner:s.owner,project:s.project,status:s.status}));if(k==='points')document.querySelectorAll('[data-point-filter]').forEach(b=>b.onclick=()=>{pointStatus=b.dataset.pointFilter;s.status=pointStatus==='全部'?'':pointStatus;s.page=1;$('#filter-status').value=s.status;originalDraw();fetchList().catch(e=>toast(e.message))});rememberRoute()}
draw=function(){if(viewState[page]&&!renderingList)return fetchList().catch(e=>toast(e.message));return originalDraw()};
async function approvals(){
 const rows=await api('approvals');let tab=sessionStorage.getItem('approval-tab')||'mine';
 $('#content').innerHTML=`<div class="page-heading"><div><div class="eyebrow">REVIEW WORKSPACE</div><h1>审批中心</h1><p>先看依据，再做判断。所有审批与退回均保留历史。</p></div></div><div class="filter-tabs approval-tabs">${[['mine','待我处理',rows.filter(r=>r.action).length],['submitted','我提交的',rows.filter(r=>r.owner===me.id).length],['returned','已退回',rows.filter(r=>r.status==='已退回').length],['all','全部可见',rows.length]].map(([k,l,n])=>`<button data-approval-tab="${k}" class="${k===tab?'selected':''}">${l}<span>${n}</span></button>`).join('')}</div><div class="approval-batch"><label><input type="checkbox" id="check-all">全选本页可审批事项</label><button id="batch-review" class="primary">批量通过所选</button><small>按各记录当前节点处理，任一项不符合条件则整批不执行。</small></div><div id="approval-list"></div>`;
 let index=1,size=Number(sessionStorage.getItem('approval-size'))||12;
 async function paint(){
  const filtered=rows.filter(r=>tab==='mine'?r.action:tab==='submitted'?r.owner===me.id:tab==='returned'?r.status==='已退回':true);
  const pages=Math.max(1,Math.ceil(filtered.length/size));index=Math.max(1,Math.min(pages,index));
  const data={total:filtered.length,page:index,size,pages},items=filtered.slice((index-1)*size,index*size);
  $('#approval-list').innerHTML=`<div class="tablewrap"><table><thead><tr><th>选择</th><th>事项</th><th>申请人</th><th>类型</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>${items.map(r=>`<tr><td><input type="checkbox" data-batch-id="${r.id}" ${r.action?'':'disabled'} aria-label="选择${esc(r.title)}"></td><td>${esc(cleanTitle(r.title))}</td><td>${esc(user(r.owner))}</td><td>${names[r.kind]}</td><td>¥ ${Number(r.amount||0).toFixed(2)}</td><td>${statusBadge(r.status)}</td><td><button data-review-record="${r.id}">查看依据</button></td></tr>`).join('')}</tbody></table>${items.length?'':'<div class="empty">当前没有需要处理的记录。</div>'}</div>${pagerHtml(data)}`;
  bindPager(data,{previous:()=>{index--;paint()},next:()=>{index++;paint()},size:n=>{size=n;index=1;sessionStorage.setItem('approval-size',n);paint()},jump:n=>{index=n;paint()}});
  document.querySelectorAll('[data-review-record]').forEach(b=>b.onclick=()=>{const r=rows.find(r=>r.id==b.dataset.reviewRecord);page=r.kind;edit(r)});$('#check-all').checked=false;
 }
 document.querySelectorAll('[data-approval-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.approvalTab;sessionStorage.setItem('approval-tab',tab);approvals()});$('#check-all').onchange=e=>document.querySelectorAll('[data-batch-id]:not(:disabled)').forEach(c=>c.checked=e.target.checked);
 $('#batch-review').onclick=async()=>{const ids=[...document.querySelectorAll('[data-batch-id]:checked')].map(e=>Number(e.dataset.batchId));if(!ids.length)return toast('请先选择待审批记录');if(!confirm('确认按当前节点批量通过 '+ids.length+' 条记录？'))return;try{await api('approvals/batch',{method:'POST',body:JSON.stringify({items:rows.filter(r=>ids.includes(r.id)).map(r=>({id:r.id,action:r.action})),note:'审批中心批量处理'})});toast('已完成批量审批');await approvals()}catch(e){toast(e.message)}};await paint();
}
const beforeOperationalEdit=edit;
edit=function(r={}){
 const kind=page,origin=['approvals','backups'].includes($('.shell')?.dataset.page)?$('.shell').dataset.page:null;
 dialogParent=$('.shell')?.dataset.page||page;beforeOperationalEdit(r);
 if(['points','expenses','vehicles','bonuses'].includes(kind)&&r.id){const panel=document.createElement('section');panel.className='calculation-panel';const s=r.parameter_snapshot||cfg;let text=kind==='points'?`${s.grades?.[r.grade]||0} 基础分 × ${s.roles?.[r.role]||0} 角色系数 × ${s.quality?.[r.quality]||0} 完成系数 = ${r.score||0} 分；每分 ${s.point_rate} 元`:kind==='expenses'?`${r.days||0} 天 × ${r.stay==='自行包干'?s.daily:s.provided} 元 + 住宿 ${r.lodging||0} 元 + 交通 ${r.transport||0} 元`:kind==='vehicles'?`${r.mode} · ${r.km||0} 公里；燃油 ${r.fuel||0} / 通行 ${r.toll||0} / 停车 ${r.parking||0} / 租车 ${r.rent||0} 元`:'项目奖金按核定金额记录，技术、财务和老板分别确认。';panel.innerHTML=`<h3>计算依据</h3><p>${esc(text)}</p><strong>¥ ${Number(r.amount||0).toFixed(2)}</strong>`;$('#editor').after(panel)}
 if(r.id){const area=document.createElement('section');area.className='attachment-panel';area.innerHTML=`<h3>附件与凭证</h3><p>图片、PDF、Word、Excel及文本，每个文件不超过10MB。</p><input type="file" id="attachment-file" accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.csv" aria-label="选择附件"><button type="button" id="upload-attachment">上传附件</button><div id="attachment-list">正在读取附件…</div>`;$('#modal').append(area);
 const locked=['已审核','待财务审核','待老板审批','已批准','已支付'].includes(r.status);const editable=hasRole('admin')||(['projects','tasks','milestones','issues','bonuses'].includes(kind)&&hasRole('manager'))||r.owner===me.id;
 if(locked||!editable){$('#attachment-file').disabled=true;$('#upload-attachment').disabled=true}
 const show=async()=>{const rows=await api('attachments?record='+r.id);if(!$('#attachment-list'))return;$('#attachment-list').innerHTML=rows.map(a=>`<div class="attachment-row"><a href="/api/attachments/${a.id}" target="_blank" rel="noopener">${esc(a.name)}</a><small>${Math.ceil(a.size/1024)} KB · ${esc(user(a.owner))}</small>${!locked&&editable?`<button type="button" data-remove-file="${a.id}">移除</button>`:''}</div>`).join('')||'<p>暂无附件。</p>';document.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=async()=>{if(confirm('确认移除此附件？'))try{await api('attachments/'+b.dataset.removeFile,{method:'DELETE'});show()}catch(e){toast(e.message)}})};
 $('#upload-attachment').onclick=async()=>{const file=$('#attachment-file').files[0];if(!file)return toast('请先选择文件');if(file.size>10*1024*1024)return toast('单个文件不能超过10MB');const button=$('#upload-attachment');button.disabled=true;button.textContent='上传中…';try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});await api('attachments',{method:'POST',body:JSON.stringify({record:r.id,name:file.name,mime:file.type,content:encoded})});await show();toast('附件上传完成')}catch(e){toast(e.message)}finally{button.disabled=false;button.textContent='上传附件'}};show().catch(e=>toast(e.message));
 }
};
let summaryVersion=0,summaryTimer;
summary=async function(){
 const month=window.reportMonth||date().slice(0,7),version=++summaryVersion;
 if(!$('#settlement-report')){
  $('#content').innerHTML=`<div class="page-heading"><div><div class="eyebrow">MONTHLY SETTLEMENT</div><h1>月度绩效结算</h1><p>测算、确认锁账、登记支付，三个阶段分别记录。</p></div><span id="settlement-status"></span></div><div class="view-toolbar"><label for="month">统计月份<input type="month" id="month" value="${esc(month)}"></label><button id="print">打印</button></div><p id="settlement-loading" role="status" aria-live="polite"></p><div id="settlement-report"></div>`;
  $('#month').required=true;
  $('#month').onchange=e=>{const value=e.target.value;++summaryVersion;clearTimeout(summaryTimer);document.querySelectorAll('.settlement-actions button').forEach(b=>b.disabled=true);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){$('#settlement-report').replaceChildren();$('#settlement-status').replaceChildren();$('#settlement-loading').textContent='请选择有效月份，未选择时不能结算或登记支付。';return}window.reportMonth=value;$('#settlement-loading').textContent='正在更新 '+value+'…';summaryTimer=setTimeout(()=>summary(),220)};
  $('#print').onclick=()=>print();
 }
 const report=$('#settlement-report');report.setAttribute('aria-busy','true');$('#settlement-loading').textContent='正在更新 '+month+'…';
 let d;try{d=await api('summary?month='+month)}catch(e){if(version===summaryVersion&&page==='summary'&&report.isConnected){report.setAttribute('aria-busy','false');$('#settlement-loading').textContent='加载失败：'+e.message+'。所选月份已保留，请重试。'}return}
 if(version!==summaryVersion||page!=='summary'||!report.isConnected||month!==(window.reportMonth||date().slice(0,7)))return;
 report.dataset.month=month;report.setAttribute('aria-busy','false');$('#settlement-loading').textContent='当前报表：'+month;
 $('#settlement-status').innerHTML=statusBadge(d.paid?'已支付':d.locked?'已确认':'待审核');
 report.innerHTML=`<div class="settlement-actions">${!d.locked&&hasRole('admin','boss')?'<button id="confirm-settlement" class="primary">确认并锁定本月</button>':''}${d.locked&&!d.paid&&hasRole('admin','finance')?'<button id="pay-settlement" class="primary">登记本月已支付</button>':''}${d.locked&&!d.paid&&hasRole('admin','boss')?'<button id="reopen-settlement">撤销结算</button>':''}</div><section class="calculation-panel"><p>${d.locked?'已锁账：使用确认时数据快照。':'当前为测算，未审核积分不计入。'} 奖金池 ¥${d.pool}，${d.capped?'按初算金额占比封顶分配':'未超过奖金池'}。</p>${!d.locked?`<p>待处理积分记录：${d.pending||0} 条。锁账前请审核或作废。</p>`:`<p>确认：${esc(user(d.confirmed_by))} · ${esc(d.confirmed_at)}${d.paid?'；支付：'+esc(user(d.paid_by))+' · '+esc(d.paid):''}</p>`}</section>${table(['人员','有效积分','初算奖金','确认 / 建议奖金'],d.rows.map(r=>[user(r.user),r.score,'¥ '+r.raw.toFixed(2),'¥ '+r.amount.toFixed(2)]))}`;
 if($('#confirm-settlement'))$('#confirm-settlement').textContent='确认并锁定 '+month;
 if($('#pay-settlement'))$('#pay-settlement').textContent='登记 '+month+' 已支付';
 if($('#reopen-settlement'))$('#reopen-settlement').textContent='撤销 '+month+' 结算';
 const run=async(action,reason)=>{if($('#month')?.value!==month||report.dataset.month!==month||report.getAttribute('aria-busy')==='true')return toast('月份已变更，请等待最新报表');try{await api(action==='pay'?'settlements/pay':'settlements',{method:'POST',body:JSON.stringify({month,action,reason})});toast('结算状态已更新');await summary()}catch(e){toast(e.message)}};
 if($('#confirm-settlement'))$('#confirm-settlement').onclick=()=>{if(confirm('确认锁定 '+month+' 的积分与奖金？锁定后该月积分不能修改。'))run('confirm')};
 if($('#pay-settlement'))$('#pay-settlement').onclick=()=>{if(confirm('确认本月奖金已实际支付？此操作登记付款，不会执行银行转账。'))run('pay')};
 if($('#reopen-settlement'))$('#reopen-settlement').onclick=()=>{const reason=prompt('请输入撤销结算原因');if(reason?.trim())run('reopen',reason)};
};
async function backupCenter(){const rows=await api('backups');$('#content').innerHTML=`<div class="page-heading"><div><div class="eyebrow">DATA CONTINUITY</div><h1>备份与恢复</h1><p>服务运行时每天自动备份一次；每小时检查当日备份是否已生成。附件、账号、审批与结算都包含在数据库中。</p></div><button id="new-backup" class="primary">立即完整备份</button></div><section class="glass-panel"><h2>备份文件</h2><div class="backup-list">${rows.map(r=>`<div class="attachment-row"><a href="/api/backups/download?name=${encodeURIComponent(r.name)}">${esc(r.name)}</a><small>${(r.size/1024).toFixed(1)} KB · ${esc(r.created)}</small></div>`).join('')||'<p>尚无备份。</p>'}</div></section><section class="glass-panel restore-guide"><h2>恢复流程</h2><p>先停止服务，执行恢复脚本，再重新启动。恢复前自动保留当前数据库，恢复后清除旧会话，所有人需重新登录。</p><code>python maintenance.py restore --source "备份完整路径.db" --stopped</code><p>恢复会校验数据库完整性、业务表及有效管理员。自动备份保存在 data/backups，请定期复制到另一台设备；服务关闭期间不会生成自动备份。</p></section>`;$('#new-backup').onclick=async()=>{try{await api('backups',{method:'POST',body:'{}'});toast('完整备份已创建');backupCenter()}catch(e){toast(e.message)}}}
const projectDetailBase=projectDetail;
projectDetail=async function(){await projectDetailBase();rememberRoute();if(detailTab!=='overview')return;const id=detailId;const insights=await api('project-insights');const d=insights.find(r=>r.project===id);if(!d||detailId!==id)return;const node=document.createElement('section');node.className='project-operating-panel glass-panel';node.innerHTML=`<div class="section-title"><h2>工期与成本</h2><span class="tiny-label">PROJECT OPERATIONS</span></div><div class="detail-stats"><div><strong>${d.standard_days||0}</strong><span>标准有效工日</span></div><div><strong>${d.actual_days||0}</strong><span>${hasRole('admin','manager','boss')?'累计有效工日':'可见日报有效工日'}</span></div><div><strong>${d.waiting_days||0}</strong><span>客观等待工日</span></div></div>${d.actual_cost!==undefined?`<div class="project-money-grid"><div>已批准 / 已支付费用<strong>¥ ${d.actual_cost.toFixed(2)}</strong></div><div>已确认项目奖金<strong>¥ ${d.confirmed_bonus.toFixed(2)}</strong></div><div>预算余额（预算减以上两项）<strong>¥ ${(Number(d.budget||0)-d.actual_cost-d.confirmed_bonus).toFixed(2)}</strong></div></div>`:''}<p>延期原因：${esc(d.delay_reason||'尚未记录')}。有效与等待工日按日报累计，历史未填工日的日报不自动推算。</p>`;$('#detail-content')?.append(node)};
const dashboardBase=dashboard;
dashboard=async function(){
 await dashboardBase();const role=workspace;
 if(role==='employee'){const mine=(await api('tasks')).filter(r=>r.owner===me.id&&r.status!=='已完成');const panel=$('.task-list');if(panel){panel.innerHTML=mine.map(taskRow).join('')||'<p>你的待办任务已完成。</p>';bindRecordButtons({tasks:mine})}const quick=document.createElement('div');quick.className='role-quick-actions';quick.innerHTML='<button data-quick="logs">写今天的日报</button><button data-quick="expenses">申请出差费用</button><button data-quick="vehicles">记录车辆费用</button>';$('.dashboard-heading').after(quick);quick.querySelectorAll('button').forEach(b=>b.onclick=()=>{page=b.dataset.quick;edit()});return}
 const rolePanel=document.createElement('section');rolePanel.className='role-focus glass-panel';
 if(role==='finance'){
  const all=await api('approvals'),cost=all.filter(r=>['expenses','vehicles','bonuses'].includes(r.kind));const pending=cost.filter(r=>r.action==='financial'),payment=cost.filter(r=>r.status==='已批准'),paid=cost.filter(r=>r.status==='已支付');
  rolePanel.innerHTML=`<h2>财务处理台</h2><div class="detail-stats"><div><strong>${pending.length}</strong><span>待财务核验</span></div><div><strong>¥${payment.reduce((s,r)=>s+Number(r.amount||0),0).toFixed(2)}</strong><span>待付款</span></div><div><strong>¥${paid.reduce((s,r)=>s+Number(r.amount||0),0).toFixed(2)}</strong><span>已登记付款</span></div></div><button data-go="approvals" class="primary">处理单据与付款</button>`;
 }else if(role==='manager'){
  const tasks=await api('tasks'),issues=await api('issues');const load=users.map(u=>({name:u.name,count:tasks.filter(t=>t.owner===u.id&&t.status!=='已完成').length})).filter(x=>x.count);rolePanel.innerHTML=`<h2>团队负荷与阻塞</h2><div class="load-bars">${load.map(x=>`<div><span>${esc(x.name)}</span><meter min="0" max="${Math.max(5,...load.map(x=>x.count))}" value="${x.count}"></meter><b>${x.count} 项</b></div>`).join('')||'<p>暂无待完成任务。</p>'}</div><p>未解决问题 ${issues.filter(i=>i.status!=='已解决').length} 项，优先确认客户等待和现场前提。</p><button data-go="approvals">审核技术成果与积分</button>`;
 }else if(role==='boss'){
  const insights=await api('project-insights');rolePanel.innerHTML=`<h2>经营与交付关注</h2><div class="detail-stats"><div><strong>¥${insights.reduce((s,r)=>s+Number(r.actual_cost||0),0).toLocaleString()}</strong><span>已批准业务费用</span></div><div><strong>¥${insights.reduce((s,r)=>s+Number(r.confirmed_bonus||0),0).toLocaleString()}</strong><span>已确认项目奖金</span></div><div><strong>${projects.filter(p=>p.due&&p.due<date()&&!['已完成','已归档'].includes(p.status)).length}</strong><span>超期未交付项目</span></div></div><button data-go="approvals" class="primary">进入老板审批</button><button data-go="summary">查看月度结算</button>`;
 }else{
  const backups=await api('backups');rolePanel.innerHTML=`<h2>系统运行与数据维护</h2><div class="detail-stats"><div><strong>${users.length}</strong><span>已建账号</span></div><div><strong>${backups.length}</strong><span>完整备份</span></div><div><strong>${backups[0]?backups[0].created.slice(5,16).replace('T',' '):'尚未生成'}</strong><span>最近备份时间</span></div></div><button data-go="users">管理账号权限</button><button data-go="backups">备份与恢复</button><button data-go="audit">查看操作日志</button>`;
 }
 $('.stat-strip').after(rolePanel);bindNavigation();
};
const synchronizedRender=render;let renderJobs=0;
render=async function(){renderJobs++;document.documentElement.dataset.busy='true';$('#root').setAttribute('aria-busy','true');try{return await synchronizedRender()}finally{renderJobs--;if(!renderJobs){delete document.documentElement.dataset.busy;$('#root').setAttribute('aria-busy','false')}}};
const rememberProjectCenter=projectCenter;projectCenter=async function(){await rememberProjectCenter();rememberRoute();applyDesktopStyle()};
if(history.state?.views)Object.assign(viewState,history.state.views);
// Explicit business filters and predictable controls, shared across list views.
const listFiltersOriginal=installListFilters;
installListFilters=async function(){
 await listFiltersOriginal();
 const kind=page, select=$('#filter-status');
 if(select){
  const workflow={points:['待审核','已审核','已退回'],expenses:['待审核','已审核','已退回','待老板审批','已批准','已支付'],vehicles:['待审核','已审核','已退回','待老板审批','已批准','已支付'],bonuses:['待审核','已退回','已确认','待财务审核','待老板审批','已批准','已支付']};
  const statuses=workflow[kind]||fields[kind]?.find(f=>f[0]==='status')?.[2]||[];
  select.innerHTML='<option value="">全部状态</option>'+statuses.map(s=>`<option>${esc(s)}</option>`).join('');
  if(!statuses.length){select.closest('label').hidden=true;viewState[kind].status=''}
  else select.value=viewState[kind].status;
 }
 enhanceMonth($('#filter-month'),true);
};
function enhanceMonth(input,allowAll=false){
 if(!input||input.parentElement.classList.contains('month-controls'))return;
 const box=document.createElement('span');box.className='month-controls';input.before(box);box.append(input);
 const move=delta=>{const value=input.value||date().slice(0,7),[y,m]=value.split('-').map(Number),next=new Date(y,m-1+delta,1);input.value=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');input.dispatchEvent(new Event('change',{bubbles:true}))};
 const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;box.append(b)};
 button('上月',()=>move(-1));button('下月',()=>move(1));button('本月',()=>{input.value=date().slice(0,7);input.dispatchEvent(new Event('change',{bubbles:true}))});
 if(allowAll)button('全部',()=>{input.value='';input.dispatchEvent(new Event('change',{bubbles:true}))});
 input.setAttribute('aria-label','选择月份');
}
const summaryBeforeControls=summary;summary=async function(){document.querySelectorAll('.settlement-actions button').forEach(b=>b.disabled=true);await summaryBeforeControls();enhanceMonth($('#month'));installDateWidgets()};
const peopleBeforeRename=people;people=async function(){await peopleBeforeRename();const selector=$('#person-id'),handler=selector.onchange;selector.onchange=e=>{handler(e);$('#people [name="name"]').disabled=false};const name=$('#people [name="name"]');name.required=true;name.previousElementSibling.textContent='姓名 / 登录账号（可修改）';name.parentElement.insertAdjacentHTML('beforeend','<small>改名后用新名称登录；历史业务仍关联原人员编号。</small>')};
function readableTime(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return esc(value);const two=n=>String(n).padStart(2,'0');return `<time class="readable-time" datetime="${esc(value)}"><span>${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}</span><small>${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}</small></time>`}
function polishTimes(){document.querySelectorAll('td,.review-panel p,.calculation-panel p,.attachment-row small').forEach(el=>{if(el.querySelector('.readable-time')||!(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(el.textContent)))return;el.innerHTML=el.innerHTML.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)/g,readableTime)})}
const timelineObserver=new ResizeObserver(entries=>entries.forEach(e=>layoutTimeline(e.target)));
function layoutTimeline(line){
 if(!line.isConnected){timelineObserver.unobserve(line);return}
 const buttons=[...line.querySelectorAll('.milestone-step')];
 const width=line.getBoundingClientRect().width,cols=width<500?1:Math.min(5,buttons.length,Math.max(2,Math.floor(width/230)));
 line.style.gridTemplateColumns=`repeat(${Math.max(1,cols)},minmax(0,1fr))`;
 buttons.forEach((b,i)=>{const row=Math.floor(i/cols);b.style.gridRow=row+1;b.style.gridColumn=row%2?cols-i%cols:i%cols+1});
 const rect=line.getBoundingClientRect(),dots=buttons.map(b=>{const r=b.querySelector('.milestone-number').getBoundingClientRect();return {x:r.left-rect.left+r.width/2,y:r.top-rect.top+r.height/2}});if(!dots.length)return;
 let path=`M${dots[0].x},${dots[0].y}`;dots.slice(1).forEach((p,i)=>{const prev=dots[i];if(cols===1)path+=` L${p.x},${p.y}`;else if(Math.abs(p.y-prev.y)<2)path+=` L${p.x},${p.y}`;else{const edge=i%cols===cols-1&&Math.floor(i/cols)%2===0?rect.width-2:2;path+=` H${edge} V${p.y} H${p.x}`}});
 let svg=line.querySelector('.route-wire');if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('route-wire');svg.setAttribute('aria-hidden','true');line.prepend(svg)}svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.innerHTML=`<path d="${path}" fill="none" stroke="#bacbd9" stroke-width="2" stroke-linejoin="round"/>`;
}
function prepareTimelines(){document.querySelectorAll('.milestone-line:not([data-route-ready])').forEach(line=>{line.dataset.routeReady='true';layoutTimeline(line);timelineObserver.observe(line)})}
const timeObserver=new MutationObserver(()=>{timeObserver.disconnect();polishTimes();prepareTimelines();timeObserver.observe(document.body,{childList:true,subtree:true})});timeObserver.observe(document.body,{childList:true,subtree:true});
// Delegation also covers cards repainted by project search or filters.
document.addEventListener('click',e=>{const card=e.target.closest('.project-card');if(!card||e.target.closest('button,a,input,select'))return;const link=card.querySelector('[data-project]');if(link)openProject(Number(link.dataset.project))});
installListFilters=async function(){
 const k=page,s=viewState[k]||{q:'',owner:'',project:'',status:'',month:'',date:'',page:1,size:k==='milestones'?100:12};viewState[k]=s;
 if(k==='logs')s.month='';if(k==='milestones')s.size=100;
 const statusMap={points:['待审核','已审核','已退回'],expenses:['待审核','已审核','已退回','待老板审批','已批准','已支付'],vehicles:['待审核','已审核','已退回','待老板审批','已批准','已支付'],bonuses:['待审核','已确认','已退回','待财务审核','待老板审批','已批准','已支付']};
 const statuses=statusMap[k]||fields[k].find(f=>f[0]==='status')?.[2]||[];
 const toolbar=$('.view-toolbar');if(!toolbar)return;
 $('#search').value=s.q;
 const box=document.createElement('section');box.className='record-filters aligned-filters';box.innerHTML=`<label class="filter-person">人员<select id="filter-owner"><option value="">全部人员</option>${users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label><label class="filter-project">项目<select id="filter-project"><option value="">全部项目</option>${projects.map(p=>`<option value="${p.id}">${esc(cleanTitle(p.title))}</option>`).join('')}</select></label><div class="filter-date"><label for="${k==='logs'?'filter-date':'filter-month'}">${k==='logs'?'日报日期':'月份'}</label><div class="date-tools"><input id="${k==='logs'?'filter-date':'filter-month'}" type="${k==='logs'?'date':'month'}" aria-label="${k==='logs'?'选择日报日期':'选择月份'}"><button id="date-current">${k==='logs'?'当日':'本月'}</button><button id="date-all">全部</button></div></div>${statuses.length?`<label class="filter-status">状态<select id="filter-status"><option value="">全部状态</option>${statuses.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label>`:''}<button id="filter-clear">重置筛选</button>`;
 toolbar.after(box);
 for(const key of ['owner','project',k==='logs'?'date':'month','status']){const el=$('#filter-'+key);if(!el){s[key]='';continue}el.value=s[key]||'';el.onchange=()=>{s[key]=el.value;s.page=1;pointStatus='全部';clearTimeout(listTimer);if(key==='date'||key==='month'){s.requestToken=(s.requestToken||0)+1;listTimer=setTimeout(()=>fetchList().catch(e=>toast(e.message)),220)}else fetchList().catch(e=>toast(e.message))}}
 const dateKey=k==='logs'?'date':'month',input=$('#filter-'+dateKey);
 $('#date-current').onclick=()=>{input.value=dateKey==='date'?date():date().slice(0,7);input.dispatchEvent(new Event('change'))};$('#date-all').onclick=()=>{input.value='';input.dispatchEvent(new Event('change'))};
 $('#filter-clear').onclick=()=>{Object.assign(s,{q:'',owner:'',project:'',month:'',date:'',status:'',page:1});$('#search').value='';box.querySelectorAll('select,input').forEach(el=>el.value='');fetchList().catch(e=>toast(e.message))};
 $('#search').oninput=e=>{s.q=e.target.value;s.page=1;clearTimeout(listTimer);listTimer=setTimeout(()=>fetchList().catch(e=>toast(e.message)),220)};
 await fetchList();
};
pagerHtml=function(d){return `<div class="pagination"><span>共 ${d.total} 条 · 第 ${d.page} / ${d.pages} 页</span><div class="pager-controls"><label>每页<select id="page-size" aria-label="每页条数">${[12,24,50,100].map(n=>`<option value="${n}" ${n===d.size?'selected':''}>${n} 条</option>`).join('')}</select></label><button id="prev-page" ${d.page<=1?'disabled':''}>上一页</button><button id="next-page" ${d.page>=d.pages?'disabled':''}>下一页</button><form id="page-jump"><label>跳至<input id="jump-number" type="number" min="1" max="${d.pages}" value="${d.page}" aria-label="跳转页码">页</label><button>跳转</button></form></div></div>`};
const sizedPager=pagerHtml;pagerHtml=d=>d.size?sizedPager(d):`<div class="pagination"><span>共 ${d.total} 条 · 第 ${d.page} / ${d.pages} 页</span><div><button id="prev-page" ${d.page<=1?'disabled':''}>上一页</button><button id="next-page" ${d.page>=d.pages?'disabled':''}>下一页</button></div></div>`;
function bindPager(data,actions){
 $('#prev-page').onclick=actions.previous;$('#next-page').onclick=actions.next;
 if($('#page-size'))$('#page-size').onchange=e=>actions.size(Number(e.target.value));
 if($('#page-jump'))$('#page-jump').onsubmit=e=>{e.preventDefault();actions.jump(Math.max(1,Math.min(data.pages,Number($('#jump-number').value)||1)))};
}
fetchList=async function(){
 const k=page,s=viewState[k];if(!s||!$('#list'))return;
 const token=(s.requestToken||0)+1;s.requestToken=token;
 const params={kind:k,...s};delete params.requestToken;
 const data=await api('list?'+new URLSearchParams(params));if(page!==k||s.requestToken!==token)return;
 if(k==='milestones'&&data.pages>1){const remaining=await Promise.all(Array.from({length:data.pages-1},(_,i)=>api('list?'+new URLSearchParams({...params,page:i+2}))));if(page!==k||s.requestToken!==token)return;data.items.push(...remaining.flatMap(d=>d.items))}
 records=data.items;s.page=data.page;if(k==='points')pointCounts=data.status_counts;renderingList=true;originalDraw();renderingList=false;
 if(k==='points'&&pointCounts){const allButton=document.querySelector('[data-point-filter="全部"] b');if(allButton)allButton.textContent=Object.values(pointCounts).reduce((a,b)=>a+b,0)}
 if(k!=='milestones'){
  $('#list').insertAdjacentHTML('beforeend',pagerHtml(data));
  const refreshPage=()=>fetchList().catch(e=>toast(e.message));bindPager(data,{previous:()=>{s.page--;refreshPage()},next:()=>{s.page++;refreshPage()},size:n=>{s.size=n;s.page=1;refreshPage()},jump:n=>{s.page=n;refreshPage()}});
 }
 $('.text-link[href*="export"]')?.setAttribute('href','/api/export?'+new URLSearchParams(params));
 if(k==='points')document.querySelectorAll('[data-point-filter]').forEach(b=>b.onclick=()=>{pointStatus=b.dataset.pointFilter;s.status=pointStatus==='全部'?'':pointStatus;s.page=1;$('#filter-status').value=s.status;fetchList().catch(e=>toast(e.message))});if(k==='milestones'){bindMilestoneOverview();addDesktopProgress()}rememberRoute();
};
const milestoneGrouped=milestoneView;
milestoneView=function(rows){
 if(page!=='milestones')return milestoneGrouped(rows);
 const groups=new Map();const selected=Number(viewState.milestones?.project||0);
 for(const p of projects)if(!selected||selected===p.id)groups.set(p.id,[]);
 for(const r of rows){if(!groups.has(r.project))groups.set(r.project,[]);groups.get(r.project).push(r)}
 const personal=!hasRole('admin','boss','manager','finance');
 const stats=items=>({done:items.filter(r=>r.status==='已达成').length,late:items.filter(r=>r.status!=='已达成'&&r.due&&r.due<date()).length,next:[...items].filter(r=>r.status!=='已达成').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'))[0]});
 const overview=`<section class="milestone-overview" id="milestone-overview"><div class="section-title"><h2>${personal?'我的项目节点总览':'项目里程碑总览'}</h2><span>${groups.size} 个可见项目 · ${rows.length} 个${personal?'本人负责的':''}节点</span></div><p class="milestone-scope">${personal?'仅统计本人负责的节点，不包含同项目其他人的工作。':'按当前人员、月份及状态筛选统计。'}点击卡片定位下方项目，点击“项目空间”查看完整项目。</p><div class="milestone-overview-grid">${[...groups].map(([id,items])=>{const s=stats(items),p=projects.find(p=>p.id===id);return `<button class="milestone-summary-card" data-milestone-jump="${id}"><strong>${esc(p?.title||'未关联项目')}</strong><div class="milestone-summary-numbers"><span>${s.done}/${items.length} 已达成</span><span class="${s.late?'late-count':''}">${s.late} 逾期</span></div><div class="progress"><i style="width:${items.length?s.done/items.length*100:0}%"></i></div><small>${s.next?'下一节点：'+esc(s.next.title)+' · '+esc(s.next.due||'待定'):items.length?'当前节点均已达成':'当前范围暂无节点'}</small></button>`}).join('')}</div></section>`;
 return overview+[...groups].map(([id,items])=>{const p=projects.find(p=>p.id===id),s=stats(items);return `<section class="milestone-project-group" id="milestone-project-${id}" tabindex="-1"><div class="milestone-group-heading"><div><h3>${esc(p?.title||'未关联项目')}</h3><small>${s.done}/${items.length} 已达成 · ${s.late} 逾期</small></div><div>${p?`<button data-project="${id}">项目空间</button>`:''}<button data-milestone-top>返回总览</button></div></div>${items.length?milestoneGrouped(items):'<p class="milestone-empty">当前权限或筛选范围内暂无节点。</p>'}</section>`}).join('');
};
function bindMilestoneOverview(){
 document.querySelectorAll('[data-milestone-jump]').forEach(b=>b.onclick=()=>{const target=document.getElementById('milestone-project-'+b.dataset.milestoneJump);target?.focus({preventScroll:true});target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})});
 document.querySelectorAll('[data-milestone-top]').forEach(b=>b.onclick=()=>document.getElementById('milestone-overview')?.scrollIntoView({behavior:'auto',block:'start'}));bindNavigation();
}
const recordDialog=$('#modal');
const draftFields='input[name],select[name],textarea[name],#workflow-note,#review-note,#attachment-file';
let originalValues=new Map();
function draftValue(field){
 if(field.multiple)return JSON.stringify([...field.selectedOptions].map(o=>o.value));
 if(field.type==='checkbox'||field.type==='radio')return field.checked;
 return field.value;
}
function captureDraftFields(){
 for(const field of recordDialog.querySelectorAll(draftFields)){
  if(!originalValues.has(field))originalValues.set(field,draftValue(field));
 }
}
function startDraftTracking(){
 originalValues=new Map();
 captureDraftFields();
}
new MutationObserver(captureDraftFields).observe(recordDialog,{childList:true,subtree:true});
function requestRecordClose(){
 const changed=[...originalValues].some(([field,value])=>recordDialog.contains(field)&&draftValue(field)!==value);
 if(!changed||window.confirm('有未保存的修改。确定放弃修改并关闭？选择“取消”可返回继续编辑。'))recordDialog.close();
}
function onBackdrop(event){
 if(event.target!==recordDialog)return false;
 const r=recordDialog.getBoundingClientRect();
 return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;
}
let pressedBackdrop=false;
recordDialog.addEventListener('pointerdown',event=>{pressedBackdrop=event.button===0&&onBackdrop(event)});
recordDialog.addEventListener('pointercancel',()=>{pressedBackdrop=false});
recordDialog.addEventListener('click',event=>{
 if(pressedBackdrop&&onBackdrop(event))requestRecordClose();
 pressedBackdrop=false;
});
recordDialog.addEventListener('cancel',event=>{if(event.defaultPrevented)return;event.preventDefault();requestRecordClose()});
const reviewUiEdit=edit;
edit=function(r={}){
 reviewUiEdit(r);const dialog=$('#modal'),title=dialog.querySelector('h2');
 const heading=document.createElement('div');heading.className='modal-heading';title.before(heading);heading.append(title);const close=dialog.querySelector('#cancel');close.id='dialog-close-top';close.textContent='×';close.title='关闭';close.setAttribute('aria-label','关闭编辑窗口');close.onclick=requestRecordClose;heading.append(close);
 dialog.querySelectorAll('label').forEach((label,i)=>{const input=label.parentElement.querySelector('input,select,textarea');if(input&&!label.contains(input)){input.id=input.id||'edit-field-'+i;label.htmlFor=input.id}});
 installDateWidgets(dialog);
};
function compactMobileUi(){
 const aside=$('aside');if(aside&&!$('#all-functions')){const button=document.createElement('button');button.id='all-functions';button.className='all-functions';button.textContent='全部功能';button.setAttribute('aria-expanded','false');$('nav').before(button);button.onclick=()=>{const expanded=aside.classList.toggle('menu-expanded');button.setAttribute('aria-expanded',expanded);button.textContent=expanded?'收起功能':'全部功能'}}
 const filters=$('.aligned-filters');if(filters&&!filters.querySelector('.filter-toggle')){const button=document.createElement('button');button.className='filter-toggle';button.textContent='更多筛选';button.setAttribute('aria-expanded','false');filters.prepend(button);button.onclick=()=>{const expanded=filters.classList.toggle('filters-expanded');button.setAttribute('aria-expanded',expanded);button.textContent=expanded?'收起筛选':'更多筛选'}}
}
const compactRender=render;render=async function(){await compactRender();compactMobileUi();installDateWidgets()};
// Two-page visual pilot. Existing nodes are moved so their actions remain intact.
const workbenchDashboard=dashboard;
dashboard=async function(){
 const issueRequest=api('issues').catch(()=>[]),approvalRequest=api('approvals');await workbenchDashboard();const [issues,approvalRows]=await Promise.all([issueRequest,approvalRequest]);if(page!=='dashboard')return;
 const tasks=$('.task-list'),recent=$('.recent-panel'),rolePanel=$('.role-focus'),quick=$('.role-quick-actions'),stats=$('.stat-strip');
 const taskRows=currentRelated.tasks||[];
 if(tasks&&taskRows.length)tasks.innerHTML=taskRows.filter(t=>t.status!=='已完成').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,6).map(taskRow).join('')||'<p class="workbench-empty">暂无待完成任务。</p>';
 stats?.querySelectorAll('.stat-tile strong').forEach(n=>{if(n.firstChild?.nodeType===Node.TEXT_NODE)n.firstChild.textContent=String(parseInt(n.firstChild.textContent,10)||0)});
 if(workspace!=='employee'&&stats){const tile=stats.querySelector('.stat-tile:last-child');tile.dataset.go='approvals';tile.dataset.approvalInbox='true';tile.querySelector('strong').innerHTML=approvalRows.filter(r=>r.action).length+'<small>条事项</small>'}
 const active=projects.filter(p=>!['已完成','已归档'].includes(p.status)).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
 const unresolved=issues.filter(r=>r.status!=='已解决');
 $('#content').innerHTML=`<div class="workbench-title"><h1>工作总览</h1><div><span>${esc(roleNames[workspace])}</span><button class="primary" data-go="${workspace==='employee'?'logs':'approvals'}">${workspace==='employee'?'写日报':'处理审批'}</button></div></div><div id="workbench-stats"></div><div id="workbench-quick"></div><div class="workbench-columns"><section class="workbench-section"><header><h2>${workspace==='employee'?'我的待办':'待完成任务'}</h2><button data-go="tasks">全部任务</button></header><div id="workbench-tasks"></div></section><section class="workbench-section"><header><h2>待解决问题 <span>${unresolved.length}</span></h2><button data-go="issues">查看全部</button></header><div class="workbench-issues">${unresolved.slice(0,4).map(r=>`<button data-record="issues:${r.id}"><strong>${esc(r.title)}</strong><small>${esc(project(r.project))} · ${esc(user(r.owner))} · ${esc(r.status)}</small></button>`).join('')||'<p class="workbench-empty">暂无未解决问题。</p>'}</div></section></div><section class="workbench-section workbench-projects"><header><h2>${workspace==='employee'?'参与的项目':'在做项目'} <span>${active.length}</span></h2><button data-go="projects">项目管理</button></header><div class="workbench-project-list">${active.map(p=>`<button class="workbench-project-row" data-project="${p.id}"><div><strong>${esc(p.title)}</strong><small>${esc(p.code||'未编号')} · ${esc(p.client||'未填写客户')}</small></div><span class="workbench-person">${esc(user(p.owner))}</span><span class="workbench-due ${p.due&&p.due<date()?'is-late':''}">${p.due&&p.due<date()?'逾期 · ':''}${esc(p.due||'未定日期')}</span><span class="workbench-progress">${Number(p.progress)||0}%</span>${statusBadge(p.status)}</button>`).join('')||'<p class="workbench-empty">暂无进行中的项目。</p>'}</div></section><div class="workbench-columns workbench-secondary"><section id="workbench-role"></section><section id="workbench-recent"></section></div>`;
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const groups=[
  ['今天及逾期',r=>r.waiting_on&&r.followup&&r.followup<=today],
  ['待排跟进日期',r=>r.waiting_on&&!r.followup],
  ['后续跟进',r=>r.waiting_on&&r.followup>today],
  ['内部待处理',r=>!r.waiting_on&&r.status==='待处理']
 ];
 const triage=document.createElement('section');triage.className='workbench-section';
 triage.innerHTML=`<header><h2>问题分流与外部跟进</h2><select aria-label="跟进队列">${groups.map(([label,test],i)=>`<option value="${i}">${label}（${unresolved.filter(test).length}）</option>`).join('')}</select></header><div class="workbench-issues"></div>`;
 $('.workbench-columns').before(triage);
 const select=triage.querySelector('select');
 function showQueue(){
  const rows=unresolved.filter(groups[Number(select.value)][1]).sort((a,b)=>(a.followup||'').localeCompare(b.followup||'')||a.id-b.id);
  triage.querySelector('.workbench-issues').innerHTML=rows.map(r=>`<button data-record="issues:${r.id}"><strong>${esc(r.title)}</strong><small>${esc(project(r.project))} · ${r.waiting_on?'等待 '+esc(r.waiting_on):'负责人 '+esc(user(r.owner))} · ${esc(r.followup||'未排期')}</small></button>`).join('')||'<p class="workbench-empty">此队列暂无事项。</p>';
  bindRecordButtons({issues,tasks:taskRows});
 }
 select.onchange=showQueue;showQueue();
 if(stats)$('#workbench-stats').append(stats);if(tasks)$('#workbench-tasks').append(tasks);if(quick)$('#workbench-quick').append(quick);if(rolePanel)$('#workbench-role').append(rolePanel);if(recent)$('#workbench-recent').append(recent);
 bindNavigation();bindRecordButtons({issues,tasks:taskRows});
 document.querySelectorAll('[data-approval-inbox]').forEach(button=>button.onclick=()=>{sessionStorage.setItem('approval-tab','mine');navigate('approvals')});
};
const pilotRender=render;render=async function(){await pilotRender();applyDesktopStyle();if(['dashboard','milestones'].includes(page)){
 const heading=$('.page-heading');if(page==='milestones'&&heading){heading.querySelector('h1').textContent='里程碑';heading.querySelectorAll('.eyebrow,p').forEach(e=>e.remove())}
 if(page==='milestones'&&$('.milestone-scope'))$('.milestone-scope').textContent=hasRole('admin','boss','manager','finance')?'按当前筛选统计，点击项目行查看下方节点。':'仅统计本人负责的节点，点击项目行查看下方节点。';
 addDesktopProgress();
 $('.footer-motto')?.replaceChildren();
}};
function addDesktopProgress(){
 if(!matchMedia('(min-width:851px)').matches)return;
 document.querySelectorAll('.workbench-progress:not([data-visual-progress])').forEach(node=>{
  const value=Math.max(0,Math.min(100,parseFloat(node.textContent)||0));node.dataset.visualProgress='true';
  node.innerHTML=`<span>${value}%</span><span class="workbench-progress-track" role="progressbar" aria-label="项目进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i style="width:${value}%"></i></span>`;
 });
 document.querySelectorAll('.milestone-summary-card>.progress').forEach(track=>{
  const value=Math.round(parseFloat(track.querySelector('i')?.style.width)||0),wrap=document.createElement('span');wrap.className='milestone-progress-summary';
  track.before(wrap);wrap.append(track);track.setAttribute('role','progressbar');track.setAttribute('aria-label','里程碑已达成比例');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',value);
  const text=document.createElement('span');text.textContent=value+'%';wrap.append(text);
 });
}
function applyDesktopStyle(){
 if(!matchMedia('(min-width:851px)').matches)return;
 const shell=$('.shell');if(!shell)return;shell.classList.add('desktop-workbench');document.documentElement.classList.add('desktop-workbench-mode');
 if(page==='projects'&&!detailId&&$('.page-heading h1'))$('.page-heading h1').textContent='项目管理';
 const copy={tasks:'按负责人和截止日期查看任务。',issues:'跟进问题、影响与处理结果。',logs:'记录现场工作、成果与客观等待。',points:'按工作难度、角色和完成评价计分。',expenses:'出差补贴、住宿与交通费用。',vehicles:'公务用车、私车和租车费用。',bonuses:'项目节点奖金与支付记录。',approvals:'按当前审批节点处理，退回需注明原因。',audit:'账号、参数、业务修改和审批记录。',projects:'查看项目进度、负责人及交付安排。'};
 const intro=$('.page-heading>div>p');if(intro&&copy[page])intro.textContent=copy[page];
 const motto=$('.footer-motto');if(motto)motto.textContent='';
 if(page==='points')document.querySelectorAll('.points-table tbody tr').forEach(tr=>{const cell=tr.children[0];if(!cell||cell.querySelector('.point-secondary-meta'))return;const meta=document.createElement('small');meta.className='point-secondary-meta';meta.textContent=(tr.children[1]?.textContent.trim()||'')+' · '+(tr.children[2]?.textContent.trim()||'');cell.append(meta)});
}
// The workflow extension registers project tools before starting the application.
