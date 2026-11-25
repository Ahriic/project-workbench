import os, json, sqlite3, secrets, hashlib, hmac, csv, io, sys, math
import features,project_workflows
from pathlib import Path
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs

ROOT=Path(__file__).parent
DB=Path(os.environ.get('APP_DB',str(ROOT/'data'/'system.db')))
TZ=timezone(timedelta(hours=8))
def now(): return datetime.now(TZ).isoformat(timespec='seconds')
class ClosingConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()
def connection():
    c=sqlite3.connect(DB,factory=ClosingConnection); c.row_factory=sqlite3.Row; return c
def password(p,s): return hashlib.pbkdf2_hmac('sha256',p.encode(),s.encode(),200000).hex()
def money(v): return float(Decimal(str(v)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
def finite_number(value,label,maximum=1000000000):
    if isinstance(value,bool):raise ValueError(label+' 必须为数字')
    try:value=float(value)
    except (ValueError,TypeError):raise ValueError(label+' 必须为数字')
    if not math.isfinite(value) or not 0<=value<=maximum:raise ValueError(label+' 必须为0至'+str(maximum)+'之间的有限数字')
    return value
def reject_constant(value):raise ValueError('JSON不允许非有限数值：'+value)
DEFAULT={'point_rate':50,'pool':2000,'daily':200,'provided':120,'car_rate':1,'car_base':.3,'grades':{'A':1,'B':2,'C':3,'D':5},'roles':{'负责人':1,'主力协作':.75,'一般辅助':.5},'quality':{'优良':1.1,'合格':1,'需改进':.8,'不计分':0}}
KINDS={'projects','tasks','milestones','issues','logs','points','expenses','vehicles','bonuses','changes','deliverables'}
ROLES={'admin':'管理员','boss':'老板','finance':'财务 / 商务','manager':'技术经理','employee':'员工'}
def roles(u):return set(u['role'].split(','))
def has(u,*allowed):return bool(roles(u)&set(allowed))
def public_user(u):return dict(u,roles=sorted(roles(u)),role_names=[ROLES[r] for r in sorted(roles(u))])
def serialize(c,u,r):
    d=json.loads(r['data'])
    if r['kind']=='projects' and not has(u,'admin','boss','finance'):d.pop('budget',None)
    return dict(d,id=r['id'],owner=r['owner'],project=r['project'])
def writable(u,kind,old=None):
    if has(u,'admin'):return True
    if kind in {'projects','bonuses'}:return has(u,'manager')
    if kind in {'tasks','milestones','issues','changes','deliverables'} and has(u,'manager'):return True
    return not old or old['owner']==u['id']
def init():
    DB.parent.mkdir(parents=True,exist_ok=True)
    with connection() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT,hash TEXT,role TEXT,active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,csrf TEXT,expires TEXT);
        CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,kind TEXT,owner INTEGER,project INTEGER,data TEXT,created TEXT,updated TEXT,deleted INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,data TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,record_id INTEGER,created TEXT);''')
        features.initialize(c)
        if not c.execute('SELECT 1 FROM users').fetchone():
            p=os.environ.get('ADMIN_PASSWORD') or secrets.token_urlsafe(14); s=secrets.token_hex(16)
            c.execute('INSERT INTO users(name,salt,hash,role) VALUES(?,?,?,?)',('admin',s,password(p,s),'admin'))
            (DB.parent/'首次登录.txt').write_text('账号：admin\n密码：'+p+'\n登录后请在人员管理中修改密码。',encoding='utf-8')
            print('首次登录凭据已保存：'+str(DB.parent/'首次登录.txt'),flush=True)
        c.execute('INSERT OR IGNORE INTO settings VALUES(1,?)',(json.dumps(DEFAULT),))
def settings(c): return json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
def visible(c,u,r):
    if has(u,'admin','boss'): return True
    if has(u,'manager') and r['kind'] in {'projects','tasks','milestones','issues','logs','points','bonuses','changes','deliverables'}:return True
    if has(u,'finance') and r['kind'] in {'projects','expenses','vehicles','bonuses','points'}:return True
    if r['kind']=='milestones' and not has(u,'finance'):return r['owner']==u['id']
    if r['kind']=='projects': return u['id'] in json.loads(r['data']).get('members',[])
    return r['owner']==u['id'] or (r['kind'] in {'tasks','milestones','issues'} and project_access(c,u,r['project']))
def project_access(c,u,p):
    if not p:return False
    r=c.execute("SELECT * FROM records WHERE id=? AND kind='projects' AND deleted=0",(p,)).fetchone()
    return bool(r and visible(c,u,r))
def validated(kind,d,s):
    if not str(d.get('title','')).strip(): raise ValueError('请填写名称或工作内容')
    project_workflows.validate(kind,d,sys.modules[__name__])
    enums={'projects':('status',['准备中','进行中','待验收','已完成','已归档']), 'tasks':('status',['待开始','进行中','已完成']), 'issues':('status',['待处理','处理中','已解决']), 'milestones':('status',['未达成','已达成'])}
    if kind in enums:
        field,values=enums[kind];d.setdefault(field,values[0])
        if d[field] not in values:raise ValueError('业务状态无效')
    if kind in {'logs','points','expenses','vehicles','bonuses'}:d.setdefault('date',now()[:10])
    for key in ['date','start','due']:
        if key in d and d[key]:
            try:
                if not isinstance(d[key],str) or len(d[key])!=10:raise ValueError()
                datetime.strptime(d[key],'%Y-%m-%d')
            except (ValueError,TypeError):raise ValueError(key+' 必须为真实日期 YYYY-MM-DD')
        elif key=='date' and kind in {'logs','points','expenses','vehicles','bonuses'}:raise ValueError('请填写业务日期')
    if d.get('start') and d.get('due') and d['start']>d['due']:raise ValueError('计划完成不能早于计划开始')
    if kind in {'points','expenses','vehicles','bonuses'}:d.setdefault('status','待审核')
    if kind in {'points','expenses','vehicles','bonuses'} and d['status'] not in {'待审核','已退回','已审核','待财务审核','待老板审批','已批准','已支付','已确认'}:raise ValueError('审批状态无效')
    for k in ['amount','days','fuel','toll','parking','rent','lodging','transport','km','rate','budget','standard_days','work_days','waiting_days']:
        if k in d:
            if isinstance(d[k],bool) or not isinstance(d[k],(int,float)):raise ValueError(k+' 必须是非负有限数字')
            d[k]=finite_number(d[k],k)
    if kind=='tasks' and 'task_weight' in d:
        d['task_weight']=finite_number(d['task_weight'],'进度权重')
    if 'progress' in d and not 0<=float(d['progress'])<=100:raise ValueError('进度必须在0到100之间')
    if kind=='points':
        try:d['score']=money(s['grades'][d['grade']]*s['roles'][d['role']]*s['quality'][d['quality']])
        except KeyError:raise ValueError('积分等级、角色或评价无效')
        d['amount']=money(d['score']*s['point_rate']);d['parameter_snapshot']=s
    if kind=='expenses':
        d.setdefault('stay','自行包干')
        if d['stay'] not in {'自行包干','客户或公司提供','凭票报销'}:raise ValueError('住宿方式无效')
        if d.get('stay')=='自行包干' and d.get('lodging',0):raise ValueError('住宿包干不能同时报销住宿费')
        rate=s['daily'] if d.get('stay')=='自行包干' else s['provided']
        d['subsidy']=money(d.get('days',0)*rate)
        d['amount']=money(d['subsidy']+d.get('lodging',0)+d.get('transport',0));d['parameter_snapshot']=s
    if kind=='vehicles':
        d.setdefault('mode','综合包干')
        if d['mode'] not in {'综合包干','分项报销','租车','公司车辆'}:raise ValueError('车辆计费方式无效')
        if d.get('mode')=='综合包干' and d.get('fuel',0):raise ValueError('综合包干已含燃油，不得重复报销')
        rate=s['car_rate'] if d.get('mode')=='综合包干' else s['car_base'] if d.get('mode')=='分项报销' else 0
        d['amount']=money(d.get('km',0)*rate+sum(d.get(k,0) for k in ['fuel','toll','parking','rent']));d['parameter_snapshot']=s
    return d
class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup();self.connection.settimeout(20)
    def log_message(self,*a):pass
    def send(self,status,data,ctype='application/json; charset=utf-8',extra=None):
        raw=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','no-store')
        for k,v in (extra or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):self.handle_request()
    def do_POST(self):self.handle_request()
    def do_PUT(self):self.handle_request()
    def do_DELETE(self):self.handle_request()
    def handle_request(self):
        try:
            with connection() as c:self.route(c)
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:self.send(400,{'error':str(e)})
        except sqlite3.IntegrityError:self.send(409,{'error':'名称已存在或数据冲突'})
        except Exception as e:
            print(type(e).__name__,str(e),flush=True);self.send(500,{'error':'服务处理失败，请检查服务器日志'})
    def route(self,c):
        path=urlparse(self.path).path; method=self.command
        if path=='/health':return self.send(200,{'status':'ok'})
        vendor={'/vendor/flatpickr/'+name for name in ['flatpickr.min.js','flatpickr.min.css','l10n/zh.js','plugins/monthSelect/index.js','plugins/monthSelect/style.css']}
        if path in vendor or path in {'/date-widgets.js','/date-widgets.css','/workflows.js'}:
            f=ROOT/'static'/path[1:];return self.send(200,f.read_bytes(),'text/css; charset=utf-8' if f.suffix=='.css' else 'text/javascript; charset=utf-8')
        if path=='/clarity.css':return self.send(200,(ROOT/'static'/'clarity.css').read_bytes(),'text/css; charset=utf-8')
        if path=='/semantic.css':return self.send(200,(ROOT/'static'/'semantic.css').read_bytes(),'text/css; charset=utf-8')
        if path in {'/operations.js','/operations.css'}:
            f=ROOT/'static'/path[1:];return self.send(200,f.read_bytes(),'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8')
        if not path.startswith('/api/'):
            files={'/':'index.html','/app.js':'app.js','/roles.js':'roles.js','/style.css':'style.css','/experience.js':'experience.js','/experience.css':'experience.css','/legibility.css':'legibility.css','/mist-blue.css':'mist-blue.css'}
            if path not in files:return self.send(404,{'error':'页面不存在'})
            f=ROOT/'static'/files[path];return self.send(200,f.read_bytes(),{'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[f.suffix[1:]])
        body={}
        if method in {'POST','PUT'}:
            n=int(self.headers.get('Content-Length',0))
            if n>15000000:return self.send(413,{'error':'请求过大，单个附件限10MB'})
            if n<0:raise ValueError('请求长度无效')
            body=json.loads(self.rfile.read(n) or '{}',parse_constant=reject_constant)
            if not isinstance(body,dict):raise ValueError('请求必须为JSON对象')
        if path=='/api/login' and method=='POST':
            ip=self.client_address[0];name=body.get('name','');cutoff=(datetime.now(TZ)-timedelta(minutes=15)).isoformat()
            if not isinstance(name,str) or not isinstance(body.get('password',''),str):raise ValueError('账号和密码必须为文本')
            key=hashlib.sha256(name.encode()).hexdigest()
            c.execute('DELETE FROM login_attempts WHERE created<?',(cutoff,))
            failures=c.execute('SELECT COUNT(*) FROM login_attempts WHERE account=?',(key,)).fetchone()[0]
            ip_failures=c.execute('SELECT COUNT(*) FROM login_attempts WHERE ip=?',(ip,)).fetchone()[0]
            if failures>=8 or ip_failures>=40:return self.send(429,{'error':'登录失败次数过多，请15分钟后重试'},extra={'Retry-After':'900'})
            u=c.execute('SELECT * FROM users WHERE name=? AND active=1',(body.get('name'),)).fetchone()
            if not u or not hmac.compare_digest(u['hash'],password(body.get('password',''),u['salt'])):
                c.execute('INSERT INTO login_attempts(account,ip,created) VALUES(?,?,?)',(key,ip,now()))
                features.audit(c,sys.modules[__name__],{'id':None},'登录失败',details={'account_hash':key,'ip':ip})
                return self.send(401,{'error':'账号或密码错误'})
            c.execute('DELETE FROM login_attempts WHERE account=?',(key,))
            t=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24)
            c.execute('INSERT INTO sessions VALUES(?,?,?,?)',(t,u['id'],csrf,(datetime.now(TZ)+timedelta(hours=12)).isoformat()))
            secure='; Secure' if os.environ.get('COOKIE_SECURE')=='1' else ''
            return self.send(200,{'csrf':csrf},extra={'Set-Cookie':f'session={t}; HttpOnly; SameSite=Strict; Path=/{secure}'})
        cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''));token=cookie.get('session');token=token.value if token else ''
        session=c.execute('SELECT * FROM sessions WHERE token=? AND expires>?',(token,now())).fetchone()
        u=c.execute('SELECT id,name,role FROM users WHERE id=? AND active=1',(session['user_id'],)).fetchone() if session else None
        if not u:return self.send(401,{'error':'请先登录'})
        u=dict(u)
        if method!='GET' and self.headers.get('X-CSRF-Token')!=session['csrf']:return self.send(403,{'error':'请求校验失败，请刷新页面'})
        if project_workflows.route(self,c,u,path,method,body,sys.modules[__name__]):return
        if features.route(self,c,u,path,method,body,sys.modules[__name__]):return
        if path=='/api/me':return self.send(200,dict(public_user(u),csrf=session['csrf']))
        if path=='/api/logout':
            c.execute('DELETE FROM sessions WHERE token=?',(token,));return self.send(200,{'ok':True},extra={'Set-Cookie':'session=; Max-Age=0; Path=/'})
        if path=='/api/settings':
            if method=='GET':return self.send(200,settings(c))
            if not has(u,'admin','boss'):return self.send(403,{'error':'仅管理员或老板可修改参数'})
            s=settings(c);before=json.loads(json.dumps(s))
            for k in ['point_rate','pool','daily','provided','car_rate','car_base']:
                if k in body:
                    s[k]=money(finite_number(body[k],k))
            c.execute('UPDATE settings SET data=? WHERE id=1',(json.dumps(s,allow_nan=False),));features.audit(c,sys.modules[__name__],u,'修改参数',details={'before':before,'after':s});return self.send(200,s)
        if path=='/api/users':
            if method=='GET':return self.send(200,[public_user(dict(r)) for r in c.execute('SELECT id,name,role,active FROM users')])
            if not has(u,'admin'):return self.send(403,{'error':'仅管理员可管理人员'})
            assigned=body.get('roles') or [body.get('role','employee')]
            if not isinstance(assigned,list) or not assigned or any(r not in ROLES for r in assigned):raise ValueError('角色无效')
            assigned=','.join(sorted(set(assigned)))
            if not body.get('id') or body.get('password'):
                if len(body.get('password',''))<10:raise ValueError('密码至少10位')
            salt=secrets.token_hex(16)
            if body.get('id'):
                target=c.execute('SELECT * FROM users WHERE id=?',(int(body['id']),)).fetchone()
                if not target:raise ValueError('账号不存在')
                if 'admin' in roles(target) and 'admin' not in assigned.split(',') and c.execute("SELECT COUNT(*) FROM users WHERE ','||role||',' LIKE '%,admin,%' AND active=1").fetchone()[0]<=1:raise ValueError('必须保留至少一个管理员')
                name=str(body.get('name',target['name'])).strip()
                if not name or len(name)>80:raise ValueError('姓名 / 登录账号须为1至80个字符')
                if c.execute('SELECT 1 FROM users WHERE name=? AND id<>?',(name,target['id'])).fetchone():raise ValueError('该名称已被其他账号使用')
                c.execute('UPDATE users SET role=?,name=? WHERE id=?',(assigned,name,target['id']))
                if body.get('password'):c.execute('UPDATE users SET salt=?,hash=? WHERE id=?',(salt,password(body['password'],salt),target['id']))
                c.execute('DELETE FROM sessions WHERE user_id=?',(target['id'],))
            else:c.execute('INSERT INTO users(name,salt,hash,role) VALUES(?,?,?,?)',(body['name'],salt,password(body['password'],salt),assigned))
            features.audit(c,sys.modules[__name__],u,'调整账号 / 角色',details={'before':{'id':target['id'],'name':target['name'],'role':target['role']} if body.get('id') else None,'after':{'name':body.get('name'),'role':assigned},'password_changed':bool(body.get('password'))})
            return self.send(200,{'ok':True})
        if path=='/api/audit':
            if not has(u,'admin','boss'):return self.send(403,{'error':'权限不足'})
            return self.send(200,[dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 300')])
        if path=='/api/backup':
            if not has(u,'admin'):return self.send(403,{'error':'权限不足'})
            backup=features.make_backup(sys.modules[__name__],'download')
            return self.send(200,backup.read_bytes(),'application/octet-stream',{'Content-Disposition':'attachment; filename=project-backup.db'})
        if path=='/api/export':
            rows=[r for r in c.execute('SELECT * FROM records WHERE deleted=0') if visible(c,u,r)]
            out=io.StringIO();writer=csv.writer(out);writer.writerow(['编号','类型','所属人员','项目编号','内容','创建时间'])
            for r in rows:writer.writerow([r['id'],r['kind'],r['owner'],r['project'],json.dumps(serialize(c,u,r),ensure_ascii=False),r['created']])
            return self.send(200,('\ufeff'+out.getvalue()).encode(),'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename=records.csv'})
        if path=='/api/summary':
            month=parse_qs(urlparse(self.path).query).get('month',[now()[:7]])[0]
            totals={}
            for r in c.execute("SELECT * FROM records WHERE kind='points' AND deleted=0"):
                d=json.loads(r['data'])
                if d.get('date','')[:7]!=month or d.get('status')!='已审核':continue
                totals[r['owner']]=totals.get(r['owner'],Decimal(0))+Decimal(str(d.get('score',0)))
            s=settings(c);total=sum(totals.values());pool=Decimal(str(s['pool']));rate=Decimal(str(s['point_rate']));raw={i:v*rate for i,v in totals.items()}
            capped=total*rate>pool;result=[];allocated=Decimal(0)
            ordered=sorted(totals)
            for idx,i in enumerate(ordered):
                value=pool*totals[i]/total if capped else raw[i]
                amount=pool-allocated if capped and idx==len(ordered)-1 else value.quantize(Decimal('.01'),rounding=ROUND_HALF_UP);allocated+=amount
                if has(u,'admin','boss','finance','manager') or i==u['id']:result.append({'user':i,'score':float(totals[i]),'raw':money(raw[i]),'amount':money(amount)})
            return self.send(200,{'month':month,'rows':result,'capped':capped,'pool':s['pool']})
        parts=path.strip('/').split('/')
        if len(parts)<2 or parts[1] not in KINDS:return self.send(404,{'error':'接口不存在'})
        kind=parts[1];rid=int(parts[2]) if len(parts)>2 else None
        if len(parts)==4 and parts[3]=='review' and method=='POST':
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT * FROM records WHERE id=? AND kind=? AND deleted=0',(rid,kind)).fetchone()
            if not r or not visible(c,u,r):return self.send(404,{'error':'记录不存在'})
            permitted={'technical':('admin','manager'),'financial':('admin','finance'),'approve':('admin','boss'),'pay':('admin','finance'),'reject':('admin','boss','finance','manager'),'confirm_change':('admin','boss'),'accept_delivery':('admin','manager')}
            if body.get('action') not in permitted or not has(u,*permitted[body['action']]):return self.send(403,{'error':'无此审核权限'})
            features.review(c,sys.modules[__name__],u,r,body)
            return self.send(200,{'ok':True})
        if method=='GET':
            return self.send(200,[serialize(c,u,r) for r in c.execute('SELECT * FROM records WHERE kind=? AND deleted=0 ORDER BY id DESC',(kind,)) if visible(c,u,r)])
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT * FROM records WHERE id=? AND kind=? AND deleted=0',(rid,kind)).fetchone() if rid else None
        if rid and (not old or not visible(c,u,old)):return self.send(404,{'error':'记录不存在'})
        if not writable(u,kind,old):return self.send(403,{'error':'权限不足'})
        if old:features.ensure_unlocked(c,kind,json.loads(old['data']))
        if old and (json.loads(old['data']).get('status') in {'已审核','已支付','已批准','待财务审核','待老板审批'} or (kind in {'changes','deliverables'} and json.loads(old['data']).get('status') not in {'已提出','待提交'})):return self.send(403,{'error':'流程中的记录已锁定，请使用对应流程操作'})
        if method=='DELETE':c.execute('UPDATE records SET deleted=1 WHERE id=?',(rid,))
        else:
            for key in ['id','parameter_snapshot','score','subsidy','technical_review','financial_review','boss_review','payment','review_history','applied_template','template_source','workflow_history']:body.pop(key,None)
            requested_owner=body.pop('owner',u['id']);owner=int(requested_owner) if has(u,'admin','manager') else u['id'];project=int(body.pop('project',0) or 0)
            if not c.execute('SELECT 1 FROM users WHERE id=? AND active=1',(owner,)).fetchone():raise ValueError('人员不存在')
            if project and not project_access(c,u,project):return self.send(403,{'error':'未参与此项目'})
            if body.get('status') in {'已审核','已支付','已批准','待财务审核','待老板审批','已确认'}:return self.send(403,{'error':'请通过审核操作更新审批状态'})
            if kind in {'changes','deliverables'} and body.get('status',{'changes':'已提出','deliverables':'待提交'}[kind])!={'changes':'已提出','deliverables':'待提交'}[kind]:raise ValueError('请使用流程按钮提交或确认')
            project_workflows.validate_links(c,sys.modules[__name__],u,kind,body,project)
            if old and project!=old['project'] and kind in {'issues','milestones'}:
                child,link=('logs','issue') if kind=='issues' else ('deliverables','milestone')
                if any(str(json.loads(x['data']).get(link,''))==str(rid) for x in c.execute('SELECT data FROM records WHERE kind=? AND deleted=0',(child,))):raise ValueError('已有日报或资料关联，请先解除关联再更换项目')
            d=validated(kind,body,settings(c))
            if kind=='milestones' and rid and d.get('status')=='已达成':
                linked=[json.loads(x['data']) for x in c.execute("SELECT data FROM records WHERE kind='deliverables' AND project=? AND deleted=0",(project,))]
                if any(str(x.get('milestone'))==str(rid) and x.get('status')!='已验收' for x in linked):raise ValueError('该节点关联资料尚未全部验收')
            features.ensure_unlocked(c,kind,d)
            if old:
                old_data=json.loads(old['data'])
                if old_data.get('review_history'):d['review_history']=old_data['review_history']
                if kind=='projects' and not has(u,'admin','boss','finance'):d['budget']=old_data.get('budget',0)
                for key in ['applied_template','template_source','workflow_history']:
                    if key in old_data:d[key]=old_data[key]
            if kind=='projects':d['members']=[int(x) for x in d.get('members',[])]
            if rid:c.execute('UPDATE records SET owner=?,project=?,data=?,updated=? WHERE id=?',(owner,project,json.dumps(d),now(),rid))
            else:rid=c.execute('INSERT INTO records(kind,owner,project,data,created,updated) VALUES(?,?,?,?,?,?)',(kind,owner,project,json.dumps(d),now(),now())).lastrowid
        if method=='POST' and kind=='projects' and body.get('template'):project_workflows.apply_template(c,sys.modules[__name__],u,rid,body['template'])
        features.audit(c,sys.modules[__name__],u,method+' '+kind,rid,details={'before':dict(json.loads(old['data']),owner=old['owner'],project=old['project']) if old else None,'after':None if method=='DELETE' else dict(d,owner=owner,project=project)})
        return self.send(200,{'id':rid})
if __name__=='__main__':
    init()
    if os.environ.get('APP_CONTAINER')!='1':(ROOT/'server.pid').write_text(str(os.getpid()),encoding='ascii')
    print('项目工作台：http://127.0.0.1:'+os.environ.get('PORT','8765'),flush=True)
    features.backup_worker(sys.modules[__name__])
    ThreadingHTTPServer((os.environ.get('HOST','127.0.0.1'),int(os.environ.get('PORT','8765'))),Handler).serve_forever()
