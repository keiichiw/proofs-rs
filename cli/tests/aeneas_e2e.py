"""Record the real generated Aeneas fixture using only a local Git remote.

Usage: aeneas_e2e.py BINARY OUTPUT_DIRECTORY
Then set PROOFS_REAL_AENEAS_RECORD=OUTPUT_DIRECTORY/record.json for npm test.
The lake wrapper only reuses pinned dependency caches; Lean/build/audit are real.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

binary = str(Path(sys.argv[1]).resolve())
root = Path(sys.argv[2]).resolve()
root.mkdir(parents=True, exist_ok=True)
work = root / 'project'
shutil.copytree(Path(__file__).parent / 'fixtures/aeneas-formal', work)
(work / '.gitignore').write_text('/.lake/\n/target/\n')
real_git = shutil.which('git')
real_lake = shutil.which('lake')
def run(*args, **kw):
    return subprocess.run(args, cwd=work, check=True, text=True, **kw)
run('cargo', 'generate-lockfile')
cache = os.environ.get('PROOFS_TEST_AENEAS_CACHE')
if cache:
    (work / '.lake').mkdir()
    (work / '.lake/packages').symlink_to(Path(cache).resolve() / '.lake/packages')
else:
    run(real_lake, 'update')
    run(real_lake, 'exe', 'cache', 'get')
for args in [('init','-q'), ('config','user.name','Test'), ('config','user.email','test@example.test'),
             ('init','--bare','-q',str(root/'remote.git')), ('remote','add','origin',str(root/'remote.git')),
             ('add','.'), ('commit','-qm','Real Aeneas fixture'), ('push','-q','origin','HEAD:refs/heads/main')]:
    run(real_git, *args)
wrapper = root / 'bin'
wrapper.mkdir()
(wrapper/'git').write_text('#!/bin/sh\nif [ "$PWD" = "$TEST_GIT_PROJECT" ] && [ "$1" = remote ] && [ "$2" = get-url ]; then\n echo https://github.com/fixture/source\nelse\n exec "$TEST_REAL_GIT" "$@"\nfi\n')
(wrapper/'lake').write_text('#!/bin/sh\nif [ "$1" = build ] && [ ! -e .lake/packages ]; then\n mkdir -p .lake\n ln -s "$TEST_LAKE_PACKAGES" .lake/packages\nfi\nexec "$TEST_REAL_LAKE" "$@"\n')
for p in wrapper.iterdir(): p.chmod(0o755)
env = dict(os.environ, PATH=str(wrapper)+os.pathsep+os.environ['PATH'], TEST_REAL_GIT=real_git,
           TEST_GIT_PROJECT=str(work), TEST_REAL_LAKE=real_lake, TEST_LAKE_PACKAGES=str((work/'.lake/packages').resolve()))
result = subprocess.run([binary,'run','--','lake','build'],cwd=work,env=env,capture_output=True,text=True)
(root/'run.log').write_text(result.stdout+'\n'+result.stderr)
assert result.returncode == 0, result.stdout+'\n'+result.stderr
match = re.search(r'Saved run ([^:]+): (.+)',result.stdout)
assert match, result.stdout
sarif = Path(match[2])/'run.sarif.json'
shutil.copyfile(sarif,root/'run.sarif.json')
(root/'record.json').write_text(json.dumps({'binary':binary,'project':str(work),'sarif':str(root/'run.sarif.json')}))
print(root/'record.json')
