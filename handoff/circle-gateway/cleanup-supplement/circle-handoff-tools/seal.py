from pathlib import Path
import hashlib,json,re
root=Path('/Users/akshat/circle');out=root/'circle-gateway-handoff/handoff/circle-gateway'
# Read private values only in memory and report paths/counts, never their contents.
wallets=json.loads((root/'gateway-testnet-runner/.secrets/wallets.json').read_text())
private=[v for v in wallets.values() if isinstance(v,str)]
def signatures(obj):
 if isinstance(obj,dict):
  for k,v in obj.items():
   if k.lower() in ('signature','privatekey') and isinstance(v,str):private.append(v)
   else:signatures(v)
 elif isinstance(obj,list):
  for v in obj:signatures(v)
for p in (root/'gateway-testnet-runner/.secrets').glob('*.json'):signatures(json.loads(p.read_text()))
needles={v.encode() for v in private if len(v)>=64}|{v[2:].encode() for v in private if v.startswith('0x') and len(v)>=64}
files=[p for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ('HANDOFF_MANIFEST.json','SHA256SUMS')]
for p in files:
 assert '.secrets' not in p.relative_to(out).parts,p
 data=p.read_bytes()
 assert not any(n in data for n in needles),'Private value found: '+str(p)
 if p.suffix in ('.json','.log','.txt','.md','.mjs','.py'):
  # Real signed payload fields must be absent. Synthetic fixture signatures are allowed.
  for value in re.findall(rb'"signature"\s*:\s*"(0x[0-9a-fA-F]+)"',data):
   assert len(value)<130 or len(set(value[2:]))<=2,'Review nontrivial signature: '+str(p)
print('PASS secret scan:',len(files),'files;',len(private),'private key/signature values checked; no private values displayed')
manifest={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(out/'HANDOFF_MANIFEST.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
(out/'SHA256SUMS').write_text(hashlib.sha256((out/'HANDOFF_MANIFEST.json').read_bytes()).hexdigest()+'  handoff/circle-gateway/HANDOFF_MANIFEST.json\n')
print('HANDOFF FILES',len(files)+2)
