#!/usr/bin/env python3
"""Select explicit Windows milestones or bounded recovery builds without evaluating commit text."""
import json
import os
import pathlib
import re
import subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEV_REF='refs/heads/dev/initial-prototype'

def decide(count,sha,event,ref,message):
    if not isinstance(count,int) or isinstance(count,bool) or count<1 or not re.fullmatch(r'[0-9a-f]{40}',sha):raise ValueError('Invalid complete-history count or source SHA')
    result={'build':False,'count':count,'sha':sha,'recovery_for':0,'label':f'commit-{count}','kind':'skipped'}
    if ref!=DEV_REF or event not in ('push','workflow_dispatch'):return result
    markers=[line.strip() for line in message.splitlines() if line.strip().startswith('Windows-Recovery-For')]
    if len(markers)>1:raise ValueError('Exactly one Windows recovery trailer is permitted')
    recovery=None
    if markers:
        match=re.fullmatch(r'Windows-Recovery-For: ([1-9][0-9]*)',markers[0])
        if not match:raise ValueError('Recovery trailer must be Windows-Recovery-For: followed by one positive decimal integer')
        recovery=int(match.group(1))
        if recovery%50 or not recovery<count<recovery+50:raise ValueError('Recovery must name the preceding 50-commit milestone within the current interval')
    if event=='push' and recovery is not None:
        result.update(build=True,recovery_for=recovery,label=f'commit-{count}-recovery-for-{recovery}',kind='recovery')
    elif count%50==0:result.update(build=True,kind='milestone')
    elif event=='workflow_dispatch':result.update(build=True,kind='manual_preview')
    return result

def main():
    def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
    result=decide(int(git('rev-list','--count','HEAD')),git('rev-parse','HEAD'),os.environ.get('GITHUB_EVENT_NAME',''),os.environ.get('GITHUB_REF',''),git('log','-1','--format=%B'))
    output=os.environ.get('GITHUB_OUTPUT')
    if not output:raise ValueError('GITHUB_OUTPUT is required; this command is a workflow gate')
    with open(output,'a',encoding='utf-8') as destination:
        for key,value in result.items():destination.write(f'{key}={str(value).lower() if isinstance(value,bool) else value}\n')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
