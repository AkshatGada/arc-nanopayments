from pathlib import Path
import os,shutil,subprocess,json,hashlib,tarfile,datetime
root=Path('/Users/akshat/circle');out=root/'circle-gateway-handoff/handoff/circle-gateway';ws=out/'workspace';ws.mkdir(exist_ok=True)
excluded={'gateway-axum-seller/target','gateway-axum-seller/scripts/__pycache__','gateway-testnet-runner/node_modules','gateway-testnet-runner/.secrets','research-evidence/rust-probe/target'}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
manifest={};repos=[]
for name in ['RESEARCH_REPORT.txt','gateway-axum-seller','gateway-axum-seller-audit','gateway-testnet-runner','research-evidence']:
 src=root/name
 files=[src] if src.is_file() else sorted(src.rglob('*'))
 for p in files:
  rel=p.relative_to(root).as_posix()
  if any(rel==e or rel.startswith(e+'/') for e in excluded):continue
  if p.is_dir():continue
  assert not p.is_symlink(),rel
  dest=ws/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
  manifest[rel]={'sha256':digest(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&0o777}
snap=out/'repository-snapshots';snap.mkdir(exist_ok=True)
for p in sorted(root.glob('research-*')):
 if not (p/'.git').is_dir():continue
 def git(*args):return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
 assert git('status','--porcelain')=='',p
 assert git('stash','list')=='',p
 assert git('status','--porcelain','--ignored')=='', 'Uninventoried ignored files in '+str(p)
 archive=snap/(p.name+'.git.tar.gz')
 with tarfile.open(archive,'w:gz') as t:t.add(p/'.git',arcname='.git')
 paths=subprocess.check_output(['git','-C',str(p),'ls-files','-z']).decode().split('\0')
 gitlinks={line.split('\t',1)[1] for line in subprocess.check_output(['git','-C',str(p),'ls-files','--stage'],text=True).splitlines() if line.startswith('160000 ')}
 for item in filter(None,paths):
  if item in gitlinks:
   assert not any((p/item).iterdir()) if (p/item).is_dir() else not (p/item).exists()
   continue
  f=p/item;rel=f.relative_to(root).as_posix()
  assert f.is_file() and not f.is_symlink(),rel
  manifest[rel]={'sha256':digest(f),'bytes':f.stat().st_size,'mode':f.stat().st_mode&0o777}
 repos.append({'directory':p.name,'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'origin':git('remote','get-url','origin'),'shallow':git('rev-parse','--is-shallow-repository')=='true','archive':archive.relative_to(out).as_posix(),'archive_sha256':digest(archive),'status':'clean; no stashes or ignored files'})
(out/'WORKSPACE_MANIFEST.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
(out/'REPOSITORIES.json').write_text(json.dumps(repos,indent=2)+'\n')
(out/'INVENTORY.txt').write_text('Captured '+datetime.datetime.now(datetime.timezone.utc).isoformat()+'\nOriginal workspace: /Users/akshat/circle\nPreserved '+str(len(manifest))+' source/evidence/research files plus Git metadata for '+str(len(repos))+' research clones.\nExcluded only: '+', '.join(sorted(excluded))+'\nThe vendor source directory research-solana-gateway/vendor/cc/src/target is retained.\nResearch repositories were clean with no stashes/ignored files; their complete shallow Git metadata is archived, permitting offline checkout without upstream access.\nWallet keys and real signed payloads remain on the original Mac and are not part of this public handoff.\nGlobal tools, Cargo/npm caches and Codex conversation history are not uploaded. The next-agent document preserves the working context.\n')
print(json.dumps({'files':len(manifest),'repos':len(repos),'snapshot_bytes':sum(p.stat().st_size for p in snap.iterdir()),'workspace_bytes':sum(p.stat().st_size for p in ws.rglob('*') if p.is_file())}))
