"""Prepare one pinned Aeneas dependency tree for all Lean audit CI consumers."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def cached_imports(source):
    # Lean block comments can nest; ignore documentation examples as well as
    # line comments, so an example `import Mathlib` cannot fetch all Mathlib.
    depth = 0
    code = []
    for token in re.findall(r'/\-|\-/|--[^\n]*|[^/\-]+|[/\-]', source):
        if token == '/-':
            depth += 1
        elif token == '-/' and depth:
            depth -= 1
        elif not depth and not token.startswith('--'):
            code.append(token)
    imports = set()
    for line in ''.join(code).splitlines():
        match = re.match(r'^\s*(?:(?:public|private|meta)\s+)*import\s+(.+)$', line)
        if match:
            for module in match[1].split():
                if module.split('.')[0] in {'Mathlib', 'Batteries', 'Aesop', 'Qq', 'Cli',
                                           'ImportGraph', 'LeanSearchClient', 'Plausible', 'ProofWidgets'}:
                    imports.add(module)
    return imports


def prepare(destination):
    fixture = Path(__file__).resolve().parents[1] / 'cli/tests/fixtures/aeneas-formal'
    shutil.copytree(fixture, destination)
    # lake update otherwise downloads all Mathlib via its post-update hook.
    env = dict(os.environ, MATHLIB_NO_CACHE_ON_UPDATE='1')

    def lake(*args):
        subprocess.run(['lake', *args], cwd=destination, env=env, check=True)

    lake('update')
    manifest = json.loads((destination / 'lake-manifest.json').read_text())
    aeneas = next(package for package in manifest['packages'] if package['name'] == 'aeneas')
    backend = destination / manifest['packagesDir'] / 'aeneas' / aeneas['subDir']
    modules = set()
    for path in backend.rglob('*.lean'):
        if '.lake' not in path.relative_to(backend).parts:
            modules.update(cached_imports(path.read_text()))
    if not modules:
        raise RuntimeError(f'No cached dependency imports found under {backend}')
    # Explicit roots fetch only their transitive dependencies, not all Mathlib.
    lake('exe', 'cache', 'get', *sorted(modules))
    lake('build', '+Proofs')


if __name__ == '__main__':
    prepare(Path(sys.argv[1]).resolve())
