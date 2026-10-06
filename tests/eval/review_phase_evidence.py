"""Fail closed on review artifact launches before completed instruction reads.

Native Codex starts/completions and Claude tool-use/results share one timeline.
Instruction body presence after an artifact read cannot retroactively pass it.
"""
from pathlib import Path
import re
import shlex


def _tokens(command):
    try:tokens=shlex.split(command)
    except ValueError:return []
    # Native Codex reports its shell wrapper, not just the inner command.
    if len(tokens)>=3 and Path(tokens[0]).name in ['sh','bash','zsh'] and tokens[1] in ['-c','-lc']:
        return _tokens(tokens[2])
    return tokens


def _body(output):
    if isinstance(output,list):output='\n'.join(b.get('text','') for b in output if isinstance(b,dict) and b.get('type')=='text')
    return re.sub(r'(?m)^\s*\d+\t','',output) if isinstance(output,str) else ''


def review_phase_evidence(rows,repo,entry,profiles):
    repo=Path(repo).resolve();entry=Path(entry).resolve()
    required=[entry,entry.parent/'PROFILE.md',None,entry.parent/'REVIEW.md']
    profiles=[Path(p).resolve() for p in profiles]
    resources=[required[0],required[1],*profiles,required[3]]
    bodies={p:p.read_text().strip() for p in resources}
    artifact_paths=[p.relative_to(repo) for p in repo.rglob('*') if p.is_file()
                    and not any(part in ['.git','.agents','__pycache__','.worktrees'] for part in p.relative_to(repo).parts)
                    and p.name not in ['AGENTS.md','CLAUDE.md']]
    pending={};started={};loaded=[];violations=[];inspections=[]

    def inspection(tool,args):
        if tool=='Read':
            p=Path(args.get('file_path',''));p=(repo/p).resolve() if not p.is_absolute() else p.resolve()
            return p.is_relative_to(repo) and p.name not in ['AGENTS.md','CLAUDE.md']
        if tool in ['Grep','Glob']:
            pattern=args.get('glob') or args.get('pattern','')
            return not bool(re.fullmatch(r'(?:\*\*/)?(?:(?:AGENTS|CLAUDE|\{AGENTS,CLAUDE\}|\{CLAUDE,AGENTS\})\.md|\{AGENTS\.md,CLAUDE\.md\}|\{CLAUDE\.md,AGENTS\.md\})',pattern))
        command=args.get('command','');tokens=_tokens(command)
        if re.search(r'\bgit\b[^;\n]*\b(?:diff|show)\b|\bpr\s+diff\b',command):return True
        # Repository content includes docs and workflows, not only src/tests.
        return any(re.search(r'(?<![\w./-])'+re.escape(str(p))+r'(?![\w./-])',command)
                   or str(repo/p) in command for p in artifact_paths)

    def read_targets(tool,args):
        if tool=='Read':
            raw=Path(args.get('file_path',''));target=(repo/raw).resolve() if not raw.is_absolute() else raw.resolve()
            return [p for p in resources if p==target]
        elif tool=='Bash':
            tokens=_tokens(args.get('command',''))
            targets={(repo/t).resolve() for t in tokens if '/' in t or t.endswith('.md')}
            return [p for p in resources if p in targets and any(t in ['cat','sed','head','tail'] for t in tokens)]
        return []

    def start(key,tool,args,index):
        pending[key]=(tool,args)
        for p in read_targets(tool,args):
            if p in loaded:continue
            expected=required[len(loaded)] if len(loaded)<4 else None
            if not ((len(loaded)==2 and p in profiles) or p==expected):
                violations.append({'event':index,'reason':'instruction launched before preceding read completed','path':str(p)})
        if inspection(tool,args):
            inspections.append(index)
            if len(loaded)!=4:violations.append({'event':index,'reason':'artifact launched before required reads completed'})

    def receipt(key,output,success,index):
        tool,args=pending.get(key,('',{}))
        if not success:return
        candidates=read_targets(tool,args)
        if len(candidates)>1:
            violations.append({'event':index,'reason':'required instruction reads batched together'})
            return
        for p in candidates:
            if bodies[p] not in _body(output):continue
            if p in loaded:continue
            next_path=required[len(loaded)] if len(loaded)<4 else None
            if (len(loaded)==2 and p in profiles) or p==next_path:
                loaded.append(p)
            else:violations.append({'event':index,'reason':'instruction order or selected profile count violated','path':str(p)})

    for i,row in enumerate(rows):
        item=row.get('item') or {};kind=row.get('type')
        if item.get('type')=='command_execution' and kind in ['item.started','item.completed']:
            key=item.get('id') or 'event-'+str(i)
            if key not in started:
                started[key]=(i,len(loaded)==4,bool(item.get('command')))
                start(key,'Bash',{'command':item.get('command','')},i)
            elif kind=='item.completed' and not started[key][2]:
                launch,ready,_=started[key];args={'command':item.get('command','')}
                pending[key]=('Bash',args)
                if inspection('Bash',args):
                    inspections.append(launch)
                    if not ready:violations.append({'event':launch,'reason':'artifact launched before required reads completed'})
            if kind=='item.completed':receipt(key,item.get('aggregated_output',''),item.get('exit_code')==0,i)
        blocks=(row.get('message') or {}).get('content',[])
        if not isinstance(blocks,list):continue
        for block in blocks:
            if not isinstance(block,dict):continue
            if kind=='assistant' and block.get('type')=='tool_use':
                start(block.get('id'),'Read' if block.get('name')=='Read' else block.get('name'),block.get('input') or {},i)
            elif kind=='user' and block.get('type')=='tool_result':
                receipt(block.get('tool_use_id'),block.get('content',''),not block.get('is_error'),i)
            elif kind=='user' and block.get('type')=='text':
                # Claude Skill injects the entrypoint body into a user event.
                prefix='Base directory for this skill: '+str(entry.parent)+'\n'
                text=block.get('text','');body=bodies[entry]
                if body.startswith('---\n'):body=body.split('---',2)[2].strip()
                if text.startswith(prefix) and body in text[len(prefix):] and entry not in loaded:
                    if loaded:violations.append({'event':i,'reason':'entrypoint loaded out of order'})
                    else:loaded.append(entry)
    return {'passed':len(loaded)==4 and bool(inspections) and not violations,
            'loaded_in_order':[str(p) for p in loaded],'artifact_launches':inspections,'violations':violations}
