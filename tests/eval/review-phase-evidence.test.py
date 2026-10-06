#!/usr/bin/env python3
"""Ordered native trace evidence: launches, completed bodies and artifact reads."""
import tempfile
from pathlib import Path
import unittest
from review_phase_evidence import review_phase_evidence

class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.repo=self.root/'repo';self.repo.mkdir()
        (self.repo/'README.md').write_text('CI timeout fifteen minutes.\n')
        self.skill=self.root/'skill';self.skill.mkdir()
        self.paths=[self.skill/n for n in ['SKILL.md','PROFILE.md','reviewer-generic.md','REVIEW.md']]
        for p in self.paths:p.write_text('Required '+p.name+' body.\n')
    def command(self,cmd,output='',exit=0,id=None):
        if id is None:
            self.counter=getattr(self,'counter',0)+1;id='tool-'+str(self.counter)
        return {'type':'item.completed','item':{'id':id,'type':'command_execution','command':cmd,'aggregated_output':output,'exit_code':exit}}
    def loaded(self):
        return [self.command('cat '+str(p),p.read_text(),id=p.name) for p in self.paths]
    def score(self,rows):return review_phase_evidence(rows,self.repo,self.paths[0],[self.paths[2]])['passed']
    def test_sequential_completed_guards_before_readme(self):
        self.assertTrue(self.score(self.loaded()+[self.command('nl -ba README.md')]))
    def test_readme_or_diff_before_guards_fails(self):
        for cmd in ['nl -ba README.md','cat README.md','git diff -- README.md','python3 -c "open(\'README.md\').read()"']:
            with self.subTest(cmd=cmd):self.assertFalse(self.score([self.command(cmd)]+self.loaded()))
    def test_parallel_start_before_guard_completion_fails(self):
        started={'type':'item.started','item':{'id':'artifact','type':'command_execution','command':'git diff -- README.md'}}
        self.assertFalse(self.score([started]+self.loaded()+[self.command('git diff -- README.md',id='artifact')]))
        started['item'].pop('command')
        self.assertFalse(self.score([started]+self.loaded()+[self.command('git diff -- README.md',id='artifact')]))
    def test_required_instruction_batch_is_not_sequential(self):
        batch=self.command('cat '+' '.join(str(p) for p in self.paths),''.join(p.read_text() for p in self.paths))
        self.assertFalse(self.score([batch,self.command('git diff')]))
    def test_parallel_instruction_launches_fail_even_if_results_arrive_in_order(self):
        starts=[{'type':'item.started','item':{'id':p.name,'type':'command_execution','command':'cat '+str(p)}} for p in self.paths]
        self.assertFalse(self.score(starts+self.loaded()+[self.command('git diff')]))
    def test_nonzero_or_partial_read_cannot_prove_guard(self):
        for output,code in [('Required',0),(self.paths[1].read_text(),1)]:
            rows=self.loaded();rows[1]=self.command('cat '+str(self.paths[1]),output,code,id='PROFILE.md')
            self.assertFalse(self.score(rows+[self.command('git diff')]))
    def test_wrong_guard_order_and_multiple_profiles_fail(self):
        rows=self.loaded();rows[1],rows[2]=rows[2],rows[1]
        self.assertFalse(self.score(rows+[self.command('git diff')]))
        extra=self.skill/'reviewer-other.md';extra.write_text('Another guard.\n')
        report=review_phase_evidence(self.loaded()+[self.command('cat '+str(extra),extra.read_text()),self.command('git diff')],self.repo,self.paths[0],[self.paths[2],extra])
        self.assertFalse(report['passed'])
    def test_same_command_guard_and_artifact_fails(self):
        rows=self.loaded()[:-1]+[self.command('cat '+str(self.paths[-1])+' README.md',self.paths[-1].read_text())]
        self.assertFalse(self.score(rows))
    def test_instruction_discovery_and_git_status_are_allowed(self):
        rows=[self.command('git status --short'),self.command("rg --files -g AGENTS.md -g CLAUDE.md"),self.command('cat AGENTS.md')]+self.loaded()+[self.command('git diff')]
        self.assertTrue(self.score(rows))
        glob={'type':'assistant','message':{'content':[{'type':'tool_use','id':'glob','name':'Glob','input':{'pattern':'**/{AGENTS,CLAUDE}.md'}}]}}
        self.assertTrue(self.score([glob]+self.loaded()+[self.command('git diff')]))
        glob['message']['content'][0]['input']['pattern']='**/*.py'
        self.assertFalse(self.score([glob]+self.loaded()+[self.command('git diff')]))
    def test_claude_tool_batch_launch_before_results_fails(self):
        calls=[];results=[]
        for p in self.paths:
            calls.append({'type':'tool_use','id':p.name,'name':'Read','input':{'file_path':str(p)}})
            results.append({'type':'tool_result','tool_use_id':p.name,'content':p.read_text()})
        calls.append({'type':'tool_use','id':'code','name':'Read','input':{'file_path':str(self.repo/'README.md')}})
        self.assertFalse(self.score([{'type':'assistant','message':{'content':calls}},{'type':'user','message':{'content':results}}]))
    def test_claude_completed_sequential_reads_pass_and_failed_results_fail(self):
        rows=[]
        for p in self.paths:
            rows += [{'type':'assistant','message':{'content':[{'type':'tool_use','id':p.name,'name':'Read','input':{'file_path':str(p)}}]}},{'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':p.name,'content':p.read_text()}]}}]
        read={'type':'assistant','message':{'content':[{'type':'tool_use','id':'code','name':'Read','input':{'file_path':str(self.repo/'README.md')}}]}}
        self.assertTrue(self.score(rows+[read]));rows[3]['message']['content'][0]['is_error']=True
        self.assertFalse(self.score(rows+[read]))
    def test_narration_cannot_prove_loaded_body(self):
        rows=[{'type':'item.completed','item':{'type':'agent_message','text':'All guards loaded. '+''.join(p.read_text() for p in self.paths)}}]
        self.assertFalse(self.score(rows+[self.command('git diff')]))

if __name__=='__main__':unittest.main()
