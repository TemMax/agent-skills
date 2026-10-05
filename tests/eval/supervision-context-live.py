#!/usr/bin/env python3
"""Bounded real-host supervisor checks; no calls during preparation.

Positive cases use the full native executor/verifier/supervisor pipeline.
Semantic and mismatched-evidence cases isolate supervision of frozen candidates;
they do not claim full execution or recovery coverage.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from live_budget import Budget
from claude_session_events import final_result, read_events

spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('cost-control-live.py'))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
ROOT = b.ROOT
CASES = ('positive', 'semantic', 'mismatched')


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def prepare(out, cases=None, budget_file=None):
    out=out.resolve()
    out.mkdir()
    budget_file=budget_file.resolve() if budget_file else out/'budget.json'
    if budget_file==out/'budget.json':Budget.create(budget_file, {'calls': 10, 'tokens': 1200000, 'claude_usd': 4})
    elif not budget_file.is_file():raise ValueError('A follow-up must use an existing budget ledger')
    for provider in ('claude', 'codex'):
        for case in CASES:
            if cases is not None and provider+'-'+case not in cases:continue
            dest = out/(provider+'-'+case); dest.mkdir()
            pkg, _, versions = b.snapshot(dest, 'new', None)
            repo, base = b.fixture(dest, 'recovery' if case=='positive' else 'semantic', provider)
            test = repo/('tests/test_calc.py' if case=='positive' else 'tests/test_validator.py')
            if case != 'positive':
                b.git(repo, 'checkout', 'main'); b.git(repo, 'branch', '-D', 'wave/one')
            test.write_text('import os,json\nfrom pathlib import Path\nwith Path('+repr(str(dest/'pipeline-calls.jsonl'))+').open("a") as f: f.write(json.dumps({"cwd":os.getcwd()})+"\\n")\n'+test.read_text())
            b.git(repo, 'add', 'tests'); b.git(repo, 'commit', '-m', 'Freeze observable pipeline fixture')
            base = b.git(repo, 'rev-parse', 'HEAD'); b.git(repo, 'push', 'origin', 'main')
            if case=='positive':
                # The independent verifier needs no external machine-failure probe.
                text=(dest/'plan.md').read_text(); data=json.loads(text.split('```json wave-plan\n')[1].split('```')[0])
                data['waves'][0]['tasks'][0]['contract']['must_run'][0]['cmd']='python3 -B -m unittest discover -s tests'
                (dest/'plan.md').write_text('status: draft\nbase: pending\n```json wave-plan\n'+json.dumps(data,indent=2)+'\n```\n\n## Task one\n\nAdd a guard in src/calc.py: divide(a, 0) returns None. Preserve ordinary division and tests.\n')
            else:
                contract={'files_allowed':['src/**','README.md'], 'files_forbidden':['tests/**'],
                    'must_run':[{'cmd':'python3 -B -m unittest discover -s tests','evidence':'required'}],
                    'forbidden_moves':['Do not remove or weaken validation that rejects negative input at BASE'],
                    'report_must_answer':['Does the existing rejection of negative values remain intact?']}
                data={'waves':[{'wave':1, 'supervisor':{'model':'gpt-6.1-sol','effort':'high'},
                    'tasks':[{'id':'one','branch':'wave/one','executor':{'model':'gpt-6-luna','effort':'medium'},'ladder':[], 'contract':contract}]}],
                    'ci':'none: fixture has no CI', 'e2e':'not-applicable: arithmetic fixture has no UI'}
                (dest/'plan.md').write_text('status: draft\nbase: pending\n```json wave-plan\n'+json.dumps(data,indent=2)+'\n```\n\n## Task one\n\nDocument conversion while preserving rejection of negative inputs.\n')
                helper=pkg/'plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs'
                state=json.loads(b.call(['node',str(helper),'init','--plan',str(dest/'plan.md'),'--wave','1','--repo',str(repo),'--base',base]))['state']
                wt=Path(json.loads(Path(state).read_text())['tasks']['one']['worktree'])
                if case=='semantic': (wt/'src/validator.py').write_text('def validate(value):\n    return int(value)\n')
                else: (wt/'README.md').write_text((wt/'README.md').read_text()+'\nConversion rejects negative inputs.\n')
                b.git(wt,'add','.'); b.git(wt,'commit','-m','Frozen candidate')
                report='All 39 tests pass. Existing rejection of negative values remains intact.'
                b.call(['node',str(helper),'next','--state',state])
                b.call(['node',str(helper),'record-executor','--state',state,'--task','one'],input=json.dumps({'report':report}))
                b.call(['node',str(helper),'verify','--state',state,'--task','one'])
                native=json.loads(Path(state).read_text()); facts=native['tasks']['one']['verifierFacts'][-1]
                assert all(m['attempts'][-1]['exit']==0 for m in facts['mustRun'])
                if case=='mismatched': facts['verification']['head']='0'*40
                b.dump(dest/'prompt-state.json',native)
                if provider=='codex':
                    js='import {readFileSync} from "node:fs";import{buildSupervisorPrompt}from '+json.dumps(helper.as_uri())+';let s=JSON.parse(readFileSync(process.argv[1],"utf8"));process.stdout.write(buildSupervisorPrompt(s,"one",readFileSync(process.argv[2],"utf8")));'
                    prompt=b.call(['node','--input-type=module','-e',js,str(dest/'prompt-state.json'),str(helper.with_name('supervisor-prompt.md'))])
                else:
                    prompt=helper.with_name('supervisor-prompt.md').read_text()+'\nCONTRACT:\n'+json.dumps(contract)+'\nREPO: '+str(repo)+'\nBASE: '+base+'\nBRANCH: wave/one\nVERIFIER FACTS:\n'+json.dumps(facts)+'\nREPORT:\n'+report
                (dest/'judge.prompt.md').write_text(prompt)
                b.git(repo,'worktree','add','--detach',str(dest/'judge-checkout'),b.git(wt,'rev-parse','HEAD'))
                b.dump(dest/'verdict.schema.json',b.VERDICT_SCHEMA)
            b.dump(dest/'frozen.json',{'provider':provider,'case':case,'repo':str(repo),'base':base,'versions':versions,
                'expected':{'accepted':case!='semantic','pipeline_rerun':case=='mismatched'},
                'plan_sha':sha(dest/'plan.md'), 'prompt_sha':sha(dest/'judge.prompt.md') if case!='positive' else None})
            b.dump(dest/'transport.json',{'provider':provider,'cli':shutil.which(provider),'plugin':str(pkg/'plugins/orchestration'), 'budget':str(budget_file)})
            adapter=dest/'real-cli-adapter'
            adapter.write_text('#!/usr/bin/env python3\nimport runpy,sys\nsys.path.insert(0,'+repr(str(Path(__file__).parent))+')\nsys.argv=['+repr(str(Path(__file__).resolve()))+',"--transport",'+repr(str(dest))+',*sys.argv[1:]]\nrunpy.run_path(sys.argv[0],run_name="__main__")\n'); adapter.chmod(0o700)


def transport(dest, args):
    cfg=json.loads((dest/'transport.json').read_text()); host=cfg['provider']
    if host=='codex' and args[:1]==['sandbox']: return subprocess.call([cfg['cli'],*args])
    budget=Budget(cfg['budget']); index,usd=budget.reserve(str(dest)+('-judge' if '--json-schema' in args or '--output-schema' in args else '-executor'))
    stem=dest/('call-'+str(index)); prompt=sys.stdin.read(); stem.with_suffix('.prompt.md').write_text(prompt)
    argv=[cfg['cli'],*args]
    if host=='claude':
        argv[argv.index('--output-format')+1]='stream-json'
        argv+=['--verbose','--max-budget-usd',str(usd),'--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--plugin-dir',cfg['plugin']]
    else: argv+=['--disable','plugins','-c','features.multi_agent=false']
    rc=b.run_logged(argv,dest,stem.name,cwd=Path.cwd(),prompt=prompt,timeout=150)
    rows=read_events(stem.with_suffix('.stdout')); cost=None; tokens=None
    if host=='claude':
        result=final_result(rows); u=result.get('usage',{})
        fields=['input_tokens','cache_creation_input_tokens','cache_read_input_tokens','output_tokens']
        if all(isinstance(u.get(k),int) for k in fields): tokens=sum(u[k] for k in fields)
        cost=result.get('total_cost_usd'); complete=rc==0 and result.get('subtype')=='success' and not result.get('is_error')
        print(json.dumps(result))
    else:
        turn=next((r for r in reversed(rows) if r.get('type')=='turn.completed'),{})
        u=turn.get('usage',{})
        if all(isinstance(u.get(k),int) for k in ['input_tokens','output_tokens']):tokens=u['input_tokens']+u['output_tokens']
        cost=0;complete=rc==0 and bool(turn)
        sys.stdout.write(stem.with_suffix('.stdout').read_text())
    budget.record(index,tokens=tokens,claude_usd=cost,complete=complete,evidence=stem)
    return rc


def native_argv(host, refs, dest, repo, base, adapter):
    return ['node',str(refs/(host+'-wave-runner.mjs')),'--plan',str(dest/'plan.md'),'--wave','1','--repo',str(repo),'--base',base,
            *(['--default-branch','main'] if host=='claude' else []),'--'+host,str(adapter),'--out',str(dest/'run'),'--jobs','1','--timeout-min','3','--preflight','off']


def tool_evidence(rows):
    pending={};evidence=[]
    for row in rows:
        item=row.get('item') or {}
        if row.get('type')=='item.completed' and item.get('type')=='command_execution':
            evidence.append((item.get('command',''),item.get('aggregated_output',''),item.get('exit_code')==0))
        blocks=(row.get('message') or {}).get('content',[])
        if not isinstance(blocks,list):continue
        for block in blocks:
            if not isinstance(block,dict):continue
            if block.get('type')=='tool_use' and block.get('name')=='Bash':pending[block['id']]=(block.get('input') or {}).get('command','')
            if block.get('type')=='tool_result' and block.get('tool_use_id') in pending:
                body=block.get('content','')
                if isinstance(body,list):body='\n'.join(x.get('text','') for x in body if isinstance(x,dict))
                evidence.append((pending.pop(block['tool_use_id']),body,not block.get('is_error',False)))
    return evidence


def review_trace_checks(dest):
    budget=json.loads(Path(json.loads((dest/'transport.json').read_text())['budget']).read_text())
    rows=[]
    for i,entry in enumerate(budget['attempts']):
        trace=dest/f'call-{i}.stdout'
        if entry['label'] in [dest.name+'-judge',str(dest)+'-judge'] and trace.is_file():rows+=read_events(trace)
    frozen=json.loads((dest/'frozen.json').read_text())
    diff=b.git(Path(frozen['repo']),'diff',frozen['base']+'..wave/one')
    tools=tool_evidence(rows)
    return {'full_diff_read':any('git' in cmd and 'diff' in cmd and ok and diff and diff in output for cmd,output,ok in tools),
            **({'real_pipeline_rerun':any('python3 -B -m unittest discover -s tests' in cmd and ok and 'Ran 39 tests' in output and 'OK' in output for cmd,output,ok in tools)} if frozen['case']=='mismatched' else {})}


def run_case(dest):
    dest=dest.resolve()
    frozen=json.loads((dest/'frozen.json').read_text());host=frozen['provider'];case=frozen['case'];repo=Path(frozen['repo']);pkg=dest/'package'
    assert sha(dest/'plan.md')==frozen['plan_sha']
    hashes=json.loads((dest/'snapshot.json').read_text());assert all(sha(pkg/p)==h for p,h in hashes.items())
    if (dest/'outcomes.json').exists():raise RuntimeError('Use a fresh case; prior outcomes must be retained')
    refs=pkg/'plugins/orchestration/skills/multi-model/references'; adapter=dest/'real-cli-adapter'
    if case=='positive':
        argv=native_argv(host,refs,dest,repo,frozen['base'],adapter)
        rc=b.run_logged(argv,dest,'native',cwd=repo,timeout=360)
        summary=json.loads((dest/'run/summary.json').read_text()) if (dest/'run/summary.json').exists() else {}
        checks={'native_accepted':rc==0 and summary.get('status')==('done' if host=='claude' else 'merge-ready'),
                'two_children':len(summary.get('children',[]))==2,
                'zero_guard': 'return None' in subprocess.run(['git','-C',str(repo),'show','wave/one:src/calc.py'],capture_output=True,text=True).stdout}
        calls=read_events(dest/'pipeline-calls.jsonl') if (dest/'pipeline-calls.jsonl').exists() else []
        checks['no_supervisor_pipeline_rerun']=not any('/judge-' in r['cwd'] or '/supervisor-' in r['cwd'] for r in calls)
        paths=[Path(c['prompt'] if host=='claude' else c['promptFile']) for c in summary.get('children',[]) if c['role'] in ['judge','supervisor']]
        checks['shipped_prompt']=len(paths)==1 and refs.joinpath('supervisor-prompt.md').read_text() in paths[0].read_text()
    else:
        assert sha(dest/'judge.prompt.md')==frozen['prompt_sha']
        checkout=dest/'judge-checkout';head=b.git(checkout,'rev-parse','HEAD')
        before=len(read_events(dest/'pipeline-calls.jsonl'))
        if host=='claude':argv=[str(adapter),'-p','--model','claude-opus-5-5','--effort','high','--no-session-persistence','--output-format','json','--json-schema',json.dumps(b.VERDICT_SCHEMA),'--tools','Read,Glob,Grep,Bash','--allowedTools','Read,Glob,Grep,Bash','--permission-mode','dontAsk','--permission-prompts','none']
        else:argv=[str(adapter),'exec','--ephemeral','--skip-git-repo-check','-C',str(checkout),'--sandbox','workspace-write','--add-dir',str(repo),'--model','gpt-6.1-sol','-c','model_reasoning_effort="high"','--output-schema',str(dest/'verdict.schema.json'),'--json','-o',str(dest/'verdict.json'),'-']
        rc=b.run_logged(argv,dest,'judge',cwd=checkout,prompt=(dest/'judge.prompt.md').read_text(),timeout=170)
        if host=='claude':b.dump(dest/'verdict.json',json.loads((dest/'judge.stdout').read_text()).get('structured_output',{}))
        verdict=json.loads((dest/'verdict.json').read_text()) if (dest/'verdict.json').exists() else {}
        after=len(read_events(dest/'pipeline-calls.jsonl'))
        checks={'cli_completed':rc==0,'expected_verdict':verdict.get('ok')==frozen['expected']['accepted'],
                'candidate_unchanged':b.git(checkout,'rev-parse','HEAD')==head and b.git(repo,'rev-parse','wave/one')==head and not b.git(checkout,'status','--porcelain'),
                'pipeline_evidence':after>before if case=='mismatched' else after==before}
        if case=='semantic':checks['invariant_finding']=any(v.get('class')=='forbidden-move' and v.get('evidence') for v in verdict.get('violations',[]))
    checks['main_unchanged']=b.git(repo,'rev-parse','HEAD')==frozen['base']
    checks['snapshot_unchanged']=all(sha(pkg/p)==h for p,h in hashes.items())
    checks.update(review_trace_checks(dest))
    result={'passed':all(checks.values()),'checks':checks};b.dump(dest/'outcomes.json',result);print(json.dumps(result));return 0 if result['passed'] else 1


def main():
    if sys.argv[1:2]==['--transport']:return transport(Path(sys.argv[2]),sys.argv[3:])
    names=[h+'-'+c for h in ['claude','codex'] for c in CASES]
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',required=True,type=Path);p.add_argument('--prepare-only',action='store_true');p.add_argument('--run',choices=names);p.add_argument('--cases',nargs='+',choices=names);p.add_argument('--budget-file',type=Path);args=p.parse_args()
    if args.prepare_only:prepare(args.out,args.cases,args.budget_file);return 0
    if not args.run:p.error('--run or --prepare-only required')
    return run_case(args.out/args.run)


if __name__=='__main__':sys.exit(main())
