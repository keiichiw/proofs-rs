"""Unrecorded preview: no Git/remote/run/auth state and no service requests."""
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

binary = str(Path(sys.argv[1]).resolve())
requests = []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        requests.append((self.command, self.path))
        self.send_response(500); self.end_headers()
    do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

service = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=service.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{service.server_port}'

def fetch(url, method='GET', headers=None):
    try:
        with urlopen(Request(url, method=method, headers=headers or {}), timeout=15) as r:
            return r.status, r.read().decode()
    except HTTPError as e:
        return e.code, e.read().decode()

def files(root):
    return {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}

with tempfile.TemporaryDirectory(prefix='proofs-draft-') as temp:
    root = Path(temp).resolve()
    work = root / 'project'; (work / 'src').mkdir(parents=True)
    (work / 'Cargo.toml').write_text('[package]\nname="draft_fixture"\nversion="1.0.0"\nedition="2021"\n')
    (work / 'src/lib.rs').write_text('pub fn f() {}\n')
    assert not (work / '.git').exists()
    subprocess.run(['cargo', 'generate-lockfile', '--offline'], cwd=work, check=True, capture_output=True)
    config = work / 'proofs.toml'
    text_only = '[report]\ntitle="Text-only draft"\nexplanation="**Overview**"\n[tool]\nname="kani"\nversion="1"\n'
    config.write_text(text_only)
    profile = work / 'profiles' / 'stage2.toml'; profile.parent.mkdir()
    mapping = '\n[[tool.proofs]]\napi="Crc<u8>::checksum"\nmodule="Proofs.Crc"\ntheorem="Crc.checksum_spec"\nprecondition="width < 9 && coherent"\n'
    profile_text = '[report]\ntitle="Profile draft"\ntrusted_assumptions="Trusted translation"\nlimitations="Explicit limits"\nenvironment="Local environment"\n[[report.findings]]\ntitle="A finding"\nbody="**Finding body**"\napi_paths=["fixture::f"]\n[tool]\nname="aeneas"\nversion="' + 'a'*40 + '"\nlean_dir="does-not-exist"\n' + mapping
    profile.write_text(profile_text)
    credentials = root / 'credentials'; credentials.mkdir()
    key = hashlib.sha256(origin.encode()).hexdigest()
    (credentials / (key + '.json')).write_text('invalid credentials: draft must not read this')
    env = dict(os.environ, PROOFS_CONFIG_DIR=str(credentials), XDG_DATA_HOME=str(root / 'data'))
    data_base = Path.home() / 'Library/Application Support' if sys.platform == 'darwin' else root / 'data'
    state = data_base / 'cargo-proofs' / hashlib.sha256(str(work / 'Cargo.toml').encode()).hexdigest()
    assert not state.exists()
    credentials_before = files(credentials)
    command = [binary, '--server', origin, 'preview', '--manifest-path', str(work / 'Cargo.toml'), '--no-browser']
    procs = []

    def start(*args):
        p = subprocess.Popen([*command, '--draft', *args], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        procs.append(p); q = queue.Queue()
        def read():
            for line in p.stdout: q.put(line)
            q.put(None)
        threading.Thread(target=read, daemon=True).start()
        while True:
            line = q.get(timeout=25)
            if line is None: raise AssertionError(p.stderr.read())
            match = re.search(r'http://127\.0\.0\.1:\d+/report', line)
            if match: return p, match[0]

    def stop(p):
        p.send_signal(signal.SIGINT)
        assert p.wait(timeout=8) == 0, p.stderr.read()

    def failure(*args):
        p = subprocess.run([*command, *args], cwd=root, env=env, capture_output=True, text=True, timeout=25)
        assert p.returncode != 0, p.stdout
        return p.stderr

    try:
        before = files(work)
        p, url = start()
        html = fetch(url)[1]
        assert 'Unverified draft' in html and 'Text-only draft' in html
        assert 'This draft displays report text only.' in html
        assert 'verified claims' not in html and 'Verified APIs' not in html
        assert files(work) == before
        assert requests == [] and not state.exists()
        stop(p)
        # A dirty repository without a commit or remote behaves the same way.
        subprocess.run(['git', 'init', '-q', str(work)], check=True)
        assert 'No recorded run' in failure()
        assert '--run' in failure('--draft', '--run', '11111111-1111-4111-8111-111111111111')
        assert '--report' in failure('--draft', '--report', '1')
        assert '--draft' in failure('--proofs-config', 'profiles/stage2.toml')
        assert 'Read ' in failure('--draft', '--proofs-config', 'missing.toml')
        assert 'within' in failure('--draft', '--proofs-config', '../outside.toml')
        assert 'within' in failure('--draft', '--proofs-config', str(profile))
        p, url = start('--proofs-config', 'profiles/stage2.toml')
        base = url.removesuffix('/report')
        html = fetch(url)[1]
        assert 'Profile draft' in html and 'Configured proof mappings (1)' in html
        assert 'Crc&lt;u8&gt;::checksum' in html and 'Crc.checksum_spec' in html
        assert 'Local environment' in html
        detail = fetch(base + '/claim/draft-mapping-0')[1]
        assert 'Configured proof mapping #1' in detail and 'width &lt; 9 &amp;&amp; coherent' in detail
        assert 'Finding body' in fetch(base + '/finding/draft-1')[1]
        for path in ['/runs/missing', '/api/v1/runs/missing/sarif', '/claim/missing', '/finding/missing', '/missing']:
            assert fetch(base + path)[0] == 404
        assert fetch(url, 'POST')[0] == 405
        assert fetch(url, headers={'Host':'evil.example'})[0] == 403
        assert fetch(url, headers={'Origin':'https://evil.example'})[0] == 403
        profile.write_text(profile_text.replace('Profile draft', 'Edited draft') + mapping.replace('checksum_spec', 'second_spec').replace('checksum"', 'update"'))
        assert 'Edited draft' in fetch(url)[1] and 'Configured proof mappings (2)' in fetch(url)[1]
        assert 'second_spec' in fetch(base + '/claim/draft-mapping-1')[1]
        profile.write_text('not valid toml =')
        status, error = fetch(url)
        assert status == 500 and 'Unverified draft' in error
        profile.write_text(profile_text)
        assert fetch(url)[0] == 200
        outside = root / 'outside.toml'; outside.write_text(profile_text)
        profile.unlink(); profile.symlink_to(outside)
        assert fetch(url)[0] == 500
        profile.unlink(); profile.write_text(profile_text)
        assert fetch(url)[0] == 200
        stop(p)
        assert requests == [], requests
        assert not state.exists()
        assert files(credentials) == credentials_before
        assert subprocess.check_output(['git', '-C', str(work), 'rev-list', '--all'], text=True) == ''
        assert subprocess.check_output(['git', '-C', str(work), 'remote'], text=True) == ''
        print('Draft preview E2E: no record/Git commit/remote/service/auth state; profiles, reload, mappings, findings, HTTP boundaries and errors passed.')
    finally:
        for p in procs:
            if p.poll() is None: p.kill(); p.wait()
        service.shutdown()
