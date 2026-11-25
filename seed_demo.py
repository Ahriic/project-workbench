"""Add clearly marked demo data without replacing existing records. Safe to rerun."""
import json,secrets,sqlite3
from datetime import timedelta,datetime
import app

def seed():
 app.init()
 with app.connection() as c:
  backup=app.DB.parent/('before-demo-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.db')
  with sqlite3.connect(backup) as dest:c.backup(dest)
  staff=[]
  for name in ['演示·张工','演示·李工','演示·王工','演示·赵工']:
   row=c.execute('SELECT id FROM users WHERE name=?',(name,)).fetchone()
   if not row:
    salt=secrets.token_hex(16);uid=c.execute('INSERT INTO users(name,salt,hash,role) VALUES(?,?,?,?)',(name,salt,app.password(secrets.token_urlsafe(24),salt),'employee')).lastrowid
   else:uid=row['id']
   staff.append(uid)
  today=datetime.now(app.TZ).date()
  def day(n=0):return (today+timedelta(days=n)).isoformat()
  def add(kind,key,owner,project=0,**data):
   found=c.execute('SELECT id,data FROM records WHERE kind=? AND deleted=0',(kind,)).fetchall()
   for r in found:
    if json.loads(r['data']).get('demo_key')==key:return r['id']
   data.update(demo_key=key,demo=True)
   data=app.validated(kind,data,app.settings(c))
   return c.execute('INSERT INTO records(kind,owner,project,data,created,updated) VALUES(?,?,?,?,?,?)',(kind,owner,project,json.dumps(data,ensure_ascii=False),app.now(),app.now())).lastrowid
  specs=[('包装线控制改造','DEMO-001','演示甲客户 / 苏州',68,'进行中',8,12,18000),('污水站PLC升级','DEMO-002','演示乙客户 / 合肥',35,'进行中',15,18,24000),('产线通讯故障排查','DEMO-003','演示丙客户 / 本市',100,'已完成',-2,2,2500),('设备搬迁复产','DEMO-004','演示丁客户 / 青岛',12,'准备中',25,22,32000)]
  ps=[]
  for i,(title,code,client,progress,status,due,days,budget) in enumerate(specs):
   ps.append(add('projects',code,staff[i],title='[演示] '+title,code=code,client=client,progress=progress,status=status,start=day(-days),due=day(due),budget=budget,members=staff if i<2 else [staff[i]],scope='演示资料：现场调试、程序备份、图纸更新及客户交付确认。'))
  for i,(title,status,due) in enumerate([('完成I/O点位核对','已完成',-3),('变频器联动测试','进行中',2),('整理电气图纸和程序备份','待开始',5),('确认客户停机窗口','进行中',-1),('现场网络连续运行测试','已完成',-2),('设备搬迁前检查','待开始',10)]):
   add('tasks','task-'+str(i),staff[i%4],ps[i%4],title='[演示] '+title,status=status,due=day(due),note='可编辑试用；此记录为虚构演示。')
  for i in range(4):
   for j,(title,offset) in enumerate([('调试完成',4),('稳定运行确认',15),('客户交付验收',25)]):
    add('milestones',f'm-{i}-{j}',staff[i],ps[i],title='[演示] '+title,due=day(offset+i),status='未达成',note='按任务书约定条件确认，保留交付资料。')
  for i,(title,status) in enumerate([('客户停机窗口尚未确认','待处理'),('两台仪表通讯间歇掉线','处理中'),('变频器参数与设计不一致','已解决')]):
   add('issues','issue-'+str(i),staff[i],ps[i],title='[演示] '+title,status=status,note='演示问题：记录影响、反馈对象和解决措施，不能直接归责员工。')
  for i in range(8):
   add('logs','log-'+str(i),staff[i%4],ps[i%4],title='[演示] '+['现场点检及联调','离线程序检查','通讯恢复及测试','设备资料整理'][i%4],date=day(-i%4-3),progress=[68,35,100,12][i%4],waiting='客户停机窗口' if i%4==1 else '',result='完成点位核对和程序备份，异常已反馈。',feedback='15:30 已反馈项目负责人',next='完成剩余测试并整理交付资料')
  for i in range(8):
   add('points','point-'+str(i),staff[i%4],ps[i%4],title='[演示] '+['参数调整','现场检查','通讯排查','紧急故障恢复'][i%4],date=day(-i%5),grade=['A','B','C','D'][i%4],role=['负责人','主力协作','一般辅助','负责人'][i%4],quality='优良' if i%2 else '合格',status='待审核' if i==7 else '已审核',note='虚构演示评分，可修改后观察汇总。')
  for i,(stay,days,lodging,transport) in enumerate([('自行包干',1,0,80),('客户或公司提供',2,0,180),('凭票报销',3,720,430),('客户或公司提供',.5,0,36)]):
   add('expenses','expense-'+str(i),staff[i],ps[i],title='[演示] 现场服务出差',date=day(-i),stay=stay,days=days,lodging=lodging,transport=transport,status='待审核' if i%2 else '已审核',note='所有金额为演示。半天补贴口径请按正式制度确认。')
  for i,(mode,km,fuel,toll,parking,rent) in enumerate([('综合包干',86,0,35,10,0),('分项报销',120,90,45,15,0),('租车',0,120,25,15,360),('公司车辆',0,260,80,20,0)]):
   add('vehicles','vehicle-'+str(i),staff[i],ps[i],title='[演示] 公司至客户现场',date=day(-i),mode=mode,km=km,fuel=fuel,toll=toll,parking=parking,rent=rent,status='待审核',note='虚构演示行程，不代表正式补贴标准。')
  admin=c.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()[0]
  for i,(stage,amount,status) in enumerate([('调试完成',3000,'已支付'),('稳定运行',1800,'已确认'),('回款或年度结算',1200,'已确认')]):
   add('bonuses','bonus-'+str(i),staff[0],ps[0],title='[演示] 包装线项目阶段奖金',date=day(-i),stage=stage,amount=amount,status=status,note='虚构金额，用于体验确认和支付分别记录。')
  c.execute('INSERT INTO audit(user_id,action,created) VALUES(?,?,?)',(admin,'添加可识别演示数据（已有记录不覆盖）',app.now()))
  print(json.dumps({'backup':str(backup),'counts':{k:c.execute('SELECT COUNT(*) FROM records WHERE kind=? AND deleted=0',(k,)).fetchone()[0] for k in sorted(app.KINDS)}},ensure_ascii=True))
if __name__=='__main__':seed()
