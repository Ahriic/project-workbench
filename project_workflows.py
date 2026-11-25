"""Small-team project workflows. Uses the existing records, audit and attachments."""
import json
from datetime import datetime,timedelta

TEMPLATES={
 'PLC改造':{'tasks':['核对原程序与I/O点表','离线修改并备份程序','现场联动及异常测试','交付培训与资料整理'],'milestones':['方案与点表确认','现场调试完成','稳定运行与交付验收']},
 '设备调试':{'tasks':['检查接线和现场条件','完成单机及联动测试','确认异常保护与恢复','整理测试和交付资料'],'milestones':['现场条件确认','联动试运行','交付验收']},
 '故障处理':{'tasks':['定位故障并备份现场信息','实施恢复及回退准备','验证连续运行情况'],'milestones':['故障定位','恢复运行','处理结果确认']}
}

def validate(kind,d,a):
 if kind=='issues':
  if d.get('impact') not in (None,'','不影响交期','影响交期','待评估'):raise ValueError('交期影响无效')
 if kind=='changes':
  d.setdefault('date',a.now()[:10])
  d.setdefault('status','已提出')
  if d['status'] not in {'已提出','待确认','已确认','已撤销'}:raise ValueError('变更状态无效')
 if kind=='deliverables':
  d.setdefault('status','待提交')
  if d['status'] not in {'待提交','待验收','已验收'}:raise ValueError('交付状态无效')
 for key in ['extra_days','extra_cost']:
  if key in d:d[key]=a.finite_number(d[key],key)
 if d.get('followup'):
  try:datetime.strptime(d['followup'],'%Y-%m-%d')
  except (ValueError,TypeError):raise ValueError('跟进日期必须是真实日期')

def validate_links(c,a,u,kind,d,project):
 if kind in {'changes','deliverables'} and not project:raise ValueError('请关联项目')
 for key,target in [('issue','issues'),('milestone','milestones')]:
  if not d.get(key):continue
  row=c.execute('SELECT * FROM records WHERE id=? AND kind=? AND deleted=0',(int(d[key]),target)).fetchone()
  if not row or row['project']!=project or not a.visible(c,u,row):raise ValueError('关联记录须属于同一项目且有权查看')

def apply_template(c,a,u,pid,name):
 if not a.has(u,'admin','manager'):raise ValueError('仅管理员或技术经理可应用项目模板')
 if name not in TEMPLATES:raise ValueError('项目模板无效')
 project=c.execute("SELECT * FROM records WHERE id=? AND kind='projects' AND deleted=0",(pid,)).fetchone()
 if not project or not a.visible(c,u,project):raise ValueError('项目不存在')
 data=json.loads(project['data'])
 if data.get('applied_template'):raise ValueError('项目已应用模板，不重复生成')
 start=datetime.strptime(data.get('start') or a.now()[:10],'%Y-%m-%d').date();owner=project['owner'];created=[]
 for kind,items in [('tasks',TEMPLATES[name]['tasks']),('milestones',TEMPLATES[name]['milestones']),('deliverables',['程序备份','电气图与点表','参数表','操作说明','验收单'])]:
  for i,title in enumerate(items):
   record={'title':title,'due':(start+timedelta(days=i+1)).isoformat(),'status':{'tasks':'待开始','milestones':'未达成','deliverables':'待提交'}[kind],
           'note':'模板生成，目标日期为占位计划，请按实际项目调整。','template_source':name}
   record=a.validated(kind,record,a.settings(c));rid=c.execute('INSERT INTO records(kind,owner,project,data,created,updated) VALUES(?,?,?,?,?,?)',(kind,owner,pid,json.dumps(record,ensure_ascii=False),a.now(),a.now())).lastrowid;created.append(rid)
 data['members']=list(dict.fromkeys(data.get('members',[])+[owner]))
 data['applied_template']={'name':name,'at':a.now(),'by':u['id'],'records':created}
 c.execute('UPDATE records SET data=?,updated=? WHERE id=?',(json.dumps(data,ensure_ascii=False),a.now(),pid));a.features.audit(c,a,u,'应用项目模板 '+name,pid,details={'generated':created})
 return created

def transition(c,a,u,row,body):
 kind=row['kind'];d=json.loads(row['data']);target=body.get('status');owner=row['owner']==u['id'];manager=a.has(u,'admin','manager');boss=a.has(u,'admin','boss')
 if kind=='changes':
  current=d.get('status');allowed=(target=='待确认' and current=='已提出' and (owner or manager)) or (target in {'已确认','已提出'} and current=='待确认' and boss) or (target=='已撤销' and current!='已撤销' and (boss or (current!='已确认' and (owner or manager))))
  if not allowed:raise ValueError('当前状态或角色不允许此变更操作')
  if target in {'已确认','已提出'} and not str(body.get('note','')).strip():raise ValueError('确认或退回变更需填写依据')
 elif kind=='deliverables':
  allowed=(target=='待验收' and d.get('status')=='待提交' and (owner or manager)) or (target in {'已验收','待提交'} and d.get('status')=='待验收' and manager)
  if not allowed:raise ValueError('当前状态或角色不允许此交付操作')
  if target!='待提交' and not c.execute('SELECT 1 FROM attachments WHERE record_id=? AND deleted=0',(row['id'],)).fetchone():raise ValueError('请先上传交付资料')
  if target=='待提交' and not str(body.get('note','')).strip():raise ValueError('退回资料需填写原因')
 else:raise ValueError('流程类型无效')
 before=json.loads(json.dumps(d));d['status']=target;d.setdefault('workflow_history',[]).append({'status':target,'by':u['id'],'at':a.now(),'note':str(body.get('note',''))})
 c.execute('UPDATE records SET data=?,updated=? WHERE id=?',(json.dumps(d,ensure_ascii=False),a.now(),row['id']));a.features.audit(c,a,u,'项目流程 '+target,row['id'],details={'before':before,'after':d})

def route(h,c,u,path,method,body,a):
 if path=='/api/project-templates' and method=='GET':h.send(200,TEMPLATES);return True
 parts=path.strip('/').split('/')
 if len(parts)==4 and parts[0]=='api' and parts[1]=='projects' and parts[3]=='apply-template' and method=='POST':
  c.execute('BEGIN IMMEDIATE');ids=apply_template(c,a,u,int(parts[2]),body.get('template'));h.send(200,{'created':ids});return True
 if len(parts)==4 and parts[0]=='api' and parts[1] in {'changes','deliverables'} and parts[3]=='transition' and method=='POST':
  c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM records WHERE id=? AND kind=? AND deleted=0',(int(parts[2]),parts[1])).fetchone()
  if not row or not a.visible(c,u,row):raise ValueError('记录不存在或无权查看')
  transition(c,a,u,row,body);h.send(200,{'ok':True});return True
 return False
