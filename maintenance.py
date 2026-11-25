"""Offline maintenance. Stop the application before restoring."""
import argparse,sqlite3,json,os
from pathlib import Path
import app,features

def restore(source,destination,allow_legacy=False):
 source=Path(source).resolve();destination=Path(destination).resolve()
 if source==destination:raise ValueError('备份和目标不能相同')
 with sqlite3.connect(f'file:{source.as_posix()}?mode=ro',uri=True,factory=app.ClosingConnection) as src:
  if src.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('备份完整性检查失败')
  tables={r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  required={'users','sessions','records','settings','audit','attachments','settlements'}
  if not required<=tables:raise ValueError('备份缺少业务表：'+','.join(sorted(required-tables))+'；不能作为完整备份恢复')
  columns={'users':['id','name','salt','hash','role','active'],'sessions':['token','user_id','csrf','expires'],'records':['id','kind','owner','project','data','created','updated','deleted'],'settings':['id','data'],'audit':['id','user_id','action','record_id','created'],'attachments':['id','record_id','name','mime','content','owner','created','deleted'],'settlements':['month','data','created','confirmed_by','paid','paid_by']}
  for table,expected in columns.items():
   actual={r[1] for r in src.execute('PRAGMA table_info('+table+')')}
   if not set(expected)<=actual:raise ValueError('备份表字段缺失：'+table)
  counts={t:src.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in required if t!='sessions'}
  manifest=src.execute('SELECT data FROM backup_manifest WHERE id=1').fetchone() if 'backup_manifest' in tables else None
  if manifest:
   meta=json.loads(manifest[0])
   if meta.get('version')!=2 or meta.get('counts')!=counts:raise ValueError('备份版本或业务数量与清单不一致')
  elif not allow_legacy:raise ValueError('旧备份没有版本和数量清单；请人工核对后使用 --allow-legacy-full，缺表备份仍禁止恢复')
  # Validate actual schema/data before touching destination.
  src.execute('SELECT id,name,hash,role FROM users LIMIT 1').fetchone();src.execute('SELECT id,kind,owner,data FROM records LIMIT 1').fetchone()
  if not src.execute("SELECT 1 FROM users WHERE active=1 AND ','||role||',' LIKE '%,admin,%'").fetchone():raise ValueError('备份缺少有效管理员')
  for table in ['records','settings','settlements']:
   for r in src.execute('SELECT data FROM '+table):json.loads(r[0],parse_constant=app.reject_constant)
  for r in src.execute('SELECT record_id FROM attachments'):
   if not src.execute('SELECT 1 FROM records WHERE id=?',(r[0],)).fetchone():raise ValueError('备份存在丢失关联记录的附件')
  destination.parent.mkdir(parents=True,exist_ok=True)
  if destination.exists():
   before=destination.parent/('pre-restore-'+app.datetime.now(app.TZ).strftime('%Y%m%d-%H%M%S-%f')+'.db')
   with sqlite3.connect(destination,factory=app.ClosingConnection) as current,sqlite3.connect(before,factory=app.ClosingConnection) as saved:current.backup(saved)
  with sqlite3.connect(destination,factory=app.ClosingConnection) as dest:
   src.backup(dest);features.initialize(dest);dest.execute('DELETE FROM sessions');dest.commit()
 with sqlite3.connect(destination,factory=app.ClosingConnection) as check:
  if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('恢复后校验失败')
 return destination
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['backup','restore']);p.add_argument('--source');p.add_argument('--stopped',action='store_true');p.add_argument('--allow-legacy-full',action='store_true');args=p.parse_args()
 if args.action=='backup':print(features.make_backup(app,'manual'))
 else:
  if not args.source or not args.stopped:p.error('恢复前先停止服务，再传入 --source 备份路径 --stopped')
  print(restore(args.source,app.DB,args.allow_legacy_full))
