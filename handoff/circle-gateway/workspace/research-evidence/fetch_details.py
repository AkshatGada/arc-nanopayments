import concurrent.futures, json, pathlib, urllib.request, tarfile, io
ROOT = pathlib.Path(__file__).parent
jobs={}
for slug in ['gateway-nanopayments/quickstarts/seller','gateway-nanopayments/howtos/x402-seller-reconciliation',
 'gateway-nanopayments/howtos/x402-seller','gateway-nanopayments/howtos/facilitator-integration',
 'gateway-nanopayments/howtos/eip-3009-signing','gateway-nanopayments/supported-networks',
 'sdks/gateway-nanopayments-sdk','gateway/references/erc-1271','gateway/references/fees']:
 jobs[slug.replace('/','__')+'.md']='https://developers.circle.com/'+slug+'.md'
jobs['nanopayments-openapi.yaml']='https://developers.circle.com/openapi/gateway-nanopayments.yaml'
for repo, nums in [('circlefin/arc-nanopayments',[42,44,47]),('x402-rs/x402-rs',[90,140]),('circlefin/evm-gateway-contracts',[11,14]),('circlefin/skills',[52,55])]:
 for num in nums:
  for kind in ['files','reviews','comments']:
   base='issues' if kind=='comments' else 'pulls'
   jobs[f'{repo.replace("/","__")}__{num}__{kind}.json']=f'https://api.github.com/repos/{repo}/{base}/{num}/{kind}?per_page=100'

def fetch(item):
 name,url=item
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'public-contribution-research'}),timeout=30) as r: body=r.read()
  (ROOT/name).write_bytes(body)
  return name,len(body)
 except Exception as e:return name,str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for r in pool.map(fetch,jobs.items()): print(*r)
n=json.loads((ROOT/'npm-batching.json').read_text());ver=n['dist-tags']['latest'];url=n['versions'][ver]['dist']['tarball']
with urllib.request.urlopen(url,timeout=30) as r: blob=r.read()
(ROOT/f'x402-batching-{ver}.tgz').write_bytes(blob)
out=ROOT/f'x402-batching-{ver}';out.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(blob),mode='r:gz') as t:t.extractall(out,filter='data')
print('PACKAGE EXTRACTED',out)
