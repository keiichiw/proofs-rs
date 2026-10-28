//! Managed restoration of a fixed Git source and one cumulative patch.
//! This layer knows nothing about Lake or Aeneas pins.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn relative(path: &Path) -> Result<String> {
    let s = path.to_str().context("Non-UTF8 relative path")?;
    ensure!(
        !s.is_empty()
            && !s.contains(['\\', ':'])
            && !s.chars().any(char::is_control)
            && path.components().all(|c| matches!(c, Component::Normal(_))),
        "Use a normalized relative path within the repository"
    );
    ensure!(
        !s.split('/').any(|s| s.is_empty() || s == "." || s == ".."),
        "Use a normalized relative path"
    );
    Ok(s.into())
}
pub fn sha(s: &str) -> Result<String> {
    ensure!(
        s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()),
        "Expected full 40-character Git SHA"
    );
    Ok(s.to_ascii_lowercase())
}
/// Reject symlinks in every path component, including a symlink to an in-tree file.
pub fn patch_bytes(package: &Path, path: &Path, root: &Path) -> Result<(String, Vec<u8>)> {
    relative(path)?;
    let package = package.canonicalize()?;
    let root = root.canonicalize()?;
    let file = package.join(path);
    let repo_path = file
        .strip_prefix(&root)
        .context("Patch escapes proof repository")?;
    let mut cursor = root.clone();
    for part in repo_path.components() {
        cursor.push(part);
        ensure!(
            !fs::symlink_metadata(&cursor)?.file_type().is_symlink(),
            "Patch path must not contain symlinks"
        );
    }
    ensure!(
        fs::metadata(&file)?.is_file(),
        "Patch must be a regular file"
    );
    let bytes = fs::read(&file)?;
    ensure!(
        !bytes.is_empty() && bytes.len() <= 8 * 1024 * 1024,
        "Patch must contain 1 byte–8 MiB"
    );
    Ok((relative(repo_path)?, bytes))
}
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
struct Stamp {
    repository: String,
    base: String,
    patch: String,
    tree: String,
    snapshot: BTreeMap<String, String>,
}
#[derive(Debug)]
pub struct PreparedSource {
    pub path: PathBuf,
    pub tree: String,
    pub base_commit: String,
    pub patch_sha256: String,
    snapshot: BTreeMap<String, String>,
}
fn compiled(path: &Path) -> bool {
    path.file_name().is_some_and(|s| {
        let s = s.to_string_lossy();
        s.contains(".olean")
            || s.contains(".ilean")
            || path.extension().is_some_and(|e| {
                [
                    "o", "a", "so", "dylib", "dll", "exe", "bc", "cmo", "cmx", "cmi", "cmxa",
                    "cmxs",
                ]
                .iter()
                .any(|x| e == *x)
            })
    })
}
fn generated(path: &Path) -> bool {
    if compiled(path) {
        return true;
    }
    let parts: Vec<_> = path
        .components()
        .map(|p| p.as_os_str().to_string_lossy())
        .collect();
    if parts.iter().any(|p| p == ".lake") {
        // Only regular Lake build outputs are exempt. Never blanket-ignore .lake: an added
        // Lean/Rust/OCaml source in the build area is still an input mutation.
        return path.extension().is_some_and(|e| {
            [
                "trace", "hash", "json", "c", "o", "a", "so", "dylib", "dll", "bc", "ll", "export",
                "ir", "sig", "rsp",
            ]
            .iter()
            .any(|x| e == *x)
        });
    }
    false
}
fn safe_destination(destination: &Path) -> Result<()> {
    ensure!(
        destination.is_absolute(),
        "Managed destination must be absolute"
    );
    let mut cursor = PathBuf::new();
    for c in destination.components() {
        cursor.push(c);
        match fs::symlink_metadata(&cursor) {
            Ok(m) => ensure!(
                !m.file_type().is_symlink(),
                "Managed destination must not traverse symlinks"
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
fn snapshot(root: &Path) -> Result<BTreeMap<String, String>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<()> {
        for e in fs::read_dir(dir)? {
            let e = e?;
            let p = e.path();
            let r = p.strip_prefix(root)?;
            if r.components()
                .next()
                .is_some_and(|c| c.as_os_str() == ".git")
            {
                continue;
            }
            let m = fs::symlink_metadata(&p)?;
            if m.is_file() && generated(r) {
                continue;
            }
            if m.is_dir() {
                walk(root, &p, out)?;
            } else {
                #[cfg(unix)]
                let mode = {
                    use std::os::unix::fs::PermissionsExt;
                    m.permissions().mode() & 0o111
                };
                #[cfg(not(unix))]
                let mode = 0;
                let data = if m.file_type().is_symlink() {
                    fs::read_link(&p)?.to_string_lossy().as_bytes().to_vec()
                } else {
                    fs::read(&p)?
                };
                out.insert(
                    r.to_string_lossy().into(),
                    format!("{}:{mode}:{}", m.file_type().is_symlink(), digest(&data)),
                );
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    walk(root, root, &mut result)?;
    Ok(result)
}
impl PreparedSource {
    pub fn unchanged(&self) -> Result<()> {
        ensure!(snapshot(&self.path)? == self.snapshot, "Prepared toolchain source changed during verification (content, mode, addition or deletion)");
        Ok(())
    }
}
fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.eol=lf",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()?;
    ensure!(
        out.status.success(),
        "Git source restoration failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?.trim().into())
}
fn apply(dir: &Path, bytes: &[u8], check: bool) -> Result<()> {
    let mut c = Command::new("git");
    c.current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args([
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.eol=lf",
            "-c",
            "core.hooksPath=/dev/null",
            "apply",
            "--whitespace=nowarn",
            "--index",
        ]);
    if check {
        c.arg("--check");
    }
    let mut child = c
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut input = child.stdin.take().unwrap();
    let bytes = bytes.to_vec();
    let writer = std::thread::spawn(move || input.write_all(&bytes));
    let out = child.wait_with_output()?;
    writer
        .join()
        .map_err(|_| anyhow::anyhow!("Patch writer failed"))??;
    ensure!(
        out.status.success(),
        "Cannot apply cumulative patch: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}
pub fn prepare(
    repository: &str,
    base: &str,
    patch: &[u8],
    destination: &Path,
) -> Result<PreparedSource> {
    let base = sha(base)?;
    safe_destination(destination)?;
    if destination.symlink_metadata().is_ok() {
        ensure!(
            !destination.symlink_metadata()?.file_type().is_symlink(),
            "Managed destination is a symlink"
        );
        let stamp: Stamp = serde_json::from_slice(
            &fs::read(destination.join(".git/proofs-source.json"))
                .context("Existing destination is not managed by cargo proofs; move it aside")?,
        )?;
        ensure!(
            snapshot(destination)? == stamp.snapshot,
            "Managed source contains user edits; move it aside before prepare"
        );
        if stamp.repository == repository && stamp.base == base && stamp.patch == digest(patch) {
            return Ok(PreparedSource {
                path: destination.into(),
                tree: stamp.tree,
                base_commit: stamp.base,
                patch_sha256: stamp.patch,
                snapshot: stamp.snapshot,
            });
        }
        fs::remove_dir_all(destination)?;
    }
    let parent = destination
        .parent()
        .context("Missing managed source parent")?;
    fs::create_dir_all(parent)?;
    ensure!(
        parent.canonicalize()? == parent,
        "Managed destination parent must not be a symlink"
    );
    let temp = tempfile::tempdir_in(parent)?;
    let dir = temp.path();
    git(dir, &["init", "-q"])?;
    git(
        dir,
        &[
            "-c",
            "core.hooksPath=/dev/null",
            "fetch",
            "--depth=1",
            "--no-tags",
            "--",
            repository,
            &base,
        ],
    )?;
    git(
        dir,
        &[
            "-c",
            "core.hooksPath=/dev/null",
            "checkout",
            "--detach",
            &base,
        ],
    )?;
    if !patch.is_empty() {
        apply(dir, patch, true)?;
        apply(dir, patch, false)?;
    }
    // Inspect the resulting index, not patch headers (binary patches and quoted paths included).
    let changed = git(
        dir,
        &["diff", "--cached", "--name-only", "--no-renames", "-z"],
    )?;
    for path in changed.split('\0').filter(|s| !s.is_empty()) {
        let path = Path::new(path);
        relative(path)?;
        ensure!(
            !compiled(path)
                && !path.components().any(|p| p.as_os_str() == ".lake")
                && path
                    .file_name()
                    .is_some_and(|n| n != ".gitmodules" && n != "lake-manifest.json")
                && !path
                    .components()
                    .any(|c| c.as_os_str() == ".proofs-toolchain"),
            "Patch contains dependency or compiled artifacts: {}",
            path.display()
        );
    }
    let raw = git(dir, &["diff", "--cached", "--raw", "--no-renames"])?;
    for line in raw.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        ensure!(
            fields.len() >= 2
                && !["120000", "160000"].contains(&fields[0].trim_start_matches(':'))
                && !["120000", "160000"].contains(&fields[1]),
            "Patch cannot add or change symlinks or submodules"
        );
    }
    let tree = git(dir, &["write-tree"])?;
    let files = snapshot(dir)?;
    let stamp = Stamp {
        repository: repository.into(),
        base,
        patch: digest(patch),
        tree: tree.clone(),
        snapshot: files.clone(),
    };
    fs::write(
        dir.join(".git/proofs-source.json"),
        serde_json::to_vec(&stamp)?,
    )?;
    fs::rename(dir, destination)?;
    Ok(PreparedSource {
        path: destination.into(),
        tree,
        base_commit: stamp.base,
        patch_sha256: stamp.patch,
        snapshot: files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path) -> String {
        fs::create_dir_all(root.join("backends/lean")).unwrap();
        fs::write(root.join("backends/lean/Model.lean"), "def model := 0\n").unwrap();
        fs::write(root.join("translator.ml"), "let translate = 0\n").unwrap();
        git(root, &["init", "-q"]).unwrap();
        git(root, &["add", "."]).unwrap();
        git(
            root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-qm",
                "fixture",
            ],
        )
        .unwrap();
        git(root, &["rev-parse", "HEAD"]).unwrap()
    }
    fn diff(root: &Path) -> Vec<u8> {
        Command::new("git")
            .current_dir(root)
            .args([
                "diff",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-textconv",
                "HEAD",
                "--",
            ])
            .output()
            .unwrap()
            .stdout
    }
    #[test]
    fn patch_bytes_are_not_repaired_by_git_configuration() {
        if std::env::var_os("PROOFS_PATCH_WHITESPACE_CHILD").is_none() {
            let result = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "toolchain::tests::patch_bytes_are_not_repaired_by_git_configuration",
                ])
                .env("PROOFS_PATCH_WHITESPACE_CHILD", "1")
                .env("GIT_CONFIG_COUNT", "2")
                .env("GIT_CONFIG_KEY_0", "apply.whitespace")
                .env("GIT_CONFIG_VALUE_0", "fix")
                .env("GIT_CONFIG_KEY_1", "core.autocrlf")
                .env("GIT_CONFIG_VALUE_1", "true")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let root = t.path().canonicalize().unwrap();
        let upstream = root.join("upstream");
        fs::create_dir(&upstream).unwrap();
        let base = fixture(&upstream);
        fs::write(upstream.join("translator.ml"), "let translate = 1  \n").unwrap();
        let patch = diff(&upstream);
        let prepared = prepare(
            upstream.to_str().unwrap(),
            &base,
            &patch,
            &root.join("prepared"),
        )
        .unwrap();
        assert_eq!(
            fs::read(prepared.path.join("translator.ml")).unwrap(),
            b"let translate = 1  \n"
        );
        prepared.unchanged().unwrap();
    }
    #[test]
    fn deterministic_restoration_and_actual_source_immutability() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().canonicalize().unwrap();
        let upstream = root.join("upstream");
        fs::create_dir(&upstream).unwrap();
        let base = fixture(&upstream);
        for (i, lean, ocaml) in [(0, true, false), (1, false, true), (2, true, true)] {
            git(&upstream, &["reset", "--hard", "HEAD"]).unwrap();
            if lean {
                fs::write(
                    upstream.join("backends/lean/Model.lean"),
                    "def model := 1\n",
                )
                .unwrap();
            }
            if ocaml {
                fs::write(upstream.join("translator.ml"), "let translate = 1\n").unwrap();
            }
            let patch = diff(&upstream);
            let a = prepare(
                upstream.to_str().unwrap(),
                &base,
                &patch,
                &root.join(format!("a{i}")),
            )
            .unwrap();
            let b = prepare(
                upstream.to_str().unwrap(),
                &base,
                &patch,
                &root.join(format!("b{i}")),
            )
            .unwrap();
            assert_eq!(a.tree, b.tree);
            a.unchanged().unwrap();
            fs::create_dir_all(a.path.join("backends/lean/.lake/build/lib/lean")).unwrap();
            fs::write(
                a.path
                    .join("backends/lean/.lake/build/lib/lean/Model.olean"),
                "generated",
            )
            .unwrap();
            a.unchanged().unwrap();
            fs::write(
                a.path.join("backends/lean/.lake/evil.lean"),
                "axiom evil : False",
            )
            .unwrap();
            assert!(a.unchanged().is_err());
            fs::remove_file(a.path.join("backends/lean/.lake/evil.lean")).unwrap();
            fs::write(a.path.join("new.lean"), "def new := 1").unwrap();
            assert!(a.unchanged().is_err());
            fs::remove_file(a.path.join("new.lean")).unwrap();
            fs::create_dir_all(a.path.join("hidden.olean")).unwrap();
            fs::write(a.path.join("hidden.olean/evil.lean"), "axiom evil : False").unwrap();
            assert!(a.unchanged().is_err());
            fs::remove_dir_all(a.path.join("hidden.olean")).unwrap();
            fs::write(a.path.join("translator.ml"), "edited").unwrap();
            assert!(a.unchanged().is_err());
            assert!(prepare(upstream.to_str().unwrap(), &base, &patch, &a.path)
                .unwrap_err()
                .to_string()
                .contains("user edits"));
            fs::remove_file(b.path.join("translator.ml")).unwrap();
            assert!(b.unchanged().is_err());
        }
    }
    #[test]
    fn refuses_artifacts_links_unmanaged_destinations_and_bad_patches() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().canonicalize().unwrap();
        let upstream = root.join("upstream");
        fs::create_dir(&upstream).unwrap();
        let base = fixture(&upstream);
        for name in [
            "evil.olean",
            "evil.olean.private",
            "evil.ilean",
            "evil.so",
            "evil.cmx",
            ".lake/injected.lean",
            "lake-manifest.json",
        ] {
            fs::create_dir_all(upstream.join(name).parent().unwrap()).unwrap();
            fs::write(upstream.join(name), "bad").unwrap();
            git(&upstream, &["add", "-N", name]).unwrap();
            assert!(
                prepare(
                    upstream.to_str().unwrap(),
                    &base,
                    &diff(&upstream),
                    &root.join("destination")
                )
                .is_err(),
                "{name}"
            );
            git(&upstream, &["reset", "--hard", "HEAD"]).unwrap();
            git(&upstream, &["clean", "-fd"]).unwrap();
        }
        git(
            &upstream,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{base},submodule"),
            ],
        )
        .unwrap();
        let gitlink_patch = Command::new("git")
            .current_dir(&upstream)
            .args(["diff", "--cached", "HEAD", "--"])
            .output()
            .unwrap()
            .stdout;
        assert!(prepare(
            upstream.to_str().unwrap(),
            &base,
            &gitlink_patch,
            &root.join("destination")
        )
        .is_err());
        git(&upstream, &["reset", "--hard", "HEAD"]).unwrap();
        assert!(prepare(
            upstream.to_str().unwrap(),
            &base,
            b"invalid patch",
            &root.join("destination")
        )
        .is_err());
        fs::create_dir(root.join("unmanaged")).unwrap();
        fs::write(root.join("unmanaged/keep"), "keep").unwrap();
        assert!(prepare(
            upstream.to_str().unwrap(),
            &base,
            b"patch",
            &root.join("unmanaged")
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(root.join("unmanaged/keep")).unwrap(),
            "keep"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink("translator.ml", upstream.join("link")).unwrap();
            git(&upstream, &["add", "-N", "link"]).unwrap();
            assert!(prepare(
                upstream.to_str().unwrap(),
                &base,
                &diff(&upstream),
                &root.join("destination")
            )
            .is_err());
            symlink(root.join("unmanaged"), root.join("alias")).unwrap();
            assert!(prepare(
                upstream.to_str().unwrap(),
                &base,
                b"patch",
                &root.join("alias/child")
            )
            .is_err());
            symlink(upstream.join("translator.ml"), root.join("patch-link")).unwrap();
            assert!(patch_bytes(&root, Path::new("patch-link"), &root).is_err());
        }
        for path in ["../outside", "/absolute", "a/./b", "a//b", "a\\b", "a:b"] {
            assert!(relative(Path::new(path)).is_err());
        }
    }
}
