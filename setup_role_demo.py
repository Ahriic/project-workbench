"""Create dedicated role demo accounts, without changing existing passwords."""
import app,secrets,sqlite3
from datetime import datetime
app.init()
with app.connection() as c:
 backup=app.DB.parent/('before-roles-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.db')
 with sqlite3.connect(backup) as b:c.backup(b)
 credentials=['角色演示账号（仅供本机试用，勿上传或公开）：']
 for role,name in [('boss','演示老板'),('finance','演示财务'),('manager','演示技术经理'),('employee','演示员工')]:
  exists=c.execute('SELECT id FROM users WHERE name=?',(name,)).fetchone()
  if exists:continue
  p=secrets.token_urlsafe(12);salt=secrets.token_hex(16)
  uid=c.execute('INSERT INTO users(name,salt,hash,role) VALUES(?,?,?,?)',(name,salt,app.password(p,salt),role+',employee' if role!='employee' else role)).lastrowid
  credentials.append(name+' / '+p)
  if role=='employee':
   import json
   rows=c.execute("SELECT * FROM records WHERE kind='projects' AND deleted=0").fetchall()
   for r in rows:
    d=json.loads(r['data'])
    if d.get('demo'):
     d['members']=list(set(d.get('members',[])+[uid]));c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(d),r['id']))
 if len(credentials)>1:(app.DB.parent/'角色演示账号.txt').write_text('\n'.join(credentials),encoding='utf8')
print('角色演示账号已就绪；密码保存在 data/角色演示账号.txt，已有账号不重置。')
