"""A local pull-request host standing in for `gh` in a live ship fixture.

fable-seat-live.py copies this file to <out>/bin/gh, first on the session's
PATH, so a real ship run can open, read and review its pull request without
reaching GitHub. The real `gh` is also left unauthenticated (an empty
GH_CONFIG_DIR), so a call that bypasses this stub fails instead of acting.

It implements what ship and critical-review call: auth status, `api user`,
repo view, pr create/view/diff/list/edit/comment/checks/ready, and the review
threads query (the fixture's pull request has no threads). `pr merge` and
`pr close` are refused. Anything else fails like an unknown command. Every
call is appended to GH_STUB_LOG, a crash of the stub included; the pull
request lives in GH_STUB_STATE; diffs and head SHAs come from the bare origin
at GH_STUB_ORIGIN.
"""
import datetime
import json
import os
import subprocess
import sys

STATE = os.environ['GH_STUB_STATE']
LOG = os.environ['GH_STUB_LOG']
ORIGIN = os.environ['GH_STUB_ORIGIN']
OWNER = os.environ['GH_STUB_OWNER']
REPO = os.environ['GH_STUB_REPO']
LOGIN = 'fixture-user'
URL = f'https://github.com/{OWNER}/{REPO}'
ARGV = sys.argv[1:]
PR_FIELDS = ['additions', 'assignees', 'author', 'baseRefName', 'baseRefOid', 'body', 'changedFiles',
             'closed', 'comments', 'commits', 'createdAt', 'deletions', 'files', 'headRefName',
             'headRefOid', 'headRepository', 'headRepositoryOwner', 'id', 'isDraft', 'labels',
             'latestReviews', 'mergeStateStatus', 'mergeable', 'merged', 'mergedAt', 'number',
             'reviewDecision', 'reviewRequests', 'reviews', 'state', 'statusCheckRollup', 'title',
             'updatedAt', 'url']
REPO_FIELDS = ['defaultBranchRef', 'description', 'isPrivate', 'name', 'nameWithOwner', 'owner',
               'url', 'viewerPermission']


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def log(code, note=''):
    with open(LOG, 'a') as fh:
        fh.write(json.dumps({'at': now(), 'argv': ARGV, 'cwd': os.getcwd(), 'exit': code,
                             'note': note[:300]}) + '\n')


def done(text='', code=0, stream=None):
    if text:
        print(text, file=stream or (sys.stdout if code == 0 else sys.stderr))
    log(code, '' if code == 0 else text)
    sys.exit(code)


def load():
    try:
        with open(STATE) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {'prs': [], 'next_comment': 1001}


def save(state):
    with open(STATE, 'w') as fh:
        json.dump(state, fh, indent=1)


def git(*args, check=True):
    r = subprocess.run(['git', '--git-dir', ORIGIN, *args], capture_output=True, text=True)
    if check and r.returncode:
        return None
    return r.stdout


def parse(args, valued, flags=()):
    """Split args into (options, positionals); `valued` options take one value
    (`--x v` or `--x=v`); repeated valued options collect into lists."""
    opts, pos, i = {}, [], 0
    while i < len(args):
        a = args[i]
        name, _, inline = a.partition('=') if a.startswith('--') else (a, '', '')
        if name in valued:
            if inline:
                val = inline
            elif i + 1 < len(args):
                i += 1; val = args[i]
            else:
                done(f'flag needs an argument: {name}', 1)
            opts.setdefault(valued[name], []).append(val)
        elif name in flags:
            opts[flags[name]] = True
        elif a.startswith('-') and a != '-':
            done(f'unknown flag: {a}\n\nUsage:  gh {" ".join(ARGV[:2])} [flags]', 1)
        else:
            pos.append(a)
        i += 1
    return opts, pos


def one(opts, key, default=None):
    vals = opts.get(key)
    return vals[-1] if vals else default


def emit(data, opts, fields_allowed=None):
    """--json f1,f2 selects fields; -q/--jq filters through jq -r."""
    fields = one(opts, 'json')
    if fields is not None and fields_allowed is not None:
        wanted = [f for f in fields.split(',') if f]
        unknown = [f for f in wanted if f not in fields_allowed]
        if unknown:
            done(f'Unknown JSON field: "{unknown[0]}"\nAvailable fields:\n  ' + '\n  '.join(fields_allowed), 1)
        if isinstance(data, list):
            data = [{k: d.get(k) for k in wanted} for d in data]
        else:
            data = {k: data.get(k) for k in wanted}
    text = json.dumps(data, indent=None if one(opts, 'jq') else 2)
    expr = one(opts, 'jq')
    if expr is not None:
        r = subprocess.run(['jq', '-r', expr], input=text, capture_output=True, text=True)
        if r.returncode:
            done(r.stderr.strip() or 'jq failed', 1)
        text = r.stdout.rstrip('\n')
    done(text)


def body_from(opts):
    if one(opts, 'body_file') is not None:
        path = one(opts, 'body_file')
        return sys.stdin.read() if path == '-' else open(path).read()
    return one(opts, 'body')


def current_branch():
    r = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def find(state, selector):
    if selector is None:
        selector = current_branch()
    sel = str(selector).rstrip('/')
    for pr in state['prs']:
        if sel in (str(pr['number']), f'#{pr["number"]}', pr['url'], pr['headRefName']):
            return pr
    if sel.isdigit() or sel.startswith(URL):
        done(f'GraphQL: Could not resolve to a PullRequest with the number of {sel.split("/")[-1]}. '
             '(repository.pullRequest)', 1)
    done(f'no pull requests found for branch "{sel}"', 1)


def full(pr):
    """The pull request as gh's --json would show it, computed from origin."""
    head = (git('rev-parse', f'refs/heads/{pr["headRefName"]}') or '').strip()
    base = (git('rev-parse', f'refs/heads/{pr["baseRefName"]}') or '').strip()
    numstat = git('diff', '--numstat', f'{pr["baseRefName"]}...{pr["headRefName"]}') or ''
    files = []
    for line in numstat.splitlines():
        a, d, path = line.split('\t', 2)
        files.append({'path': path, 'additions': int(a) if a.isdigit() else 0,
                      'deletions': int(d) if d.isdigit() else 0})
    commits = [{'oid': c.split(' ', 1)[0], 'messageHeadline': c.split(' ', 1)[1] if ' ' in c else ''}
               for c in (git('log', '--reverse', '--format=%H %s',
                             f'{pr["baseRefName"]}..{pr["headRefName"]}') or '').splitlines()]
    return {**pr, 'author': {'login': LOGIN}, 'headRefOid': head, 'baseRefOid': base,
            'files': files, 'changedFiles': len(files),
            'additions': sum(f['additions'] for f in files), 'deletions': sum(f['deletions'] for f in files),
            'commits': commits, 'id': f'PR_kwFixture{pr["number"]}', 'labels': [], 'assignees': [],
            'reviewRequests': [], 'reviews': [], 'latestReviews': [], 'reviewDecision': '',
            'mergeable': 'MERGEABLE', 'mergeStateStatus': 'CLEAN', 'statusCheckRollup': [],
            'closed': False, 'merged': False, 'mergedAt': None,
            'headRepository': {'name': REPO}, 'headRepositoryOwner': {'login': OWNER}}


def pr_cmd(sub, args):
    state = load()
    common = {'-R': 'repo', '--repo': 'repo'}
    if sub == 'create':
        opts, pos = parse(args, {**common, '--base': 'base', '-B': 'base', '--head': 'head', '-H': 'head',
                                 '--title': 'title', '-t': 'title', '--body': 'body', '-b': 'body',
                                 '--body-file': 'body_file', '-F': 'body_file', '--label': 'label',
                                 '-l': 'label', '--assignee': 'assignee', '-a': 'assignee',
                                 '--reviewer': 'reviewer', '-r': 'reviewer'},
                           {'--draft': 'draft', '-d': 'draft', '--fill': 'fill', '-f': 'fill'})
        title, body = one(opts, 'title'), body_from(opts)
        if title is None or body is None:
            if not opts.get('fill'):
                done('must provide `--title` and `--body` (or `--fill` or `--fill-first` or `--fillverbose`) '
                     'when not running interactively', 1)
        head = one(opts, 'head') or current_branch()
        base = one(opts, 'base', 'main')
        if git('rev-parse', '--verify', f'refs/heads/{head}') is None:
            done('pull request create failed: GraphQL: Head sha can\'t be blank, Head ref must be a branch '
                 '(createPullRequest)', 1)
        if not (git('log', '--format=%H', f'{base}..{head}') or '').strip():
            done(f'pull request create failed: GraphQL: No commits between {base} and {head} (createPullRequest)', 1)
        for pr in state['prs']:
            if pr['headRefName'] == head and pr['state'] == 'OPEN':
                done(f'a pull request for branch "{head}" into branch "{base}" already exists:\n{pr["url"]}', 1)
        if title is None:
            title = (git('log', '-1', '--format=%s', head) or head).strip()
        if body is None:
            body = ''
        number = len(state['prs']) + 1
        pr = {'number': number, 'title': title, 'body': body, 'state': 'OPEN', 'isDraft': bool(opts.get('draft')),
              'baseRefName': base, 'headRefName': head, 'url': f'{URL}/pull/{number}',
              'createdAt': now(), 'updatedAt': now(), 'comments': [],
              'createdHeadOid': (git('rev-parse', f'refs/heads/{head}') or '').strip()}
        state['prs'].append(pr); save(state)
        done(pr['url'])
    if sub == 'view':
        opts, pos = parse(args, {**common, '--json': 'json', '-q': 'jq', '--jq': 'jq', '-t': 'template',
                                 '--template': 'template'},
                          {'--comments': 'comments', '-c': 'comments', '--web': 'web', '-w': 'web'})
        if opts.get('web'):
            done('gh-stub: no browser in this fixture', 1)
        pr = full(find(state, pos[0] if pos else None))
        if one(opts, 'json') is not None or one(opts, 'jq') is not None:
            emit(pr, opts, PR_FIELDS)
        lines = [f'{pr["title"]} #{pr["number"]}',
                 f'Open • {LOGIN} wants to merge {len(pr["commits"])} commits into {pr["baseRefName"]} '
                 f'from {pr["headRefName"]}',
                 f'+{pr["additions"]} -{pr["deletions"]} • No checks', '', pr['body'] or 'No description provided', '']
        if opts.get('comments'):
            for c in pr['comments']:
                lines += [f'{c["author"]["login"]} • {c["createdAt"]}', c['body'], '']
        lines.append(f'View this pull request on GitHub: {pr["url"]}')
        done('\n'.join(lines))
    if sub == 'diff':
        opts, pos = parse(args, {**common, '--color': 'color'},
                          {'--name-only': 'name_only', '--patch': 'patch', '--web': 'web'})
        if opts.get('web'):
            done('gh-stub: no browser in this fixture', 1)
        pr = find(state, pos[0] if pos else None)
        extra = ['--name-only'] if opts.get('name_only') else []
        done((git('diff', *extra, f'{pr["baseRefName"]}...{pr["headRefName"]}') or '').rstrip('\n'))
    if sub == 'list':
        opts, pos = parse(args, {**common, '--head': 'head', '-H': 'head', '--base': 'base', '-B': 'base',
                                 '--state': 'state', '-s': 'state', '--json': 'json', '-q': 'jq', '--jq': 'jq',
                                 '--limit': 'limit', '-L': 'limit', '--author': 'author', '-A': 'author',
                                 '--search': 'search', '-S': 'search', '--label': 'label', '-l': 'label'})
        want = (one(opts, 'state', 'open')).upper()
        prs = [full(p) for p in state['prs']
               if (one(opts, 'head') in (None, p['headRefName']))
               and (one(opts, 'base') in (None, p['baseRefName']))
               and (want == 'ALL' or p['state'] == want)]
        if one(opts, 'json') is not None or one(opts, 'jq') is not None:
            emit(prs, opts, PR_FIELDS)
        if not prs:
            done(f'no open pull requests in {OWNER}/{REPO}', 0, sys.stderr)
        rows = [f'#{p["number"]}\t{p["title"]}\t{p["headRefName"]}\tOPEN' for p in prs]
        done(f'\nShowing {len(prs)} of {len(prs)} open pull requests in {OWNER}/{REPO}\n\n' + '\n'.join(rows))
    if sub == 'edit':
        opts, pos = parse(args, {**common, '--title': 'title', '-t': 'title', '--body': 'body', '-b': 'body',
                                 '--body-file': 'body_file', '-F': 'body_file', '--base': 'base', '-B': 'base',
                                 '--add-label': 'label', '--remove-label': 'unlabel'})
        pr = find(state, pos[0] if pos else None)
        if one(opts, 'title') is not None: pr['title'] = one(opts, 'title')
        body = body_from(opts)
        if body is not None: pr['body'] = body
        if one(opts, 'base') is not None: pr['baseRefName'] = one(opts, 'base')
        pr['updatedAt'] = now(); save(state)
        done(pr['url'])
    if sub == 'comment':
        opts, pos = parse(args, {**common, '--body': 'body', '-b': 'body', '--body-file': 'body_file',
                                 '-F': 'body_file'}, {'--edit-last': 'edit_last'})
        pr = find(state, pos[0] if pos else None)
        body = body_from(opts)
        if body is None:
            done('--body or --body-file required when not running interactively', 1)
        cid = state['next_comment']; state['next_comment'] += 1
        c = {'id': cid, 'author': {'login': LOGIN}, 'body': body, 'createdAt': now(),
             'url': f'{pr["url"]}#issuecomment-{cid}'}
        pr['comments'].append(c); save(state)
        done(c['url'])
    if sub == 'checks':
        opts, pos = parse(args, {**common, '--json': 'json', '-q': 'jq', '--jq': 'jq', '--interval': 'interval',
                                 '-i': 'interval'}, {'--watch': 'watch', '--required': 'required',
                                                     '--fail-fast': 'fail_fast', '--web': 'web'})
        pr = find(state, pos[0] if pos else None)
        done(f"no checks reported on the '{pr['headRefName']}' branch", 1)
    if sub == 'ready':
        opts, pos = parse(args, common, {'--undo': 'undo'})
        pr = find(state, pos[0] if pos else None)
        pr['isDraft'] = bool(opts.get('undo')); save(state)
        done(f'✓ Pull request {OWNER}/{REPO}#{pr["number"]} is marked as "ready for review"')
    if sub in ('merge', 'close', 'reopen', 'review'):
        done(f'gh-stub: `gh pr {sub}` is not available in this fixture', 1)
    done(f'unknown command "{sub}" for "gh pr"', 1)


THREADS = {'data': {'repository': {'pullRequest': {'reviewThreads': {
    'totalCount': 0, 'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'nodes': []}}}}}


def api_cmd(args):
    opts, pos = parse(args, {'-f': 'raw', '--raw-field': 'raw', '-F': 'field', '--field': 'field',
                             '-X': 'method', '--method': 'method', '-q': 'jq', '--jq': 'jq',
                             '-H': 'header', '--header': 'header', '--input': 'input', '-R': 'repo',
                             '--repo': 'repo', '-t': 'template', '--template': 'template',
                             '--hostname': 'hostname', '--cache': 'cache', '-p': 'preview',
                             '--preview': 'preview'},
                      {'--paginate': 'paginate', '--slurp': 'slurp', '-i': 'include', '--include': 'include',
                       '--silent': 'silent', '--verbose': 'verbose'})
    if not pos:
        done('accepts 1 arg(s), received 0', 1)
    endpoint = pos[0].replace('{owner}', OWNER).replace('{repo}', REPO) \
        .replace(':owner', OWNER).replace(':repo', REPO).lstrip('/')
    fields = dict(f.split('=', 1) for f in (opts.get('raw') or []) + (opts.get('field') or []) if '=' in f)
    state = load()
    if endpoint == 'user':
        emit({'login': LOGIN, 'id': 1, 'type': 'User', 'name': 'Fixture User'}, opts)
    if endpoint == 'graphql':
        query = fields.get('query', '')
        if 'reviewThreads' in query and 'mutation' not in query:
            emit(THREADS, opts)
        if 'viewer' in query and 'mutation' not in query:
            emit({'data': {'viewer': {'login': LOGIN}}}, opts)
        done('gh-stub: GraphQL: this fixture answers only the review-threads and viewer queries', 1)
    prefix = f'repos/{OWNER}/{REPO}'
    if endpoint == prefix:
        emit({'name': REPO, 'full_name': f'{OWNER}/{REPO}', 'default_branch': 'main', 'private': True,
              'html_url': URL, 'owner': {'login': OWNER}}, opts)
    parts = endpoint[len(prefix) + 1:].split('?')[0].split('/') if endpoint.startswith(prefix + '/') else []
    if len(parts) >= 2 and parts[0] in ('pulls', 'issues') and parts[1].isdigit():
        pr = next((p for p in state['prs'] if p['number'] == int(parts[1])), None)
        if pr is None:
            done('gh: Not Found (HTTP 404)', 1)
        rest = parts[2:]
        method = (one(opts, 'method') or ('POST' if fields else 'GET')).upper()
        if parts[0] == 'pulls' and rest in (['reviews'], ['comments']) and method == 'GET':
            emit([], opts)
        if parts[0] == 'issues' and rest == ['comments']:
            if method == 'GET':
                emit([{'id': c['id'], 'body': c['body'], 'user': {'login': c['author']['login']},
                       'created_at': c['createdAt'], 'html_url': c['url']} for c in pr['comments']], opts)
            if method == 'POST' and 'body' in fields:
                cid = state['next_comment']; state['next_comment'] += 1
                c = {'id': cid, 'author': {'login': LOGIN}, 'body': fields['body'], 'createdAt': now(),
                     'url': f'{pr["url"]}#issuecomment-{cid}'}
                pr['comments'].append(c); save(state)
                emit({'id': cid, 'html_url': c['url'], 'body': c['body']}, opts)
        if parts[0] == 'pulls' and not rest and method == 'GET':
            p = full(pr)
            emit({'number': p['number'], 'title': p['title'], 'body': p['body'], 'state': 'open',
                  'html_url': p['url'], 'draft': p['isDraft'],
                  'head': {'ref': p['headRefName'], 'sha': p['headRefOid']},
                  'base': {'ref': p['baseRefName'], 'sha': p['baseRefOid']}, 'user': {'login': LOGIN}}, opts)
    done('gh: Not Found (HTTP 404)', 1)


def main():
    if not ARGV or ARGV[0] in ('--help', '-h', 'help'):
        done('Work seamlessly with GitHub from the command line.\n\nUSAGE\n  gh <command> <subcommand> [flags]')
    if ARGV[0] in ('--version', 'version'):
        done('gh version 2.83.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.83.0')
    cmd, rest = ARGV[0], ARGV[1:]
    if cmd == 'auth':
        sub = rest[0] if rest else ''
        if sub == 'status':
            done('github.com\n  ✓ Logged in to github.com account fixture-user (keyring)\n'
                 '  - Active account: true\n  - Git operations protocol: ssh\n'
                 "  - Token: gho_************************************\n"
                 "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'")
        if sub == 'token':
            done('gho_fixtureTokenNotUsable0000000000000000')
        done(f'gh-stub: `gh auth {sub}` is not available in this fixture', 1)
    if cmd == 'api':
        api_cmd(rest)
    if cmd == 'repo' and rest[:1] == ['view']:
        opts, pos = parse(rest[1:], {'--json': 'json', '-q': 'jq', '--jq': 'jq', '-R': 'repo', '--repo': 'repo',
                                     '-b': 'branch', '--branch': 'branch'}, {'--web': 'web', '-w': 'web'})
        data = {'name': REPO, 'owner': {'login': OWNER}, 'nameWithOwner': f'{OWNER}/{REPO}', 'url': URL,
                'defaultBranchRef': {'name': 'main'}, 'viewerPermission': 'ADMIN', 'isPrivate': True,
                'description': ''}
        if one(opts, 'json') is not None or one(opts, 'jq') is not None:
            emit(data, opts, REPO_FIELDS)
        done(f'{OWNER}/{REPO}\nNo description provided')
    if cmd == 'pr' and rest:
        pr_cmd(rest[0], rest[1:])
    if cmd in ('run', 'workflow') and rest[:1] == ['list']:
        done('no runs found' if cmd == 'run' else 'no workflows found', 0)
    done(f'gh-stub: unsupported command: gh {" ".join(ARGV)}', 1)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as error:  # logged like any other call, then failed
        import traceback
        traceback.print_exc()
        log(1, 'gh-stub crashed: ' + ''.join(traceback.format_exception_only(type(error), error)).strip())
        sys.exit(1)
