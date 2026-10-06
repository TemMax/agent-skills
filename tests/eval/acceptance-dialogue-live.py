#!/usr/bin/env python3
"""Remaining bounded acceptance cases; native hosts, disposable loading only.

Reload uses a controlled version/marker change on top of the candidate policy.
Context loss is a fresh native session resuming an explicit project checkpoint,
not a simulated compaction. No installed plugin or marketplace is modified.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid
from claude_session_events import read_events, final_result, usage

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cost_live', Path(__file__).with_name('cost-control-live.py'))
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)


def skill_path(pkg, provider, name):
    plugin = 'code-review' if name == 'critical-review' else 'orchestration'
    return pkg / 'plugins' / plugin / ('skills' if provider == 'claude' else 'skills-codex') / name / 'SKILL.md'


def register(repo, pkg):
    registry = repo / '.agents/skills'; registry.mkdir(parents=True, exist_ok=True)
    for name in ['multi-model', 'super-plan', 'ship', 'critical-review']:
        link = registry / name
        if link.is_symlink(): link.unlink()
        link.symlink_to(skill_path(pkg, 'codex', name).parent, target_is_directory=True)


def observed(rows, expected, marker=None):
    text = expected.read_text()
    body = (text.split('---', 2)[2] if text.startswith('---\n') else text).strip()
    ids = set()
    for row in rows:
        item = row.get('item') or {}
        if row.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            output = item.get('aggregated_output', '')
            if text.strip() in output or (marker and marker in output and 'SKILL.md' in item.get('command', '')):
                return True
        content = (row.get('message') or {}).get('content', [])
        if not isinstance(content, list): continue
        for b in content:
            if not isinstance(b, dict): continue
            if b.get('type') == 'text' and b.get('text', '').startswith('Base directory for this skill: '+str(expected.parent)+'\n'):
                rendered = b['text'].split('\n', 1)[1].strip()
                if rendered == body or (rendered.startswith(body) and re.fullmatch(r'\s+ARGUMENTS: [\s\S]*', rendered[len(body):])): return True
            if b.get('type') == 'tool_use' and b.get('name') == 'Read':
                raw = (b.get('input') or {}).get('file_path', '')
                if raw and Path(raw).resolve() == expected.resolve(): ids.add(b.get('id'))
            if b.get('type') == 'tool_result' and b.get('tool_use_id') in ids and not b.get('is_error'):
                output = b.get('content', '')
                if isinstance(output, str):
                    output = re.sub(r'(?m)^\s*\d+\t', '', output)
                    if text.strip() in output or (marker and marker in output): return True
    return False


def messages(rows):
    """Preserve root text in trace order; message IDs are not unique across turns."""
    parts = []
    for r in rows:
        if r.get('parent_tool_use_id'): continue
        item = r.get('item') or {}
        if r.get('type') == 'item.completed' and item.get('type') == 'agent_message':
            parts.append(item.get('text', ''))
        if r.get('type') == 'assistant':
            msg = r.get('message') or {}
            for b in msg.get('content', []):
                if isinstance(b, dict) and b.get('type') == 'text': parts.append(b.get('text', ''))
    return '\n'.join(parts)


def quiet(text):
    if re.search(r'(?i)(?:загруж|прочита|чита|\bload(?:ed|s|ing)?\b|\bread(?:s|ing)?\b)[^.!?\n]{0,90}(?:методик\w*\s+(?:ревью|проверк)|review\s+(?:methodology|method))', text):
        return False
    return not re.search(r'(?i)(?:загруж|прочита|чита|пропуска|выбира|использу|примен|най(?:ду|ти)|\b(?:load(?:ed|s|ing)?|read(?:s|ing)?|skip(?:s|ped|ping)?|select(?:ed|s|ing)?|us(?:e[ds]?|ing)|find(?:s|ing)?|found|locat(?:e[ds]?|ing))\b)[^.!?\n]{0,90}(?:внутренн|инструкци|профил|скилл|навык|profile|instructions|AGENTS\.md|CLAUDE\.md)|(?:скилл|навык|skill) (?:says|говорит)|PLUGIN_RUNTIME_CONTEXT|active-seat|профил(?:ь|я|ем)\s*(?:[:—]|(?:ревьюера|модели|generic)\b)|\beffort\b|\bgpt-\d|\bclaude-(?:opus|sonnet|haiku|fable)|\b(?:Astra|Fable|Opus|Sonnet|Haiku|Luna|Sol)\b|\b(?:SKILL|PROFILE|REVIEW|PR|FIXES|WORKFLOW)\.md\b|\b(?:orchestration|code-review):(?:multi-model|super-plan|ship|critical-review)\b|\$(?:multi-model|super-plan|ship|critical-review)\b|модель вне таблицы калибровки', text)


def communication_checks(turns):
    """Score each CLI invocation independently, retaining its user-facing text."""
    per_turn = []
    for number, rows in enumerate(turns, 1):
        text = messages(rows)
        per_turn.append({'turn': number, 'messages': text, 'quiet': quiet(text)})
    return {'turns': per_turn, 'quiet': bool(per_turn) and all(t['quiet'] for t in per_turn)}


def instructions_seen(rows, expected, rollouts):
    body = expected.read_text().strip()
    ids = set()
    for row in rows:
        item = row.get('item') or {}
        if row.get('type') == 'item.completed' and item.get('type') == 'command_execution' and item.get('exit_code') == 0:
            if body in item.get('aggregated_output', ''): return True
        for block in (row.get('message') or {}).get('content', []):
            if not isinstance(block, dict): continue
            if block.get('type') == 'tool_use':
                args = block.get('input') or {}
                if block.get('name') == 'Read':
                    path = args.get('file_path')
                    if path and Path(path).resolve() == expected.resolve(): ids.add(block.get('id'))
                if block.get('name') == 'Bash' and expected.name in args.get('command', ''):
                    ids.add(block.get('id'))
            if block.get('type') == 'tool_result' and block.get('tool_use_id') in ids and not block.get('is_error'):
                content = block.get('content', '')
                if isinstance(content, str) and body in re.sub(r'(?m)^\s*\d+\t', '', content): return True
    # Both hosts can supply AGENTS.md in native initial context without a tool read.
    for path in rollouts:
        for row in read_events(path):
            if row.get('type') == 'assistant': break
            attachment = row.get('attachment') or {}
            if row.get('type') == 'attachment' and attachment.get('type') == 'instructions':
                for file in attachment.get('files', []):
                    if file.get('path') and Path(file['path']).is_absolute() and Path(file['path']).resolve() == expected.resolve() and file.get('content', '').strip() == body:
                        return True
            payload = row.get('payload') or {}
            if row.get('type') == 'response_item' and payload.get('type') == 'message' and payload.get('role') == 'user':
                for block in payload.get('content', []):
                    text = block.get('text', '')
                    if text.startswith('# AGENTS.md instructions for '+str(expected.parent)+'\n') and body in text: return True
    return False


def product_files(repo):
    return {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in repo.rglob('*')
            if p.is_file() and not any(x in p.parts for x in ['.git', '.agents', '__pycache__', '.worktrees'])}


class Session:
    def __init__(self, out, repo, provider, budget_usd=3, native_plugins=False):
        self.out, self.repo, self.provider = out, repo, provider
        self.cli = shutil.which(provider)
        self.sid = None; self.spent = 0; self.turns = []; self.budget_usd = budget_usd
        self.turn_rows = []
        self.native_plugins = native_plugins
        if native_plugins:
            home=out/'codex-home'
            if not home.is_dir() or Path(os.environ.get('CODEX_HOME','')).resolve()!=home.resolve():
                raise ValueError('Native candidate plugins require the owned disposable Codex home')

    def invoke(self, k, prompt, pkg, fresh=False):
        if fresh: self.sid = None
        if self.provider == 'claude':
            if self.spent >= self.budget_usd: raise RuntimeError('Dialogue USD cap reached')
            common = [self.cli, '-p', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-5-5', '--effort', 'medium',
                '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', 'Read,Glob,Grep,Bash,Skill',
                '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--add-dir', str(self.out),
                '--plugin-dir', str(pkg / 'plugins/orchestration'), '--plugin-dir', str(pkg / 'plugins/code-review'),
                '--max-budget-usd', str(self.budget_usd-self.spent)]
            if self.sid: cmd = common+['--resume', self.sid]
            else:
                self.sid = str(uuid.uuid4()); cmd = common+['--session-id', self.sid]
        else:
            if not self.native_plugins: register(self.repo, pkg)
            # Only the owned fixture home reaches this branch; candidate hook sources
            # are frozen and checked before launch. No persisted user trust is changed.
            transport = ['--enable', 'plugins', '--dangerously-bypass-hook-trust'] if self.native_plugins else ['--ignore-user-config', '--disable', 'plugins']
            common = [*transport, '--json', '--skip-git-repo-check', '--model', 'gpt-6.1-sol',
                '-c', 'model_reasoning_effort="medium"', '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
            if self.sid: cmd = [self.cli, 'exec', 'resume', *common, '-c', 'sandbox_mode="workspace-write"', self.sid, '-']
            else: cmd = [self.cli, 'exec', *common, '-C', str(self.repo), '--sandbox', 'workspace-write', '--add-dir', str(self.out), '-']
        print(f'{self.provider}: turn {k}', flush=True)
        rc = bench.run_logged(cmd, self.out, f'turn-{k}', cwd=self.repo, prompt=prompt, timeout=150)
        shutil.copyfile(self.out / f'turn-{k}.stdout', self.out / f'turn-{k}.jsonl')
        rows = read_events(self.out / f'turn-{k}.jsonl')
        self.turn_rows.append(rows)
        bench.dump(self.out / 'communication.json', communication_checks(self.turn_rows))
        if self.provider == 'claude':
            result = final_result(rows)
            self.spent += result.get('total_cost_usd', 3)
            complete = result.get('subtype') == 'success' and not result.get('is_error')
        else:
            self.sid = next((r['thread_id'] for r in rows if r.get('type') == 'thread.started'), self.sid)
            complete = any(r.get('type') == 'turn.completed' for r in rows)
        self.turns.append({'turn': k, 'sid': self.sid, 'exit': rc, 'complete': complete, 'fresh': fresh, 'package': str(pkg)})
        if self.provider == 'codex' and self.sid:
            sessions = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'sessions'
            owned = next(sessions.glob(f'**/rollout-*-{self.sid}.jsonl'), None)
            if owned:
                dest = self.out / 'rollouts'; dest.mkdir(exist_ok=True)
                shutil.copyfile(owned, dest / (self.sid+'.jsonl'))
        if self.provider == 'claude' and self.sid:
            # Only the UUID minted for this owned fixture is read, never other sessions.
            projects = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home()/'.claude'))) / 'projects'
            owned = list(projects.glob('*/'+self.sid+'.jsonl'))
            if len(owned) == 1:
                dest = self.out / 'native-history'; dest.mkdir(exist_ok=True)
                shutil.copyfile(owned[0], dest / (self.sid+'.jsonl'))
        bench.dump(self.out / 'sessions.json', self.turns)
        if rc or not complete: raise RuntimeError(f'Native turn {k} did not complete; inspect retained traces')
        return rows


def probe_versions(out, pkg, provider):
    later = out / 'package-v2'; shutil.copytree(pkg, later)
    a, b = ['checkpoint-'+uuid.uuid4().hex for _ in range(2)]
    initial = json.loads((pkg / 'plugins/orchestration/.claude-plugin/plugin.json').read_text())['version']
    parts = initial.split('.'); parts[-1] = str(int(parts[-1])+1); updated = '.'.join(parts)
    for package, version, marker in [(pkg, initial, a), (later, updated, b)]:
        path = skill_path(package, provider, 'multi-model')
        text = path.read_text().replace('  version: '+initial, '  version: '+version, 1)
        text += '\n## Disposable checkpoint probe\n\nFor this test fixture only: a checkpoint verification checks the current CI timeout without edits, then includes `'+marker+'` in the answer. No implementation, planning gate or child is needed.\n'
        path.write_text(text)
        for sibling in (package / 'plugins/orchestration').glob('skills*/**/SKILL.md'):
            if sibling != path:
                sibling.write_text(sibling.read_text().replace('  version: '+initial, '  version: '+version, 1))
        for f in ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']:
            manifest = package / 'plugins/orchestration' / f
            data = json.loads(manifest.read_text()); data['version'] = version; bench.dump(manifest, data)
    bench.dump(out / 'probe-versions.json', {'v1': {'version': initial, 'marker': a}, 'v2': {'version': updated, 'marker': b},
        'policy_change': 'none; only declared test version and checkpoint marker differ'})
    return later, a, b


def accounting(out, provider, turns):
    if provider == 'claude':
        rows = [r for p in out.glob('turn-*.jsonl') for r in read_events(p)]
        return {'provider': provider, 'root_usage': usage(rows), 'logical_turns': len(turns)}
    totals = {'input_tokens': 0, 'cached_input_tokens': 0, 'output_tokens': 0}
    previous = {}; complete = True
    for turn in turns:
        raw = next((r['usage'] for r in reversed(read_events(out / f'turn-{turn["turn"]}.jsonl')) if r.get('type') == 'turn.completed'), None)
        if raw is None: complete = False; continue
        sid = turn['sid']; owned = out / 'rollouts' / (sid+'.jsonl')
        proven = False
        if owned.exists():
            for row in read_events(owned):
                counter = ((row.get('payload') or {}).get('info') or {}).get('total_token_usage') or {}
                if all(counter.get(k) == raw[k] for k in totals): proven = True; break
        if not proven: complete = False; continue
        before = previous.get(sid, dict.fromkeys(totals, 0))
        for k in totals: totals[k] += raw[k]-before[k]
        previous[sid] = raw
    return {'provider': provider, 'root_usage': totals, 'cumulative_rollout_verified': complete,
            'total': totals['input_tokens']+totals['output_tokens'] if complete else None, 'logical_turns': len(turns)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--provider', required=True, choices=['claude', 'codex'])
    p.add_argument('--case', required=True, choices=['decision', 'reload', 'entrypoints'])
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--prepare-only', action='store_true')
    args = p.parse_args(); out = args.out.resolve()
    if out.exists(): p.error('Fresh result directory required; do not overwrite failures')
    if out.is_relative_to(ROOT / 'plugins'): p.error('Results must be outside plugin sources')
    os.umask(0o077); out.mkdir(parents=True)
    pkg, marketplace, versions = bench.snapshot(out, 'new', 'HEAD')
    repo, base = bench.fixture(out, 'navigation', args.provider)
    (repo / 'checkpoint.md').write_text('Approved task: verify current CI timeout with multi-model. Read-only checkpoint verification; no further implementation, planning gate, commit, PR or children.\n')
    bench.git(repo, 'add', 'checkpoint.md'); bench.git(repo, 'commit', '-m', 'Fixture checkpoint')
    if args.case == 'entrypoints':
        (repo / 'README.md').write_text('# Fixture\nSmall arithmetic package.\nCI timeout is fifteen minutes.\n')
    before = product_files(repo); head = bench.git(repo, 'rev-parse', 'HEAD')
    later = a = b = None
    if args.case == 'reload': later, a, b = probe_versions(out, pkg, args.provider)
    snapshots = {str(path.relative_to(out)): hashlib.sha256(path.read_bytes()).hexdigest()
                 for package in [pkg, later] if package for path in package.rglob('*') if path.is_file()}
    bench.dump(out / 'frozen-snapshots.json', snapshots)
    expected = {'case': args.case, 'files_unchanged': True, 'no_commit': True, 'quiet': True,
                'calls_cap': 3 if args.case != 'decision' else 2, 'no_children': True}
    if args.case == 'reload': expected.update(version_b_marker=b, fresh_context_marker=b, fresh_session_required=True)
    if args.case == 'decision': expected.update(new_product_choice_unresolved=True, no_silent_default=True, no_reapproval_of_requested_planning_scope=True)
    if args.case == 'entrypoints': expected.update(loaded=['super-plan', 'ship', 'critical-review'], review_must_find_readme_ci_conflict=True, repository_instructions_loaded=True)
    bench.dump(out / 'expected.json', expected)
    bench.dump(out / 'meta.json', {'provider': args.provider, 'case': 'navigation', 'scenario': args.case, 'arm': 'new',
        'base': base, 'versions': versions, 'loading': 'disposable --plugin-dir' if args.provider == 'claude' else 'native workspace skills, plugins disabled',
        'cli_version': bench.call([shutil.which(args.provider), '--version'])})
    if args.prepare_only: return 0
    session = Session(out, repo, args.provider); checks = {}; all_rows = []; turn_rows = []
    skill = lambda name: 'orchestration:'+name if args.provider == 'claude' and name != 'critical-review' else 'code-review:critical-review' if args.provider == 'claude' else '$'+name
    try:
        if args.case == 'decision':
            rows = session.invoke(1, f'Используй {skill("multi-model")}. В рамках уже согласованной задачи только прочитай README.md и CI, назови timeout-minutes. Ничего не меняй.', pkg); all_rows += rows; turn_rows.append(rows)
            checks['multi_model_loaded'] = observed(rows, skill_path(pkg, args.provider, 'multi-model'))
            rows = session.invoke(2, f'Теперь используй {skill("super-plan")} для следующего изменения API. Новое требование: у /divide при нулевом знаменателе команда интеграций требует HTTP 422 с ошибкой, а мобильная команда требует HTTP 200 с JSON null. Приоритет между ними ещё не выбран. Нужно спланировать это изменение; текущий согласованный CI scope такого решения не содержит. Пока файлы не меняй.', pkg); all_rows += rows; turn_rows.append(rows)
            text = messages(rows)
            checks['super_plan_loaded'] = observed(rows, skill_path(pkg, args.provider, 'super-plan'))
            checks['new_product_choice_not_silently_decided'] = '422' in text and '200' in text and bool(re.search(r'(?i)\?|would ask|не\s+(?:выбран|решён)|уточн|выбор|приоритет|какой|какое|решение.*нуж', text))
            checks['no_reapproval_of_requested_planning_scope'] = not re.search(r'(?i)(?:подтвердите|разрешите)[^\n]{0,100}(?:план может|планирование|новый scope)', text)
        elif args.case == 'reload':
            rows = session.invoke(1, f'Используй {skill("multi-model")} и выполни checkpoint verification из скилла для текущего CI. Проверка уже согласована; файлы не меняй.', pkg); all_rows += rows; turn_rows.append(rows)
            checks['version_a_loaded_and_used'] = observed(rows, skill_path(pkg, args.provider, 'multi-model'), a) and a in messages(rows)
            rows = session.invoke(2, f'Скилл {skill("multi-model")} действительно обновлён с 4.8.0 до 4.8.1; текущий источник: {skill_path(later, args.provider, "multi-model")}. Продолжи ту же checkpoint verification по обновлённым инструкциям. Объём прежний, файлов не меняй.', later); all_rows += rows; turn_rows.append(rows)
            checks['changed_version_reloaded'] = observed(rows, skill_path(later, args.provider, 'multi-model'), b) and b in messages(rows) and a not in messages(rows)
            previous_sid = session.sid
            rows = session.invoke(3, f'Продолжи согласованную проверку по checkpoint.md со скиллом {skill("multi-model")}. Выполни только checkpoint verification; правок и новой реализации не нужно.', later, fresh=True); all_rows += rows; turn_rows.append(rows)
            checks['actual_fresh_context'] = session.sid != previous_sid
            checks['instructions_recovered_in_fresh_context'] = observed(rows, skill_path(later, args.provider, 'multi-model'), b) and b in messages(rows)
        else:
            prompts = [f'Используй {skill("super-plan")} в рамках уже согласованного родительского процесса. Тебе назначена только фаза исследования для правки документации CI: прочитай README и workflow, перечисли проверяемые факты. Архитектура, роли и границы задачи уже согласованы; план не пиши, файлов не меняй, агентов не запускай.',
                f'Продолжи тот же родительский процесс со скиллом {skill("ship")}. Сейчас назначена только фаза проверки: выполни unit tests и git diff --check, сообщи фактический результат. Другие фазы не запускай, файлов не меняй, ничего не коммить и не публикуй.',
                f'Используй {skill("critical-review")} для критического ревью только текущего uncommitted diff README.md. Сопоставь утверждения с .github/workflows/ci.yml. Дай подтверждённые замечания с расположением и последствиями. Это локальное read-only ревью, без исправлений, публикации и дополнительных агентов.']
            for k, (name, prompt) in enumerate(zip(['super-plan', 'ship', 'critical-review'], prompts), 1):
                rows = session.invoke(k, prompt, pkg); all_rows += rows; turn_rows.append(rows)
                checks[name+'_loaded'] = observed(rows, skill_path(pkg, args.provider, name))
                text = messages(rows)
                if k == 2: checks['assigned_checks_reported'] = bool(re.search(r'(?i)тест|test', text)) and bool(re.search(r'(?i)diff|пробел|формат', text))
                if k == 3: checks['review_detected_readme_ci_conflict'] = bool(re.search(r'README', text)) and ('10' in text or 'десят' in text) and ('15' in text or 'пятнадц' in text)
        communication = communication_checks(turn_rows)
        bench.dump(out / 'communication.json', communication)
        all_text = '\n'.join(t['messages'] for t in communication['turns'])
        checks.update(all_turns_completed=all(t['complete'] and t['exit'] == 0 for t in session.turns),
                      files_unchanged=product_files(repo) == before, no_commit=bench.git(repo, 'rev-parse', 'HEAD') == head,
                      quiet=communication['quiet'],
                      frozen_candidate_unchanged=all(hashlib.sha256((out / name).read_bytes()).hexdigest() == digest for name, digest in snapshots.items()))
        if args.case == 'entrypoints':
            checks['no_followup_edit_offer'] = not re.search(r'(?im)(?:исправить|поправить|обновить|хотите|нужно ли|сделать).*\?', all_text)
            checks['repository_instructions_loaded'] = instructions_seen(all_rows, repo / 'AGENTS.md', (out / 'rollouts').glob('*.jsonl'))
        checks['no_false_missing_profile'] = not re.search(r'(?i)(?:orchestrator[\w.-]*|codex-routing\.md)[^\n]{0,200}(?:не найден|отсутств)|(?:отсутств|не найден)[^\n]{0,200}(?:orchestrator[\w.-]*|codex-routing\.md)', all_text)
        # Record no-child evidence from the actual native event streams.
        checks['no_children'] = not any((r.get('item') or {}).get('type') == 'collab_tool_call' for r in all_rows)
        checks['no_children'] &= not any(isinstance(b, dict) and b.get('name') in ['Agent', 'Task', 'Workflow'] for r in all_rows for b in ((r.get('message') or {}).get('content', []) if isinstance((r.get('message') or {}).get('content'), list) else []))
        checks['no_children'] &= not any(r.get('type') == 'response_item' and (r.get('payload') or {}).get('name') == 'spawn_agent' for p in (out / 'rollouts').glob('*.jsonl') for r in read_events(p))
        result = {'passed': all(checks.values()), 'checks': checks, 'sessions': session.turns}
    except Exception as e:
        result = {'passed': False, 'checks': checks, 'error': str(e), 'sessions': session.turns}
    bench.dump(out / 'outcomes.json', result)
    bench.dump(out / 'cost-accounting.json', accounting(out, args.provider, session.turns))
    print(json.dumps(result, ensure_ascii=False)); print('Evidence: '+str(out))
    return 0 if result['passed'] else 1


if __name__ == '__main__': sys.exit(main())
