"""Operational workflows; all access checks run on the server."""
import json,base64,re,sqlite3,threading,time,zipfile,io,math
from pathlib import Path
from decimal import Decimal,ROUND_DOWN
from urllib.parse import parse_qs,urlparse,quote

def initialize(c):
 c.executescript('''CREATE TABLE IF NOT EXISTS settlements(month TEXT PRIMARY KEY,data TEXT NOT NULL,created TEXT,confirmed_by INTEGER,paid TEXT,paid_by INTEGER);
 CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY,record_id INTEGER,name TEXT,mime TEXT,content BLOB,owner INTEGER,created TEXT,deleted INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS login_attempts(account TEXT,ip TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS backup_manifest(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS record_kind ON records(kind,deleted);
 CREATE INDEX IF NOT EXISTS attachment_record ON attachments(record_id,deleted);''')
 if 'details' not in {r[1] for r in c.execute('PRAGMA table_info(audit)')}:c.execute('ALTER TABLE audit ADD COLUMN details TEXT')
def month_valid(s):
 if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',s):raise ValueError('月份格式应为YYYY-MM')
 return s
def ensure_unlocked(c,kind,d):
 if kind=='points' and c.execute('SELECT 1 FROM settlements WHERE month=?',(str(d.get('date',''))[:7],)).fetchone():raise ValueError('该月份已锁账，不能修改积分或审核；请由老板撤销结算后操作')
def audit(c,a,u,action,rid=None,details=None):c.execute('INSERT INTO audit(user_id,action,record_id,created,details) VALUES(?,?,?,?,?)',(u['id'],action,rid,a.now(),json.dumps(details,ensure_ascii=False,allow_nan=False) if details is not None else None))
def summary(c,a,month):
 month_valid(month);locked=c.execute('SELECT * FROM settlements WHERE month=?',(month,)).fetchone()
 if locked:return dict(json.loads(locked['data']),locked=True,confirmed_at=locked['created'],confirmed_by=locked['confirmed_by'],paid=locked['paid'],paid_by=locked['paid_by'])
 totals={};pending=0
 for r in c.execute("SELECT * FROM records WHERE kind='points' AND deleted=0"):
  d=json.loads(r['data'])
  if str(d.get('date',''))[:7]!=month:continue
  if d.get('status')!='已审核':pending+=1;continue
  v=totals.setdefault(r['owner'],{'score':Decimal(0),'raw':Decimal(0),'ids':[]})
  v['score']+=Decimal(str(d.get('score',0)));v['raw']+=Decimal(str(d.get('amount',0)));v['ids'].append(r['id'])
 s=a.settings(c);pool=Decimal(str(s['pool'])).quantize(Decimal('.01'));raw=sum((r['raw'] for r in totals.values()),Decimal(0));capped=raw>pool
 exact={i:(pool*v['raw']/raw if capped else v['raw']) for i,v in totals.items()}
 amounts={i:v.quantize(Decimal('.01'),rounding=ROUND_DOWN) for i,v in exact.items()}
 target=pool if capped else raw.quantize(Decimal('.01'))
 remainder=int((target-sum(amounts.values(),Decimal(0)))*100)
 for i in sorted(amounts,key=lambda i:(-(exact[i]-amounts[i]),i))[:remainder]:amounts[i]+=Decimal('.01')
 return {'month':month,'rows':[{'user':i,'score':float(v['score']),'raw':float(v['raw']),'amount':float(amounts[i]),'record_ids':v['ids']} for i,v in sorted(totals.items())],'pool':float(pool),'capped':capped,'pending':pending,'locked':False,'parameters':s}
def filtered_summary(c,a,u,month):
 d=summary(c,a,month)
 if not a.has(u,'admin','boss','finance','manager'):d['rows']=[r for r in d['rows'] if r['user']==u['id']]
 return d
def pending_action(a,u,r):
 d=json.loads(r['data']);k=r['kind'];s=d.get('status')
 if k=='changes' and s=='待确认' and a.has(u,'admin','boss'):return 'confirm_change'
 if k=='deliverables' and s=='待验收' and a.has(u,'admin','manager'):return 'accept_delivery'
 if k in {'points','bonuses'} and s in {'待审核','已退回','已确认'} and a.has(u,'admin','manager'):return 'technical'
 if k in {'expenses','vehicles','bonuses'} and (s=='待财务审核' or (k!='bonuses' and s in {'待审核','已审核','已退回'})) and a.has(u,'admin','finance'):return 'financial'
 if s=='待老板审批' and a.has(u,'admin','boss'):return 'approve'
 if s=='已批准' and a.has(u,'admin','finance'):return 'pay'
 return None
def review(c,a,u,r,body):
 d=json.loads(r['data']);kind=r['kind'];rid=r['id'];ensure_unlocked(c,kind,d)
 action=body.get('action');note=str(body.get('note','')).strip()
 if action!='reject' and action!=pending_action(a,u,r):raise ValueError('无权执行此审核或当前状态不允许此操作')
 if action in {'confirm_change','accept_delivery'}:
  a.project_workflows.transition(c,a,u,r,{'status':'已确认' if action=='confirm_change' else '已验收','note':note});return
 if action=='reject':
  allowed=('admin','manager') if kind=='points' else ('admin','manager','finance','boss') if kind=='bonuses' else ('admin','finance','boss') if kind in {'expenses','vehicles'} else ()
  if not a.has(u,*allowed):raise ValueError('无权退回此记录')
  if not note:raise ValueError('退回必须填写原因')
  if d.get('status')=='已支付':raise ValueError('已支付记录不能退回')
  d['status']='已退回'
  for k in ['technical_review','financial_review','boss_review']:d.pop(k,None)
 else:
  key={'technical':'technical_review','financial':'financial_review','approve':'boss_review','pay':'payment'}[action]
  d[key]={'by':u['id'],'at':a.now()}
  if action=='pay':
   details=body.get('payment_details')
   if details is not None:
    if not isinstance(details,dict):raise ValueError('付款信息无效')
    date=str(details.get('date',''))
    try:a.datetime.strptime(date,'%Y-%m-%d')
    except ValueError:raise ValueError('请填写实际支付日期')
    if date>a.now()[:10]:raise ValueError('实际支付日期不能是未来日期')
    amount=a.money(a.finite_number(details.get('amount'),'实际支付金额'))
    if amount!=a.money(d.get('amount',0)):raise ValueError('当前按一次付清登记，实付金额须与批准金额一致')
    method=details.get('method')
    if method not in {'银行转账','现金','其他'}:raise ValueError('付款方式无效')
    if not str(details.get('reference','')).strip():raise ValueError('请填写付款流水或核对说明')
    proofs=[x[0] for x in c.execute('SELECT id FROM attachments WHERE record_id=? AND deleted=0',(rid,))]
    d['payment'].update(date=date,amount=amount,method=method,reference=str(details['reference']),attachments=proofs)
   else:raise ValueError('请先填写实际支付日期、金额、方式和核对说明')
  d['status']={'technical':'已审核' if kind=='points' else '待财务审核','financial':'待老板审批','approve':'已批准','pay':'已支付'}[action]
 d.setdefault('review_history',[]).append({'action':action,'by':u['id'],'at':a.now(),'note':note})
 c.execute('UPDATE records SET data=?,updated=? WHERE id=?',(json.dumps(d),a.now(),rid));audit(c,a,u,'审核 '+str(action),rid)
def make_backup(a,label='auto'):
 root=a.DB.parent/'backups';root.mkdir(parents=True,exist_ok=True);name=a.datetime.now(a.TZ).strftime('%Y%m%d-%H%M%S-%f')+'-'+label+'.db';dest=root/name
 with a.connection() as src,sqlite3.connect(dest,factory=a.ClosingConnection) as target:
  src.backup(target)
  counts={t:target.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['users','records','settings','audit','attachments','settlements']}
  target.execute('INSERT OR REPLACE INTO backup_manifest VALUES(1,?)',(json.dumps({'version':2,'created':a.now(),'counts':counts}),))
 with sqlite3.connect(dest,factory=a.ClosingConnection) as check:
  if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('备份完整性检查失败')
 return dest
def backup_worker(a):
 def run():
  while True:
   try:
    folder=a.DB.parent/'backups';today=a.datetime.now(a.TZ).strftime('%Y%m%d')
    if not folder.exists() or not any(folder.glob(today+'*-auto.db')):make_backup(a)
   except Exception as e:print('自动备份失败：'+str(e),flush=True)
   time.sleep(3600)
 threading.Thread(target=run,daemon=True).start()
def route(h,c,u,path,method,body,a):
 def send(code,d,ctype='application/json; charset=utf-8',extra=None):h.send(code,d,ctype,extra);return True
 query=parse_qs(urlparse(h.path).query)
 if path=='/api/export' and method=='GET':
  import csv
  stream=io.StringIO();w=csv.writer(stream);w.writerow(['记录编号','类别','名称','项目编号','所属人员','日期','状态','积分','金额','备注'])
  def safe(v):
   v=str(v or '');return "'"+v if v[:1] in {'=','+','-','@','\t','\r'} else v
  for r in c.execute('SELECT * FROM records WHERE deleted=0 ORDER BY id DESC'):
   if not a.visible(c,u,r):continue
   d=a.serialize(c,u,r)
   if query.get('kind') and r['kind']!=query['kind'][0]:continue
   if query.get('month') and str(d.get('date',d.get('due','')))[:7]!=query['month'][0]:continue
   if query.get('project',[''])[0] and r['project']!=int(query['project'][0]):continue
   if query.get('owner',[''])[0] and r['owner']!=int(query['owner'][0]):continue
   if query.get('status',[''])[0] and d.get('status')!=query['status'][0]:continue
   if query.get('q',[''])[0].lower() not in json.dumps(d,ensure_ascii=False).lower():continue
   if query.get('date',[''])[0] and str(d.get('date',d.get('due','')))[:10]!=query['date'][0]:continue
   user=c.execute('SELECT name FROM users WHERE id=?',(r['owner'],)).fetchone()
   w.writerow([safe(v) for v in [r['id'],r['kind'],d.get('title'),r['project'],user['name'] if user else '',d.get('date',d.get('due','')),d.get('status'),d.get('score'),d.get('amount'),d.get('note','')]])
  return send(200,('\ufeff'+stream.getvalue()).encode(),'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename=records.csv'})
 if path=='/api/list' and method=='GET':
  kind=query.get('kind',[''])[0]
  if kind not in a.KINDS:raise ValueError('记录类型无效')
  rows=[];status_counts={}
  for r in c.execute('SELECT * FROM records WHERE kind=? AND deleted=0 ORDER BY id DESC',(kind,)):
   if not a.visible(c,u,r):continue
   d=a.serialize(c,u,r)
   if query.get('project',[''])[0] and r['project']!=int(query['project'][0]):continue
   if query.get('owner',[''])[0] and r['owner']!=int(query['owner'][0]):continue
   if query.get('month',[''])[0] and str(d.get('date',d.get('due','')))[:7]!=query['month'][0]:continue
   if query.get('q',[''])[0].lower() not in json.dumps(d,ensure_ascii=False).lower():continue
   if query.get('date',[''])[0] and str(d.get('date',d.get('due','')))[:10]!=query['date'][0]:continue
   status_counts[d.get('status','')]=status_counts.get(d.get('status',''),0)+1
   if query.get('status',[''])[0] and d.get('status')!=query['status'][0]:continue
   rows.append(d)
  if kind=='logs':rows.sort(key=lambda r:(str(r.get('date','')),r['id']),reverse=True)
  size=max(1,min(100,int(query.get('size',[12])[0])));page=max(1,int(query.get('page',[1])[0]));page=min(page,max(1,math.ceil(len(rows)/size)))
  return send(200,{'items':rows[(page-1)*size:page*size],'total':len(rows),'status_counts':status_counts,'page':page,'size':size,'pages':max(1,math.ceil(len(rows)/size))})
 if path=='/api/summary':return send(200,filtered_summary(c,a,u,month_valid(query.get('month',[a.now()[:7]])[0])))
 if path=='/api/settlements':
  if method=='GET':return send(200,[{**dict(r),'data':None} for r in c.execute('SELECT * FROM settlements ORDER BY month DESC')])
  action=body.get('action');month=month_valid(body.get('month',''))
  if not a.has(u,'admin','boss'):return send(403,{'error':'只有老板或管理员可确认与撤销结算'})
  c.execute('BEGIN IMMEDIATE')
  if action=='confirm':
   d=summary(c,a,month)
   if d['locked']:raise ValueError('月份已经锁账')
   if d['pending']:raise ValueError('本月仍有未审核积分，请先处理或作废')
   if not d['rows']:raise ValueError('本月无已审核积分，不能确认空结算')
   c.execute('INSERT INTO settlements(month,data,created,confirmed_by) VALUES(?,?,?,?)',(month,json.dumps(d),a.now(),u['id']))
  elif action=='reopen':
   if not str(body.get('reason','')).strip():raise ValueError('撤销结算必须填写原因')
   r=c.execute('SELECT * FROM settlements WHERE month=?',(month,)).fetchone()
   if not r:raise ValueError('本月尚未结算')
   if r['paid']:raise ValueError('已登记支付的结算不能撤销')
   c.execute('DELETE FROM settlements WHERE month=?',(month,))
  else:raise ValueError('结算操作无效')
  audit(c,a,u,'月度结算 '+action+' '+month+' '+str(body.get('reason','')));return send(200,{'ok':True})
 if path=='/api/settlements/pay':
  if not a.has(u,'admin','finance'):return send(403,{'error':'仅财务可登记月度支付'})
  c.execute('BEGIN IMMEDIATE')
  month=month_valid(body.get('month',''));r=c.execute('SELECT * FROM settlements WHERE month=?',(month,)).fetchone()
  if not r or r['paid']:raise ValueError('请先结算或不要重复登记付款')
  c.execute('UPDATE settlements SET paid=?,paid_by=? WHERE month=?',(a.now(),u['id'],month));audit(c,a,u,'月度奖金登记支付 '+month);return send(200,{'ok':True})
 if path=='/api/approvals':
  rows=[]
  for r in c.execute("SELECT * FROM records WHERE kind IN ('points','expenses','vehicles','bonuses','changes','deliverables') AND deleted=0 ORDER BY id DESC"):
   if a.visible(c,u,r):rows.append(dict(a.serialize(c,u,r),kind=r['kind'],action=pending_action(a,u,r)))
  return send(200,rows)
 if path=='/api/approvals/batch':
  items=body.get('items',[])
  if not isinstance(items,list) or not 1<=len(items)<=50:raise ValueError('每批应选择1至50条记录')
  c.execute('BEGIN IMMEDIATE');seen=set()
  for item in items:
   if item.get('action') in {'pay','confirm_change','accept_delivery'}:raise ValueError('付款、变更及资料验收需逐条核对依据，不支持批量直接确认')
   rid=int(item['id'])
   if rid in seen:raise ValueError('批次中有重复记录')
   seen.add(rid);r=c.execute('SELECT * FROM records WHERE id=? AND deleted=0',(rid,)).fetchone()
   if not r or not a.visible(c,u,r):raise ValueError('记录不存在或无权访问')
   review(c,a,u,r,{'action':item.get('action'),'note':body.get('note','')})
  return send(200,{'ok':True,'count':len(items)})
 if path.startswith('/api/attachments'):
  if method!='GET':c.execute('BEGIN IMMEDIATE')
  parts=path.strip('/').split('/');aid=int(parts[2]) if len(parts)>2 else None
  att=c.execute('SELECT * FROM attachments WHERE id=? AND deleted=0',(aid,)).fetchone() if aid else None
  rid=att['record_id'] if att else int((body.get('record') if method=='POST' else query.get('record',[0])[0]) or 0)
  r=c.execute('SELECT * FROM records WHERE id=? AND deleted=0',(rid,)).fetchone()
  if not r or not a.visible(c,u,r):return send(404,{'error':'附件或所属记录不存在'})
  if method=='GET' and aid:
   if not att:return send(404,{'error':'附件不存在'})
   return send(200,att['content'],'application/octet-stream',{'Content-Disposition':"attachment; filename*=UTF-8''"+quote(att['name'])})
  if method=='GET':return send(200,[dict(x) for x in c.execute('SELECT id,name,mime,length(content) size,owner,created FROM attachments WHERE record_id=? AND deleted=0',(rid,))])
  payment_proof=r['kind'] in {'expenses','vehicles','bonuses'} and pending_action(a,u,r)=='pay'
  if not a.writable(u,r['kind'],r) and not payment_proof:return send(403,{'error':'不能修改此记录附件'})
  d=json.loads(r['data']);ensure_unlocked(c,r['kind'],d)
  if (d.get('status') in {'已审核','待财务审核','待老板审批','已批准','已支付'} and not payment_proof) or (r['kind'] in {'changes','deliverables'} and d.get('status') not in {'已提出','待提交'}):raise ValueError('流程中的附件不可变更，请先退回记录')
  if payment_proof and method=='DELETE':raise ValueError('付款核对阶段只能补充凭证，不能移除已审批附件')
  if method=='DELETE' and att:c.execute('UPDATE attachments SET deleted=1 WHERE id=?',(aid,))
  elif method=='POST':
   name=Path(str(body.get('name',''))).name
   if not name or len(name)>160 or Path(name).suffix.lower() not in {'.png','.jpg','.jpeg','.webp','.pdf','.docx','.xlsx','.txt','.csv','.zip'}:raise ValueError('支持图片、PDF、Word、Excel、ZIP及文本，文件名最长160字')
   raw=base64.b64decode(body.get('content',''),validate=True)
   if not 0<len(raw)<=10*1024*1024:raise ValueError('单个附件应为1字节至10MB')
   if c.execute('SELECT COUNT(*) FROM attachments WHERE record_id=? AND deleted=0',(rid,)).fetchone()[0]>=20:raise ValueError('每条记录最多20个附件')
   aid=c.execute('INSERT INTO attachments(record_id,name,mime,content,owner,created) VALUES(?,?,?,?,?,?)',(rid,name,str(body.get('mime','application/octet-stream')),raw,u['id'],a.now())).lastrowid
  else:raise ValueError('附件操作无效')
  audit(c,a,u,'变更附件 '+str(aid),rid);return send(200,{'id':aid})
 if path=='/api/backups':
  if not a.has(u,'admin'):return send(403,{'error':'仅管理员可管理备份'})
  if method=='POST':
   dest=make_backup(a,'manual');audit(c,a,u,'手动完整备份 '+dest.name);return send(200,{'name':dest.name})
  return send(200,[{'name':p.name,'size':p.stat().st_size,'created':a.datetime.fromtimestamp(p.stat().st_mtime,a.TZ).isoformat()} for p in sorted((a.DB.parent/'backups').glob('*.db'),reverse=True)])
 if path=='/api/backups/download':
  if not a.has(u,'admin'):return send(403,{'error':'权限不足'})
  name=query.get('name',[''])[0]
  if Path(name).name!=name or not re.fullmatch(r'[\w.-]+\.db',name):raise ValueError('备份文件名无效')
  file=a.DB.parent/'backups'/name
  if not file.is_file():return send(404,{'error':'备份不存在'})
  return send(200,file.read_bytes(),'application/octet-stream',{'Content-Disposition':'attachment; filename='+name})
 if path=='/api/project-insights':
  output=[]
  for p in c.execute("SELECT * FROM records WHERE kind='projects' AND deleted=0"):
   if not a.visible(c,u,p):continue
   pd=json.loads(p['data']);logs=[];cost=Decimal(0);bonus=Decimal(0);tasks=[];issues=[]
   for r in c.execute('SELECT * FROM records WHERE project=? AND deleted=0',(p['id'],)):
    d=json.loads(r['data']);k=r['kind']
    if k=='logs' and a.visible(c,u,r):logs.append(d)
    if k=='tasks':tasks.append(d)
    if k=='issues':issues.append(d)
    if a.has(u,'admin','boss','finance') and k in {'expenses','vehicles'} and d.get('status') in {'已批准','已支付','已审核'}:cost+=Decimal(str(d.get('amount',0)))
    if a.has(u,'admin','boss','finance') and k=='bonuses' and d.get('status') in {'已批准','已支付','已确认'}:bonus+=Decimal(str(d.get('amount',0)))
   row={'project':p['id'],'actual_days':sum(float(l.get('work_days',0)) for l in logs),'waiting_days':sum(float(l.get('waiting_days',0)) for l in logs),'standard_days':pd.get('standard_days',0),'tasks':len(tasks),'done_tasks':sum(t.get('status')=='已完成' for t in tasks),'issues':sum(i.get('status')!='已解决' for i in issues),'delay_reason':pd.get('delay_reason','')}
   if a.has(u,'admin','boss','finance'):row.update(budget=pd.get('budget',0),actual_cost=float(cost),confirmed_bonus=float(bonus))
   output.append(row)
  return send(200,output)
 return False
