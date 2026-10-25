import { test } from "node:test";
import { execFileSync } from "node:child_process";

// Exercise the preparation protocol without downloading gigabytes of dependencies.
test("Lean audit prepares one shared tree and fetches only explicit cache roots", () => {
  execFileSync(
    "python3",
    [
      "-B",
      "-c",
      String.raw`
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', 'scripts/prepare-lean-audit.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
assert prepare.cached_imports('''
/- import Mathlib
   /- nested -/
-/
public import Mathlib.Data.Nat.Basic Batteries.Data.List.Basic -- import Mathlib
public meta import Mathlib.Data.Int.Basic
private import Aesop
import Aeneas Std
''') == {'Mathlib.Data.Nat.Basic', 'Batteries.Data.List.Basic', 'Mathlib.Data.Int.Basic', 'Aesop'}

with tempfile.TemporaryDirectory() as directory:
    destination = Path(directory) / 'shared'
    calls = []
    def run(command, *, cwd, env, check):
        assert cwd == destination and check
        assert env['MATHLIB_NO_CACHE_ON_UPDATE'] == '1'
        calls.append(command)
        if command == ['lake', 'update']:
            manifest = {'packagesDir': '.lake/packages', 'packages': [
                {'name': 'aeneas', 'subDir': 'backends/lean'}]}
            (cwd / 'lake-manifest.json').write_text(json.dumps(manifest))
            backend = cwd / '.lake/packages/aeneas/backends/lean'
            backend.mkdir(parents=True)
            (backend / 'Aeneas.lean').write_text('import Mathlib.Data.Nat.Basic\n')
            (backend / '.lake').mkdir()
            (backend / '.lake/Example.lean').write_text('import Mathlib\n')
    with patch.object(prepare.subprocess, 'run', side_effect=run):
        prepare.prepare(destination)
    assert calls == [['lake', 'update'],
                     ['lake', 'exe', 'cache', 'get', 'Mathlib.Data.Nat.Basic'],
                     ['lake', 'build', '+Proofs']]
    assert (destination / 'Proofs.lean').is_file()
    # Dependency failures must stop preparation instead of running partial audits.
    with patch.object(prepare.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'lake')):
        try:
            prepare.prepare(Path(directory) / 'failure')
            raise AssertionError('preparation ignored a failed lake command')
        except subprocess.CalledProcessError:
            pass
`,
    ],
    { stdio: "pipe" },
  );
});
