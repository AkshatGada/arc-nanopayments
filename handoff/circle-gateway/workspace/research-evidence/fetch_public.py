"""Read public repository/package metadata only; no credentials or mutations."""
import concurrent.futures, json, pathlib, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).parent
repos = ['circlefin/skills', 'circlefin/arc-nanopayments', 'circlefin/evm-gateway-contracts',
         'circlefin/solana-gateway-contracts', 'x402-rs/x402-rs', '0xPolygon/x402-rs',
         'coinbase/x402']
jobs = {}
for repo in repos:
    stem = repo.replace('/', '__')
    for name, tail in [('repo', ''), ('issues', '/issues?state=all&per_page=100&sort=updated'),
                       ('pulls', '/pulls?state=all&per_page=100&sort=updated'),
                       ('commits', '/commits?per_page=30'), ('contributors', '/contributors?per_page=30')]:
        jobs[f'{stem}__{name}.json'] = f'https://api.github.com/repos/{repo}{tail}'
jobs['npm-batching.json'] = 'https://registry.npmjs.org/@circle-fin%2fx402-batching'
jobs['circle-llms.txt'] = 'https://developers.circle.com/llms.txt'

def fetch(item):
    name, url = item
    req = urllib.request.Request(url, headers={'User-Agent': 'public-contribution-research', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
        (ROOT / name).write_bytes(body)
        return name, len(body)
    except Exception as exc:
        return name, str(exc)

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    for result in pool.map(fetch, jobs.items()):
        print(*result)
