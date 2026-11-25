const roleNames={admin:'管理员',boss:'老板',finance:'财务 / 商务',manager:'技术经理',employee:'员工'};
const menuByRole={admin:['dashboard','projects','tasks','milestones','issues','logs','points','expenses','vehicles','bonuses','summary','settings','users','audit'],boss:['dashboard','projects','points','expenses','vehicles','bonuses','summary','settings','audit'],finance:['dashboard','projects','expenses','vehicles','bonuses','summary'],manager:['dashboard','projects','tasks','milestones','issues','logs','points','bonuses','summary'],employee:['dashboard','projects','tasks','milestones','issues','logs','points','expenses','vehicles','summary']};
let workspace=localStorage.getItem('workspace')||'';
function hasRole(...r){return (me.roles||[me.role]).some(x=>r.includes(x))}
const baseRender=render,baseEdit=edit,baseDraw=draw,baseDashboard=dashboard;
render=async function(){
 let assigned=me.roles||[me.role];if(!assigned.includes(workspace))workspace=assigned[0];
 let allowed=menuByRole[workspace];if(!allowed.includes(page))page='dashboard';
 const original=me.role;me.role='admin';try{await baseRender()}finally{me.role=original}
 document.querySelectorAll('[data-nav]').forEach(b=>{if(!allowed.includes(b.dataset.nav))b.remove()});
 const header=$('.top>div:last-child');header.innerHTML=`<div class="workspace-switch"><span>${esc(me.name)}</span><select aria-label="切换工作台" id="workspace">${assigned.map(r=>`<option value="${r}" ${r===workspace?'selected':''}>${roleNames[r]}工作台</option>`).join('')}</select><button id="logout">退出</button></div>`;
 $('#workspace').onchange=e=>{workspace=e.target.value;localStorage.setItem('workspace',workspace);page='dashboard';render().catch(x=>toast(x.message))};
 $('#logout').onclick=async()=>{await api('logout',{method:'POST'});login()};
 if(['projects','bonuses'].includes(page)&&!hasRole('admin','manager'))$('#new')?.remove();
};
edit=function(r={}){
 const original=me.role;if(hasRole('admin','manager'))me.role='admin';try{baseEdit(r)}finally{me.role=original}
 const sel=$('#editor [name="status"]');if(['points','expenses','vehicles','bonuses'].includes(page)&&sel){sel.innerHTML='<option value="待审核">待审核</option>';if(r.status&&r.status!=='已退回'){sel.innerHTML=`<option>${esc(r.status)}</option>`}}
 const locked=['已审核','已批准','已支付','待财务审核','待老板审批'].includes(r.status);
 const editable=hasRole('admin')||(['projects','tasks','milestones','issues','bonuses'].includes(page)&&hasRole('manager'))||(!['projects','bonuses'].includes(page)&&(!r.id||r.owner===me.id));
 if(locked||!editable){$('#editor').querySelectorAll('input,select,textarea,button').forEach(el=>{if(el.id!=='cancel')el.disabled=true})}
 if(!r.id||!['points','expenses','vehicles','bonuses'].includes(page))return;
 const actions=[];const pending=['待审核','已退回'].includes(r.status);
 if(['points','bonuses'].includes(page)&&hasRole('admin','manager')&&pending)actions.push(['technical','技术审核通过']);
 if(['expenses','vehicles','bonuses'].includes(page)&&hasRole('admin','finance')&&(page==='bonuses'?r.status==='待财务审核':pending))actions.push(['financial','财务审核通过']);
 if(hasRole('admin','boss')&&r.status==='待老板审批')actions.push(['approve','批准']);
 if(hasRole('admin','finance')&&r.status==='已批准')actions.push(['pay','登记已支付']);
 if(hasRole('admin','boss','finance','manager')&&r.status!=='已支付')actions.push(['reject','退回修改']);
 if(actions.length){const area=document.createElement('section');area.className='review-panel';area.innerHTML=`<h3>审批操作</h3><p>当前状态：${esc(r.status||'待审核')}</p><label for="review-note">审核意见（退回必填）</label><textarea id="review-note"></textarea><div class="actions">${actions.map(([a,l])=>`<button type="button" data-review="${a}">${l}</button>`).join('')}</div>`;$('#modal').append(area);area.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(page+'/'+r.id+'/review',{method:'POST',body:JSON.stringify({action:b.dataset.review,note:$('#review-note').value})});$('#modal').close();toast('审批已记录');await refresh()}catch(x){toast(x.message);b.disabled=false}})}
 if(r.review_history?.length){const h=document.createElement('div');h.innerHTML='<h3>审批历史</h3>'+r.review_history.map(v=>`<p>${esc(v.at)} · ${esc(user(v.by))} · ${esc(v.action)}<br>${esc(v.note)}</p>`).join('');$('#modal').append(h)}
};
dashboard=async function(){
 const settings={admin:['系统管理工作台','管理账号和角色，核对业务数据与操作记录。'],boss:['经营与审批工作台','关注项目进展、待批费用和奖金支付。'],finance:['财务商务工作台','审核费用、核对金额，并登记批准后的付款。'],manager:['技术管理工作台','安排任务、跟进交付，审核工作成果与积分。'],employee:['我的工作台','查看任务、提交日报，记录出差费用与个人积分。']};
 await baseDashboard();const t=settings[workspace]||settings.employee;$('#content').insertAdjacentHTML('afterbegin',`<section class="welcome"><span class="badge">${esc(roleNames[workspace])}</span><h2>${t[0]}</h2><p>${t[1]}</p></section>`);
 if(!hasRole('admin'))$('#content a[href="/api/backup"]')?.parentElement.remove();
 const kinds=workspace==='boss'?['expenses','vehicles','bonuses']:workspace==='finance'?['expenses','vehicles','bonuses']:workspace==='manager'?['points','bonuses']:[];
 if(kinds.length){let sets=await Promise.all(kinds.map(k=>api(k)));let waiting=[];sets.forEach((rows,i)=>rows.forEach(r=>{const ok=workspace==='boss'?r.status==='待老板审批':workspace==='finance'?(r.status==='已批准'||r.status==='待财务审核'||(kinds[i]!=='bonuses'&&r.status==='待审核')):r.status==='待审核';if(ok)waiting.push({...r,kind:kinds[i]})}));const section=document.createElement('section');section.className='panel inbox';section.innerHTML=`<h2>待办审批 <span class="badge">${waiting.length}</span></h2>${waiting.length?waiting.slice(0,10).map(r=>`<button class="inbox-item" data-kind="${r.kind}" data-id="${r.id}"><span>${esc(r.title)}</span><span>${esc(user(r.owner))} · ${esc(r.status)}　查看 →</span></button>`).join(''):'<p>当前没有待处理审批。</p>'}`;$('#content').insertBefore(section,$('#content .split'));section.querySelectorAll('button').forEach(b=>b.onclick=async()=>{page=b.dataset.kind;await render();edit(records.find(r=>r.id==b.dataset.id))})}
};
people=async function(){
 $('#content').innerHTML=`<section class="panel"><h2>账号与多角色分配</h2>${table(['账号','已分配角色'],users.map(u=>[u.name,(u.roles||[u.role]).map(r=>roleNames[r]).join('、')]))}<h2 style="margin-top:28px">新建 / 调整账号</h2><form id="people"><div class="formgrid"><div><label>选择已有账号（留空则新建）</label><select name="id" id="person-id"><option value="">新建账号</option>${users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>${control('name','新账号名称')}${control('password','密码（新建必填；已有账号可留空）','password')}<div class="full"><label>角色（可多选）</label><div class="role-checks">${Object.entries(roleNames).map(([k,l])=>`<label><input type="checkbox" name="roles" value="${k}" ${k==='employee'?'checked':''}>${l}</label>`).join('')}</div></div></div><p>切换工作台只改变展示；服务器始终按账号实际角色校验权限。</p><div class="actions"><button class="primary">保存账号与角色</button></div></form></section>`;
 $('#person-id').onchange=e=>{const u=users.find(x=>x.id==e.target.value);$('#people [name="name"]').value=u?.name||'';$('#people [name="name"]').disabled=!!u;document.querySelectorAll('[name="roles"]').forEach(x=>x.checked=u?(u.roles||[u.role]).includes(x.value):x.value==='employee')};
 $('#people').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),d=Object.fromEntries(fd);d.roles=fd.getAll('roles');try{await api('users',{method:'POST',body:JSON.stringify(d)});users=await api('users');toast('账号角色已保存；被调整账号需重新登录');people()}catch(x){toast(x.message)}};
};
// Experience layer starts the application.
