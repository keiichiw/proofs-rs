"""Real Lean, fresh patched Aeneas build; official source/dependency fixtures may be local.
Usage: aeneas_patch_e2e.py BINARY OUTPUT_DIR AENEAS_GIT PACKAGE_CACHE
No prebuilt Aeneas artifacts are copied. Other pinned dependency caches are reused.
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path
binary, root, upstream, cache = map(lambda p: Path(p).resolve(), sys.argv[1:])
root.mkdir(parents=True, exist_ok=True)
work = root/'project'; work.mkdir(exist_ok=True)
real_git, real_lake = shutil.which('git'), shutil.which('lake')
base = 'be86ab0f1989d04944292b345b24c435be3ad10a'
def run(*args, cwd=work, **kw):
    return subprocess.run(list(map(str,args)),cwd=cwd,check=True,text=True,**kw)
(work/'src').mkdir(exist_ok=True); (work/'src/lib.rs').write_text('pub fn identity(x: u32) -> u32 { x }\n')
(work/'Cargo.toml').write_text('[package]\nname="patch-fixture"\nversion="0.1.0"\nedition="2021"\n')
(work/'.gitignore').write_text('/target/\n/.lake/\n/.proofs-toolchain/\n')
(work/'lean-toolchain').write_text('leanprover/lean4:v4.35.0\n')
(work/'proofs.toml').write_text(f'''[report]
title="Patched real Lean fixture"
[tool]
name="aeneas"
version="{base}"
patch="aeneas.patch"
[[tool.proofs]]
api="identity"
module="Proofs"
theorem="requires_patch"
precondition="true"
''')
(work/'Proofs.lean').write_text('import Aeneas\ntheorem requires_patch : True := ProofsPatch.required\n')
# Generate a binary-capable cumulative patch from a temporary committed modification.
patchrepo = root/'patch-source'
if not patchrepo.exists(): run(real_git,'clone','--shared','--no-checkout',upstream,patchrepo)
run(real_git,'reset','--hard',base,cwd=patchrepo)
run(real_git,'checkout','--detach',base,cwd=patchrepo)
source = patchrepo/'backends/lean/Aeneas.lean'
source.write_text(source.read_text()+'\npublic section\nnamespace ProofsPatch\ntheorem required : True := True.intro\nend ProofsPatch\n')
patch = run(real_git,'diff','--binary','--full-index','--no-ext-diff','--no-textconv',base,'--',cwd=patchrepo,capture_output=True).stdout
(work/'aeneas.patch').write_text(patch)
run('cargo','generate-lockfile')
for args in [('init','-q'),('config','user.name','Test'),('config','user.email','test@example.test'),('init','--bare','-q',root/'remote.git'),('config','remote.origin.url',root/'remote.git'),('config','remote.origin.fetch','+refs/heads/*:refs/remotes/origin/*')]: run(real_git,*args)
wrapper = root/'bin'; wrapper.mkdir(exist_ok=True)
(wrapper/'git').write_text('#!/bin/sh\nif [ "$PWD" = "$TEST_GIT_PROJECT" ] && [ "$1" = remote ] && [ "$2" = get-url ]; then\n echo https://github.com/fixture/source\nelse\n exec "$TEST_REAL_GIT" "$@"\nfi\n')
# Only external dependencies get a cache. Aeneas itself is restored and compiled afresh.
(wrapper/'lake').write_text('#!/bin/sh\nif [ ! -d .lake/packages ]; then\n mkdir -p .lake/packages\n for p in "$TEST_LAKE_PACKAGES"/*; do\n  [ "$(basename "$p")" = aeneas ] || ln -s "$p" .lake/packages/\n done\nfi\nexec "$TEST_REAL_LAKE" "$@"\n')
for p in wrapper.iterdir(): p.chmod(0o755)
env = dict(os.environ, PATH=str(wrapper)+os.pathsep+os.environ['PATH'], TEST_REAL_GIT=real_git,TEST_GIT_PROJECT=str(work),TEST_REAL_LAKE=real_lake,TEST_LAKE_PACKAGES=str(cache),GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0=f'url.{upstream}.insteadOf',GIT_CONFIG_VALUE_0='https://github.com/AeneasVerif/aeneas')
run(binary,'prepare',env=env)
# prepare succeeds even before Lake's dependency configuration exists.
(work/'lakefile.toml').write_text('name="patch-fixture"\n[[lean_lib]]\nname="Proofs"\n[[require]]\nname="aeneas"\npath=".proofs-toolchain/aeneas/backends/lean"\n')
run(wrapper/'lake','update',env=env)
run(wrapper/'lake','--no-cache','build','+Proofs',env=env)
# Unpatched source does not provide the required theorem (use real Lean on a standalone import).
probe = root/'negative.lean'; probe.write_text('import Aeneas\n#check ProofsPatch.required\n')
prefix = run(wrapper/'lake', 'env', 'lean', '--print-prefix', env=env, capture_output=True).stdout.strip()
negative_paths = [str(p/'.lake/build/lib/lean') for p in cache.iterdir() if p.name != 'aeneas'] + [str(upstream/'backends/lean/.lake/build/lib/lean')]
negative = subprocess.run([str(Path(prefix)/'bin/lean'),str(probe)],cwd=work,env=dict(env,LEAN_PATH=os.pathsep.join(negative_paths)),capture_output=True,text=True)
assert negative.returncode != 0 and 'ProofsPatch.required' in negative.stdout, negative.stdout+negative.stderr
for args in [('add','.'),('commit','-qm','Patched Lean fixture'),('push','-q','origin','HEAD:refs/heads/main')]: run(real_git,*args)
result = subprocess.run([str(binary),'run','--','lake','build'],cwd=work,env=env,capture_output=True,text=True)
(root/'run.log').write_text(result.stdout+'\n'+result.stderr)
assert result.returncode == 0, result.stdout+'\n'+result.stderr
match = re.search(r'Saved run ([^:]+): (.+)',result.stdout); assert match
sarif = Path(match[2])/'run.sarif.json'; shutil.copyfile(sarif,root/'run.sarif.json')
record = json.loads(sarif.read_text()); p = record['runs'][0]['properties']['proofs']
assert p['toolchain']['components']['aeneas']['source']['kind']=='git_patch'
assert p['contracts'][0]['formal']['axioms']==[]
# No managed source is needed for load/reuse; preview startup validates without Lake/fetch.
shutil.rmtree(work/'.proofs-toolchain')
blocked = root/'blocked'; blocked.mkdir(exist_ok=True)
for name in ('lake','git'):
    (blocked/name).write_text('#!/bin/sh\n'+ ('exec "$TEST_REAL_GIT" "$@"\n' if name=='git' else 'echo unexpected-lake >&2; exit 99\n'))
    (blocked/name).chmod(0o755)
preview = subprocess.Popen([str(binary),'--server','http://127.0.0.1:1','preview','--no-browser'],cwd=work,env=dict(env,PATH=str(blocked)+os.pathsep+env['PATH']),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
import time, urllib.request
try:
    import select
    deadline=time.monotonic()+30; output=''
    while time.monotonic()<deadline:
        ready,_,_=select.select([preview.stdout],[],[],1)
        if ready:
            output += os.read(preview.stdout.fileno(), 65536).decode()
            url=re.search(r'http://127\.0\.0\.1:\d+',output)
            if url:
                html=urllib.request.urlopen(url.group()).read().decode()
                assert '+ patch ' in html and 'cargo proofs prepare' in html
                break
        assert preview.poll() is None, preview.stderr.read()
    else: raise AssertionError('preview did not start: '+output)
finally:
    preview.terminate(); preview.wait(timeout=10)
(root/'record.json').write_text(json.dumps({'binary':str(binary),'project':str(work),'sarif':str(root/'run.sarif.json')}))
print(root/'record.json')
