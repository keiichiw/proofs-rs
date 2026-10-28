"""Verify stale successful outputs cannot turn a failing committed proof into a Run.
Run after aeneas_patch_e2e.py: aeneas_patch_failure.py OUTPUT_DIR AENEAS_GIT PACKAGE_CACHE
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

def check(root, upstream, cache):
    record_path = root/'record.json'
    record = json.loads(record_path.read_text())
    work = Path(record['project'])
    binary = record['binary']
    success_bytes = Path(record['sarif']).read_bytes()
    success = json.loads(success_bytes)
    success_id = success['runs'][0]['automationDetails']['guid']
    real_git = shutil.which('git')
    def git(*args):
        return subprocess.run([real_git, *args],cwd=work,check=True,capture_output=True,text=True).stdout.strip()
    original = git('rev-parse','HEAD')
    assert (work/'.lake/build/lib/lean/Proofs.olean').exists(), 'keep the old success artifact'
    env = dict(os.environ,PATH=str(root/'bin')+os.pathsep+os.environ['PATH'],TEST_REAL_GIT=real_git,TEST_GIT_PROJECT=str(work),TEST_REAL_LAKE=shutil.which('lake'),TEST_LAKE_PACKAGES=str(cache),GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0=f'url.{upstream}.insteadOf',GIT_CONFIG_VALUE_0='https://github.com/AeneasVerif/aeneas')
    try:
        (work/'Proofs.lean').write_text('theorem requires_patch : False := by trivial\n')
        git('add','Proofs.lean'); git('commit','-qm','Deliberately failing proof'); git('push','-q','origin','HEAD:refs/heads/main')
        result = subprocess.run([binary,'run','--','lake','build'],cwd=work,env=env,capture_output=True,text=True)
        (root/'failed-proof.log').write_text(result.stdout+'\n'+result.stderr)
        assert result.returncode != 0, result.stdout+result.stderr
        match = re.search(r'Saved run ([^:]+): (.+)',result.stdout)
        assert match, result.stdout+result.stderr
        failed = json.loads((Path(match[2])/'run.sarif.json').read_text())['runs'][0]
        assert not failed['invocations'][0]['executionSuccessful']
        assert not failed['properties']['proofs']['contracts']
        assert (work/'.lake/build/lib/lean/Proofs.olean').exists()
        assert Path(record['sarif']).read_bytes() == success_bytes
    finally:
        git('reset','--hard',original)
    # A failed attempt becomes latest. Consumers explicitly select the immutable success.
    record['run_id'] = success_id
    record_path.write_text(json.dumps(record))
    print('Failed proof rejected despite existing success artifacts; old Run unchanged.')

if __name__ == '__main__':
    check(*map(lambda p:Path(p).resolve(),sys.argv[1:]))
