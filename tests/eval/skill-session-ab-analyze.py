#!/usr/bin/env python3
"""skill-session-ab-analyze.py <run-dir> [<run-dir> ...]

Parses the `codex exec --json` turn logs (turn-<k>.jsonl) of run-arm.sh run directories,
writes <run-dir>/metrics.json and prints per-run and per-arm tables.

Observed schema (codex-cli 0.160.0, exec --json):
  {"type":"thread.started","thread_id":...}
  {"type":"turn.started"}
  {"type":"item.started"|"item.updated"|"item.completed","item":{"id":"item_N","type":...}}
     command_execution: command ("/bin/zsh -lc '<script>'"), aggregated_output, exit_code, status
     agent_message:     text
     file_change:       changes:[{path (absolute), kind: add|update|delete}], status
     collab_tool_call:  tool (wait|spawn_agent|...), sender_thread_id, receiver_thread_ids, prompt, agents_states
     reasoning / todo_list / mcp_tool_call / web_search / error: counted by type only
  {"type":"turn.completed","usage":{input_tokens,cached_input_tokens,cache_write_input_tokens,
                                    output_tokens,reasoning_output_tokens}}
  {"type":"turn.failed","error":{...}} / {"type":"error",...}
Item ids restart at item_0 every turn. spawn_agent does NOT appear as an exec item (only `wait`
does), so native sub-agent spawns are read from the copied session rollout (rollout.jsonl:
response_item function_call name=spawn_agent; turns delimited by event_msg task_started).
Without a rollout.jsonl the summary reports native_spawns as null (missing).

Python writes (coordinator edits). A python heredoc (python, python3, python3.<n>, with `-` or
without) or a `python3 -c '...'` one-liner writes a path only when the code, parsed with `ast`,
passes that path to open(<p>, <mode>) with a write mode (w, a, x, wb, ab, ...), to
Path(<p>).write_text(...) / .write_bytes(...), or calls .write_text / .write_bytes on a variable
bound to Path(<p>). <p> must be a string literal or a variable assigned from one. Paths that are
only read (read_text, open(p), mode r, git show, ast.parse) or only mentioned are not writes.
Accepted under-count: a write whose target is not a string literal or a variable bound to one
(root / 'x', root.parent / 'x', f-strings, computed names) is not counted, and python code that
does not parse is not counted.
"""
import ast
import json
import os
import re
import shlex
import subprocess
import sys
from collections import OrderedDict, defaultdict

# ---------------------------------------------------------------- helpers

def norm(p):
    """Canonical absolute path text: drop macOS /private prefix, collapse dots."""
    p = os.path.normpath(p)
    if p.startswith('/private/'):
        p = p[len('/private'):]
    return p


def unwrap(command):
    """'/bin/zsh -lc "<script>"' -> '<script>'."""
    try:
        toks = shlex.split(command)
    except ValueError:
        toks = None
    if toks and len(toks) >= 3 and os.path.basename(toks[0]) in ('zsh', 'bash', 'sh') and toks[1] in ('-lc', '-c'):
        return toks[2]
    return command


SEG_SPLIT = re.compile(r'\s*(?:&&|\|\||;|\n)\s*')


def segments(script):
    """Split a script into pipelines (rough: ignores quoting, good enough for classification)."""
    return [s for s in SEG_SPLIT.split(script) if s.strip()]


def tokens(text):
    try:
        return shlex.split(text, comments=False)
    except ValueError:
        return text.split()


SKILL_RE = re.compile(r'[^\s\'"<>|;&()]*SKILL\.md')
REF_RE = re.compile(r'([^\s\'"<>|;&()]*skills[^/\s\'"]*/[^\s\'"<>|;&()]*?references/([A-Za-z0-9_.\-]+))')
READERS = ('cat', 'less', 'more', 'bat', 'nl', 'sed', 'head', 'tail', 'awk', 'view', 'python', 'python3', 'node', 'wc')
SED_RANGE = re.compile(r"sed\s+-n\s+['\"]?(\d+)\s*,\s*(\d+|\$)\s*p")
HEAD_N = re.compile(r'\bhead\s+(?:-n\s*|-)(\d+)')
TAIL_N = re.compile(r'\btail\s+(?:-n\s*\+?|-)(\d+)')
AWK_NR = re.compile(r"awk\s+['\"][^'\"]*NR\s*[<>=]")
GREP_RE = re.compile(r'(^|\s|\|)(rg|grep|egrep|ag)\s')


def file_lines(path, cache={}):
    if path not in cache:
        try:
            with open(path, encoding='utf-8', errors='replace') as f:
                cache[path] = sum(1 for _ in f)
        except OSError:
            cache[path] = None
    return cache[path]


def classify_skill_reads(script, cwd):
    """Return list of (kind, path) with kind in full|ranged|grep for each SKILL.md touched."""
    out = []
    for seg in segments(script):
        paths = SKILL_RE.findall(seg)
        if not paths:
            continue
        first = os.path.basename(tokens(seg)[0]) if tokens(seg) else ''
        if GREP_RE.search(' ' + seg):
            for p in paths:
                out.append(('grep', p))
            continue
        if first in ('codex', 'git', 'cp', 'mv', 'ls', 'find', 'test', '[', 'stat', 'echo', 'printf', 'shasum'):
            continue
        if first == 'wc':
            continue
        for p in paths:
            ap = p if os.path.isabs(p) else os.path.join(cwd, p)
            n = file_lines(ap)
            m = SED_RANGE.search(seg)
            kind = 'full'
            if m:
                a = int(m.group(1))
                b = m.group(2)
                whole = a <= 1 and (b == '$' or (n is not None and int(b) >= n) or (n is None and int(b) >= 2000))
                kind = 'full' if whole else 'ranged'
            elif HEAD_N.search(seg):
                b = int(HEAD_N.search(seg).group(1))
                kind = 'full' if (n is not None and b >= n) else 'ranged'
            elif TAIL_N.search(seg) or AWK_NR.search(seg):
                kind = 'ranged'
            out.append((kind, p))
    return out


def ref_reads(script, cwd):
    """[(name, exists)] for reference files a command reads (exists=False: path does not resolve)."""
    names = []
    for seg in segments(script):
        if 'codex-wave-runner.mjs' in seg and re.search(r'\bnode\b', seg) and not re.search(r'\b(cat|sed|head|tail|nl|less|bat|rg|grep)\b', seg):
            continue  # executing the runner, not reading it
        toks = tokens(seg)
        first = os.path.basename(toks[0]) if toks else ''
        if first in ('node', 'cp', 'mv', 'ls', 'find', 'test', '[', 'git', 'codex'):
            continue
        for path, name in REF_RE.findall(seg):
            ap = path if os.path.isabs(path) else os.path.join(cwd, path)
            names.append((name, os.path.exists(ap)))
    return names


REDIR = re.compile(r'(?<![0-9&<>])(?:[12]?>>?|&>)\s*([^\s;&|<>()]+)')
APPLY_PATCH_FILE = re.compile(r'\*\*\* (?:Update|Add|Delete) File:\s*(\S+)')
QUOTED_PATH = re.compile(r'[\'"]([^\'"\s]+\.(?:py|yml|yaml|md|txt|toml|cfg|json|ini))[\'"]')


HEREDOC_MARK = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
PY_HEREDOC = re.compile(r'(?:^|[\s;&|(/])python(?:3(?:\.\d+)?)?(?:\s+-[A-Za-z]+)*\s+-?\s*<<')
PY_DASH_C = re.compile(r"""(?:^|[\s;&|(/])python(?:3(?:\.\d+)?)?\s+-c\s+('[^']*'|"(?:[^"\\]|\\.)*")""")


def split_heredocs(script):
    """-> (script without heredoc bodies, [(starter line, body)]) for <<TAG / <<'TAG' / <<-TAG."""
    kept, docs, pending, cur = [], [], None, None
    for line in script.split('\n'):
        if pending is not None:
            if line.strip() == pending[0]:
                docs.append((pending[1], '\n'.join(cur)))
                pending = None
            else:
                cur.append(line)
            continue
        kept.append(line)
        m = HEREDOC_MARK.search(line)
        if m:
            pending, cur = (m.group(2), line), []
    if pending is not None:
        docs.append((pending[1], '\n'.join(cur)))
    return '\n'.join(kept), docs


def _is_path_ctor(node):
    return isinstance(node, ast.Call) and (
        (isinstance(node.func, ast.Name) and node.func.id == 'Path') or
        (isinstance(node.func, ast.Attribute) and node.func.attr == 'Path'))


def python_writes(code):
    """Paths python source writes, only for literal targets (see module docstring)."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    strs, paths = {}, {}  # name -> literal / name -> literal bound via Path(<literal>)

    def lit(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return strs.get(node.id)
        return None

    def path_of(node):
        """Literal path behind Path(<p>) or a name bound to one."""
        if _is_path_ctor(node) and len(node.args) == 1 and not node.keywords:
            return lit(node.args[0])
        if isinstance(node, ast.Name):
            return paths.get(node.id)
        return None

    nodes = sorted((n for n in ast.walk(tree) if hasattr(n, 'lineno')), key=lambda n: (n.lineno, n.col_offset))
    out = []
    for n in nodes:
        if isinstance(n, (ast.Assign, ast.AnnAssign)):
            value = n.value
            targets = n.targets if isinstance(n, ast.Assign) else [n.target]
            if value is None:
                continue
            for t in targets:
                if isinstance(t, ast.Name):
                    if lit(value) is not None and not isinstance(value, ast.Name):
                        strs[t.id] = value.value
                    elif isinstance(value, ast.Name) and value.id in strs:
                        strs[t.id] = strs[value.id]
                    if path_of(value) is not None:
                        paths[t.id] = path_of(value)
        elif isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name) and f.id == 'open' and n.args:
                mode = n.args[1] if len(n.args) > 1 else next((k.value for k in n.keywords if k.arg == 'mode'), None)
                mode = lit(mode) if mode is not None else None
                p = lit(n.args[0]) or path_of(n.args[0])
                if p and mode and any(c in mode for c in 'wax'):
                    out.append(p)
            elif isinstance(f, ast.Attribute) and f.attr in ('write_text', 'write_bytes'):
                p = path_of(f.value)
                if p:
                    out.append(p)
    return out


def python_heredoc_writes(script):
    """Writes made by python heredocs and `python -c '...'` one-liners in a shell script."""
    _, docs = split_heredocs(script)
    out = []
    for starter, body in docs:
        if PY_HEREDOC.search(starter):
            out += python_writes(body)
    for m in PY_DASH_C.finditer(script):
        q = m.group(1)
        code = q[1:-1]
        if q[0] == '"':
            code = re.sub(r'\\([\\"$`])', r'\1', code)
        out += python_writes(code)
    return out


def write_targets(script):
    """Paths a shell script writes to (heuristic). Returns list of (path, how)."""
    out = []
    if 'apply_patch' in script or '*** Begin Patch' in script:
        out += [(p, 'apply_patch') for p in APPLY_PATCH_FILE.findall(script)]
    shell_script, _ = split_heredocs(script)  # heredoc bodies are data, not shell commands
    for seg in segments(shell_script):
        toks = tokens(seg)
        if not toks:
            continue
        first = os.path.basename(toks[0])
        for p in REDIR.findall(seg):
            if p not in ('/dev/null', '/dev/stderr', '/dev/stdout') and not p.startswith('&'):
                out.append((p, 'redirect'))
        if first == 'sed' and any(t == '-i' or t.startswith('-i') for t in toks[1:]):
            out += [(t, 'sed -i') for t in toks[2:] if not t.startswith('-') and ('/' in t or '.' in t) and not re.match(r'^s.', t)]
        elif first == 'perl' and any(re.match(r'^-\w*i', t) for t in toks[1:]):
            out += [(t, 'perl -i') for t in toks[1:] if not t.startswith('-') and re.search(r'\.\w+$', t)]
        elif first == 'tee':
            out += [(t, 'tee') for t in toks[1:] if not t.startswith('-')]
        elif first in ('cp', 'mv', 'install'):
            if len(toks) >= 3:
                out.append((toks[-1], first))
        elif first in ('rm',) or (first == 'git' and len(toks) > 1 and toks[1] == 'rm'):
            out += [(t, 'rm') for t in toks[1:] if not t.startswith('-') and t != 'rm']
        elif first in ('node', 'ruby'):
            if re.search(r"write_text|write\(|open\([^)]*['\"][wa]\+?['\"]|writeFileSync|writeFile\(", seg):
                out += [(p, first + ' write') for p in QUOTED_PATH.findall(seg)]
    out += [(p, 'python write') for p in python_heredoc_writes(script)]
    seen, uniq = set(), []
    for p, how in out:
        if (p, how) not in seen:
            seen.add((p, how)); uniq.append((p, how))
    return uniq


def classify_edit(path, repo, tracked):
    """-> None (not a coordinator edit) | ('tracked'|'other', relpath)."""
    ap = norm(path if os.path.isabs(path) else os.path.join(repo, path))
    r = norm(repo)
    if not (ap == r or ap.startswith(r + '/')):
        return None
    rel = os.path.relpath(ap, r)
    if rel == '.' or rel.startswith('.worktrees/') or rel.startswith('.context/') or rel.startswith('.git/'):
        return None
    base = os.path.basename(rel)
    if rel.startswith('docs/superpowers/plans/') or (base.endswith('.md') and 'plan' in base.lower() and rel not in tracked):
        return None
    if '__pycache__' in rel:
        return None
    return ('tracked' if rel in tracked else 'other', rel)


ANNOUNCE = re.compile(
    r'(?i:профил|profile)[\s\S]{0,80}?(?:(?i:gpt-)|\bgeneric\b|\bSol\b|\bLuna\b|\bAstra\b)'
    r'|(?:(?i:gpt-)|\bgeneric\b|\bSol\b|\bLuna\b|\bAstra\b)[\s\S]{0,80}?(?i:профил|profile)')
APPROVAL = re.compile(r'(?i)(подтвер|одобр|утвер|можно|соглас|разреш|запуска|запустить|продолж|начина|приступ|Gate|гейт|approve|proceed|confirm|go ahead|ok\?|ок\?|да\?)')
RUNNER = re.compile(r'codex-wave-runner\.mjs')
RAW_CODEX = re.compile(r'(^|[\s;&|(/])codex\s+(?:exec|e)\b')
SEAM = re.compile(r'(?i)seam|шов|швов|стык')
AUDIT = re.compile(r'(?i)seam|audit|аудит|шов|швов|стык')


def is_gate(text):
    t = text.rstrip().rstrip('*_`) ').rstrip()
    if not t.endswith('?'):
        return False
    tail = t[-400:]
    return bool(APPROVAL.search(tail))


# ---------------------------------------------------------------- per run

def load_turn(path):
    events = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line.startswith('{'):
                continue
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
    return events


def rollout_turns(path):
    """Per-turn native sub-agent spawns from the session rollout (turn k = k-th task_started)."""
    turns = []
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            p = o.get('payload') or {}
            if not isinstance(p, dict):
                continue
            if o.get('type') == 'event_msg' and p.get('type') == 'task_started':
                turns.append({'spawns': [], 'tools': defaultdict(int)})
            elif o.get('type') == 'response_item' and p.get('type') in ('function_call', 'custom_tool_call') and turns:
                name = p.get('name') or ''
                turns[-1]['tools'][name] += 1
                if name == 'spawn_agent':
                    try:
                        args = json.loads(p.get('arguments') or '{}')
                    except ValueError:
                        args = {}
                    turns[-1]['spawns'].append(args.get('task_name') or '')
    return turns


def tracked_files(repo):
    try:
        root = subprocess.run(['git', '-C', repo, 'rev-list', '--max-parents=0', 'HEAD'],
                              capture_output=True, text=True, check=True).stdout.split()[0]
        out = subprocess.run(['git', '-C', repo, 'ls-tree', '-r', '--name-only', root],
                             capture_output=True, text=True, check=True).stdout
        return set(out.split())
    except Exception:
        return set()


def read_meta(run):
    meta = {}
    p = os.path.join(run, 'meta.txt')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if '=' in line:
                k, v = line.rstrip('\n').split('=', 1)
                meta[k] = v
    if 'arm' not in meta:
        head = open(p).readline() if os.path.exists(p) else ''
        m = re.search(r'arm=(\S+)', head)
        meta['arm'] = m.group(1) if m else re.sub(r'-\d+$', '', os.path.basename(run.rstrip('/')))
    else:
        meta['arm'] = meta['arm'].split()[0]
    return meta


def cumulative_usage_proven(run, usages):
    """Resumed exec counters can include earlier turns. Require owned rollout evidence.

    Monotonically growing per-turn usage alone is not evidence of accumulation.
    Legacy fixtures without matching total_token_usage keep their original mode.
    """
    fields = ('input_tokens', 'cached_input_tokens', 'output_tokens')
    path = os.path.join(run, 'rollout.jsonl')
    if len(usages) < 2 or not os.path.isfile(path):
        return False
    totals = set()
    for row in load_turn(path):
        payload = row.get('payload') or {}
        if row.get('type') == 'event_msg' and payload.get('type') == 'token_count':
            total = (payload.get('info') or {}).get('total_token_usage') or {}
            if all(k in total for k in fields): totals.add(tuple(total[k] for k in fields))
    return bool(totals) and all(all(k in u for k in fields) and tuple(u[k] for k in fields) in totals for u in usages)


def analyze_run(run, event_loader=load_turn, provider='codex'):
    run = os.path.abspath(run)
    repo = os.path.join(run, 'repo')
    tracked = tracked_files(repo)
    meta = read_meta(run)
    ks = sorted(int(m.group(1)) for f in os.listdir(run) for m in [re.match(r'turn-(\d+)\.jsonl$', f)] if m)
    rt = rollout_turns(os.path.join(run, 'rollout.jsonl')) if provider == 'codex' else None
    raw_usages = [e.get('usage') or {} for k in ks for e in event_loader(os.path.join(run, f'turn-{k}.jsonl'))
                  if e.get('type') == 'turn.completed']
    cumulative = provider == 'codex' and cumulative_usage_proven(run, raw_usages)
    previous_usage = {}
    turns = []
    for k in ks:
        ev = event_loader(os.path.join(run, f'turn-{k}.jsonl'))
        items = OrderedDict()
        usage, completed, failed = None, False, []
        for e in ev:
            t = e.get('type', '')
            if t.startswith('item.') and isinstance(e.get('item'), dict):
                it = e['item']
                key = it.get('id') or str(len(items))
                if key not in items or t == 'item.completed':
                    items[key] = it
            elif t == 'turn.completed':
                completed, usage = True, e.get('usage') or {}
            elif t in ('turn.failed', 'error'):
                failed.append(str(e.get('error') or e.get('message'))[:200])
                usage = e.get('usage') or usage
        m = defaultdict(int)
        m['turn'] = k
        m['completed'] = completed
        m['errors'] = failed
        lists = defaultdict(list)
        msgs = []
        for it in items.values():
            typ = it.get('type')
            m['items_' + str(typ)] += 1
            if typ == 'command_execution':
                m['commands_total'] += 1
                script = unwrap(it.get('command') or '')
                # counted per command execution (a command that reads a SKILL.md in full counts once)
                kinds = defaultdict(set)
                for kind, p in classify_skill_reads(script, repo):
                    kinds[kind].add(p)
                for kind, ps in kinds.items():
                    key = {'full': 'skill_reads_full', 'ranged': 'skill_reads_ranged', 'grep': 'skill_greps'}[kind]
                    m[key] += 1
                    lists[key].extend(sorted(ps))
                    if any('/multi-model/SKILL.md' in x or x == 'SKILL.md' for x in ps):
                        m[key + '_mm'] += 1
                for name, exists in ref_reads(script, repo):
                    # counted by path pattern whether or not the file exists today;
                    # ref_reads_missing is informational (subset whose path no longer resolves)
                    m['ref_reads'] += 1
                    lists['ref_reads'].append(name)
                    if not exists:
                        m['ref_reads_missing'] += 1
                        lists['ref_reads_missing'].append(name)
                if RUNNER.search(script) and re.search(r'\bnode\b', script) and '--help' not in script:
                    if '--reset' in script:
                        m['runner_resets'] += 1
                    else:
                        m['runner_launches'] += 1
                    lists['runner_cmds'].append(script[:300])
                elif RAW_CODEX.search(script) and '--help' not in script:
                    m['raw_codex_exec'] += 1
                    lists['raw_codex_cmds'].append(script[:300])
                    if SEAM.search(script):
                        m['seam_audits'] += 1
                    if AUDIT.search(script):
                        m['audit_agents'] += 1
                for p, how in (write_targets(script) if it.get('status') != 'failed' else []):
                    c = classify_edit(p, repo, tracked)
                    if c:
                        key = 'coordinator_edits' if c[0] == 'tracked' else 'coordinator_other_writes'
                        m[key] += 1
                        lists[key].append(f'{c[1]} ({how})')
            elif typ == 'file_change':
                for ch in it.get('changes') or []:
                    c = classify_edit(ch.get('path') or '', repo, tracked)
                    if c:
                        key = 'coordinator_edits' if c[0] == 'tracked' else 'coordinator_other_writes'
                        m[key] += 1
                        lists[key].append(f"{c[1]} (file_change:{ch.get('kind')})")
            elif typ == 'agent_message':
                text = it.get('text') or ''
                msgs.append(text)
                n = len(ANNOUNCE.findall(text))
                m['announce'] += n
                if n:
                    m['announce_msgs'] += 1
                if is_gate(text):
                    m['gates'] += 1
            elif typ == 'collab_tool_call':
                tool = it.get('tool') or ''
                m['collab_' + tool] += 1
                if tool == 'spawn_agent' and rt is None:  # fallback when no rollout was copied
                    m['native_spawns'] += 1
                    m['seam_audits'] += bool(SEAM.search(str(it.get('prompt') or '')))
                    m['audit_agents'] += bool(AUDIT.search(str(it.get('prompt') or '')))
        m['agent_messages'] = len(msgs)
        if rt is not None and k - 1 < len(rt):
            spawns = rt[k - 1]['spawns']
            m['native_spawns'] = len(spawns)
            lists['native_spawns'] = spawns
            # runner-less audit agents: native sub-agents whose task name mentions seam/audit
            m['seam_audits'] += sum(1 for s in spawns if SEAM.search(s))
            m['audit_agents'] += sum(1 for s in spawns if AUDIT.search(s))
        u = usage or {}
        if cumulative and u:
            delta = {key: value-previous_usage.get(key, 0) for key, value in u.items() if isinstance(value, (int, float))}
            if any(value < 0 for value in delta.values()):
                raise ValueError('Owned cumulative usage decreased; do not sum unverified counters')
            previous_usage = u
            u = delta
        m['input_tokens'] = u.get('input_tokens', 0)
        m['cached_input_tokens'] = u.get('cached_input_tokens', 0)
        m['cache_write_input_tokens'] = u.get('cache_write_input_tokens', 0)
        m['output_tokens'] = u.get('output_tokens', 0)
        m['reasoning_output_tokens'] = u.get('reasoning_output_tokens', 0)
        rec = dict(m)
        rec['lists'] = dict(lists)
        rec['last_message'] = (msgs[-1][-300:] if msgs else '')
        turns.append(rec)

    def tot(key, sel=None):
        return sum(t.get(key, 0) for t in turns if sel is None or sel(t['turn']))

    t68 = lambda k: 6 <= k <= 8
    msgs_total = tot('agent_messages')
    summary = {
        'run': run,
        'arm': meta.get('arm'),
        'thread_id': meta.get('thread_id'),
        'turns': len(turns),
        'usage_mode': 'cumulative_verified_by_rollout' if cumulative else 'stream_per_turn',
        'turns_completed': sum(1 for t in turns if t['completed']),
        'skill_reads_full': tot('skill_reads_full'),
        'skill_reads_full_mm': tot('skill_reads_full_mm'),
        'skill_reads_ranged': tot('skill_reads_ranged'),
        'skill_greps': tot('skill_greps'),
        'skill_reads_full_per_turn': round(tot('skill_reads_full') / len(turns), 3) if turns else 0,
        'ref_reads': tot('ref_reads'),
        'ref_reads_missing': tot('ref_reads_missing'),
        'ref_reads_by_file': dict(sorted(_count(n for t in turns for n in t['lists'].get('ref_reads', [])).items())),
        'announce': tot('announce'),
        'announce_msgs': tot('announce_msgs'),
        'agent_messages': msgs_total,
        'announce_frac': round(tot('announce_msgs') / msgs_total, 3) if msgs_total else 0,
        'coordinator_edits': tot('coordinator_edits'),
        'coordinator_edit_paths': sorted(set(p for t in turns for p in t['lists'].get('coordinator_edits', []))),
        'coordinator_other_writes': tot('coordinator_other_writes'),
        'runner_launches': tot('runner_launches'),
        'runner_resets': tot('runner_resets'),
        'raw_codex_exec': tot('raw_codex_exec'),
        'native_spawns': tot('native_spawns') if rt is not None or provider == 'claude' else None,
        'seam_audits': tot('seam_audits'),
        'audit_agents': tot('audit_agents'),
        'seam_audits_t6_8': tot('audit_agents', t68),
        'gates': tot('gates'),
        'gates_t6_8': tot('gates', t68),
        'runner_launches_t6_8': tot('runner_launches', t68),
        'coordinator_edits_t6_8': tot('coordinator_edits', t68),
        'commands_total': tot('commands_total'),
        'input_tokens': tot('input_tokens'),
        'cached_input_tokens': tot('cached_input_tokens'),
        'cache_write_input_tokens': tot('cache_write_input_tokens'),
        'output_tokens': tot('output_tokens'),
        'rollout_found': rt is not None if provider == 'codex' else os.path.isfile(os.path.join(run, 'rollout.jsonl')),
    }
    result = {'summary': summary, 'per_turn': turns}
    with open(os.path.join(run, 'metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)
    return result


def _count(it):
    d = defaultdict(int)
    for x in it:
        d[x] += 1
    return d


# ---------------------------------------------------------------- printing

TURN_COLS = [('turn', 'T'), ('completed', 'ok'), ('commands_total', 'cmds'), ('skill_reads_full', 'skFull'), ('skill_reads_full_mm', 'mmFull'),
             ('skill_reads_ranged', 'skRng'), ('skill_greps', 'skGrep'), ('ref_reads', 'refs'),
             ('agent_messages', 'msgs'), ('announce_msgs', 'annMsg'), ('coordinator_edits', 'coEdit'),
             ('runner_launches', 'runner'), ('runner_resets', 'reset'), ('raw_codex_exec', 'rawCdx'),
             ('native_spawns', 'spawn'), ('seam_audits', 'seam'), ('audit_agents', 'audit'), ('gates', 'gate'),
             ('input_tokens', 'in'), ('cached_input_tokens', 'cached'), ('output_tokens', 'out')]
ARM_COLS = ['skill_reads_full', 'skill_reads_full_mm', 'skill_reads_full_per_turn', 'skill_reads_ranged', 'skill_greps', 'ref_reads',
            'announce', 'announce_frac', 'coordinator_edits', 'runner_launches', 'runner_resets', 'raw_codex_exec',
            'native_spawns', 'seam_audits', 'audit_agents', 'seam_audits_t6_8', 'gates_t6_8', 'runner_launches_t6_8',
            'commands_total', 'input_tokens', 'cached_input_tokens', 'output_tokens']


def table(rows, cols):
    widths = [max(len(h), *(len(str(r[i])) for r in rows)) if rows else len(h) for i, h in enumerate(cols)]
    lines = ['  '.join(h.rjust(w) for h, w in zip(cols, widths))]
    for r in rows:
        lines.append('  '.join(str(v).rjust(w) for v, w in zip(r, widths)))
    return '\n'.join(lines)


def main(argv):
    if not argv:
        print(__doc__.split('\n\n')[0], file=sys.stderr)
        return 2
    results = [analyze_run(r) for r in argv]
    by_arm = defaultdict(list)
    for res in results:
        s = res['summary']
        by_arm[s['arm']].append(s)
        print(f"\n== {s['run']}  arm={s['arm']}  turns={s['turns']} completed={s['turns_completed']}  rollout={'yes' if s['rollout_found'] else 'no'}")
        rows = [[('y' if t.get(k) else 'n') if k == 'completed' else t.get(k, 0) for k, _ in TURN_COLS] for t in res['per_turn']]
        print(table(rows, [h for _, h in TURN_COLS]))
        if s['coordinator_edit_paths']:
            print('coordinator edits:', '; '.join(s['coordinator_edit_paths']))
        if s['ref_reads_by_file']:
            print('ref reads:', ', '.join(f'{k}x{v}' for k, v in s['ref_reads_by_file'].items()))
        print(f"announce_frac={s['announce_frac']}  skill_reads_full/turn={s['skill_reads_full_per_turn']}  "
              f"seam_t6_8={s['seam_audits_t6_8']} gates_t6_8={s['gates_t6_8']} runner_t6_8={s['runner_launches_t6_8']}")
    print('\n== per arm (mean [per-rep values])')
    rows = []
    for col in ARM_COLS:
        row = [col]
        for arm in sorted(by_arm):
            vals = [s.get(col) for s in by_arm[arm]]
            nums = [v for v in vals if isinstance(v, (int, float))]
            mean = round(sum(nums) / len(nums), 2) if nums else '-'
            row.append(f"{mean} {[v if v is not None else '-' for v in vals]}")
        rows.append(row)
    print(table(rows, ['metric'] + [f'{a} (n={len(by_arm[a])})' for a in sorted(by_arm)]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
