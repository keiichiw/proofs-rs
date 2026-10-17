use anyhow::{ensure, Context, Result};
use std::{path::Path, process::Command};

pub fn run(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .context("Run git")?;
    ensure!(
        out.status.success(),
        "git {} failed: {}",
        args.first().unwrap_or(&""),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?.trim().into())
}

/// Resolve a public, immutable source before verification. No generated evidence needs a push.
pub fn published_source(root: &Path, remote: &str) -> Result<serde_json::Value> {
    ensure!(
        !remote.starts_with('-') && !remote.contains('/'),
        "Use a Git remote name"
    );
    let raw = run(root, &["remote", "get-url", remote])?;
    let url = raw
        .strip_prefix("git@github.com:")
        .map(|s| format!("https://github.com/{s}"))
        .unwrap_or(raw);
    let url = url.trim_end_matches('/').trim_end_matches(".git");
    let path = url
        .strip_prefix("https://github.com/")
        .context("Source remote must be a GitHub repository")?;
    let parts: Vec<_> = path.split('/').collect();
    ensure!(
        parts.len() == 2
            && parts.iter().all(|s| !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))),
        "Invalid GitHub repository URL"
    );
    let commit = run(root, &["rev-parse", "HEAD"])?;
    ensure!(
        run(root, &["status", "--porcelain"])?.is_empty(),
        "Commit and push source changes before cargo proofs run"
    );
    run(root, &["fetch", "--prune", remote])?;
    ensure!(
        !run(
            root,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "--contains",
                &commit,
                &format!("refs/remotes/{remote}/")
            ]
        )?
        .is_empty(),
        "Push the source commit before cargo proofs run"
    );
    Ok(serde_json::json!({"repository":url,"commit":commit}))
}

/// A disposable source snapshot. Submodules use an isolated clone because linked
/// worktrees share config with the caller (submodule init writes that config).
pub struct Worktree {
    root: std::path::PathBuf,
    pub path: std::path::PathBuf,
    linked: bool,
    commit: String,
    _temp: tempfile::TempDir,
}
impl Worktree {
    pub fn create(root: &Path, commit: &str, remote: &str) -> Result<Self> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().canonicalize()?.join("source");
        let has_submodules = run(root, &["ls-tree", "-r", commit])?
            .lines()
            .any(|line| line.starts_with("160000 "));
        // Construct the guard before any operation that can partially succeed.
        let checkout = Self {
            root: root.to_owned(),
            path,
            linked: !has_submodules,
            commit: run(root, &["rev-parse", commit])?,
            _temp: temp,
        };
        let path = checkout.path.to_str().context("Non-UTF8 checkout path")?;
        if has_submodules {
            run(
                root,
                &["clone", "--shared", "--no-checkout", "--", ".", path],
            )?;
            // Resolve relative .gitmodules URLs against the selected source remote,
            // not against the local directory used to borrow Git objects.
            let url = run(root, &["config", "--get", &format!("remote.{remote}.url")])?;
            run(&checkout.path, &["remote", "set-url", "origin", &url])?;
            run(&checkout.path, &["checkout", "--detach", commit])?;
            run(
                &checkout.path,
                &[
                    "-c",
                    "submodule.active=.",
                    "submodule",
                    "update",
                    "--init",
                    "--recursive",
                    "--checkout",
                ],
            )
            .context("Restore pinned submodules")?;
        } else {
            run(root, &["worktree", "add", "--detach", path, commit])?;
        }
        checkout.unchanged()?;
        Ok(checkout)
    }
    pub fn unchanged(&self) -> Result<()> {
        ensure!(
            run(&self.path, &["rev-parse", "HEAD"])? == self.commit,
            "Tracked inputs changed during verification: source HEAD changed"
        );
        ensure!(
            run(
                &self.path,
                &[
                    "status",
                    "--porcelain",
                    "--untracked-files=no",
                    "--ignore-submodules=untracked"
                ]
            )?
            .is_empty(),
            "Tracked inputs changed during verification; run again"
        );
        let status = run(&self.path, &["submodule", "status", "--recursive"])?;
        ensure!(
            !status.lines().any(|line| line.starts_with(['-', '+', 'U'])),
            "Submodule HEAD differs from its pinned Gitlink or is not initialized"
        );
        // Explicit flags override .gitmodules ignore settings. Generated, untracked
        // build outputs are allowed, as they are in the superproject.
        run(&self.path, &["submodule", "foreach", "--quiet", "--recursive",
            "test \"$(git rev-parse HEAD)\" = \"$sha1\" && git diff --quiet --ignore-submodules=untracked HEAD --"])
            .context("Tracked inputs changed in a submodule")?;
        Ok(())
    }
}
impl Drop for Worktree {
    fn drop(&mut self) {
        if self.linked {
            if let Some(path) = self.path.to_str() {
                let _ = run(&self.root, &["worktree", "remove", "--force", path]);
            }
        }
        // TempDir removes isolated clones, including partially initialized modules.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run(path, &["init", "-q"]).unwrap();
        run(path, &["config", "user.name", "Test"]).unwrap();
        run(path, &["config", "user.email", "test@example.test"]).unwrap();
        fs::write(path.join("source"), "original").unwrap();
        commit(path);
    }
    fn commit(path: &Path) {
        run(path, &["add", "."]).unwrap();
        run(path, &["commit", "-qm", "fixture"]).unwrap();
    }
    #[test]
    fn submodule_snapshots() {
        // Git's file transport is enabled only in this isolated test process.
        if std::env::var_os("PROOFS_SUBMODULE_TEST_CHILD").is_none() {
            let scratch = tempfile::tempdir().unwrap();
            let result = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "git::tests::submodule_snapshots", "--nocapture"])
                .env("PROOFS_SUBMODULE_TEST_CHILD", "1")
                .env("TMPDIR", scratch.path())
                .env("GIT_CONFIG_COUNT", "1")
                .env("GIT_CONFIG_KEY_0", "protocol.file.allow")
                .env("GIT_CONFIG_VALUE_0", "always")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            // Apple's Git launcher creates xcrun_db in TMPDIR independently of us.
            let leftovers: Vec<_> = fs::read_dir(scratch.path())
                .unwrap()
                .map(|e| e.unwrap().path())
                .filter(|p| p.file_name().unwrap() != "xcrun_db")
                .collect();
            assert!(
                leftovers.is_empty(),
                "Temporary snapshots leaked: {leftovers:?}"
            );
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("parent");
        let child = temp.path().join("child");
        let leaf = temp.path().join("leaf");
        for path in [&root, &child, &leaf] {
            init(path);
        }
        run(
            &root,
            &["remote", "add", "selected", root.to_str().unwrap()],
        )
        .unwrap();
        run(&child, &["submodule", "add", "../leaf", "nested space"]).unwrap();
        commit(&child);
        let child_pin = run(&child, &["rev-parse", "HEAD"]).unwrap();
        // No-module linked worktrees are still supported and cleaned up.
        let plain = Worktree::create(&root, "HEAD", "selected").unwrap();
        assert!(plain.linked);
        let plain_path = plain.path.clone();
        drop(plain);
        assert!(!plain_path.exists());
        run(&root, &["submodule", "add", "../child", "upstream space"]).unwrap();
        // Ignore configuration must not hide changes in either level.
        run(
            &root,
            &[
                "config",
                "-f",
                ".gitmodules",
                "submodule.upstream space.ignore",
                "all",
            ],
        )
        .unwrap();
        commit(&root);
        fs::write(child.join("source"), "newer remote branch").unwrap();
        commit(&child);
        let config = fs::read(root.join(".git/config")).unwrap();
        let registrations = run(&root, &["worktree", "list", "--porcelain"]).unwrap();
        let snapshot = Worktree::create(&root, "HEAD", "selected").unwrap();
        assert!(!snapshot.linked);
        let module = snapshot.path.join("upstream space");
        assert_eq!(run(&module, &["rev-parse", "HEAD"]).unwrap(), child_pin);
        assert_eq!(
            fs::read_to_string(module.join("nested space/source")).unwrap(),
            "original"
        );
        assert_eq!(fs::read(root.join(".git/config")).unwrap(), config);
        fs::write(module.join("untracked-build"), "output").unwrap();
        snapshot.unchanged().unwrap();
        fs::write(module.join("nested space/source"), "changed").unwrap();
        assert!(snapshot.unchanged().is_err());
        run(&module.join("nested space"), &["checkout", "--", "source"]).unwrap();
        snapshot.unchanged().unwrap();
        fs::write(module.join("source"), "changed").unwrap();
        assert!(snapshot.unchanged().is_err());
        run(&module, &["checkout", "--", "source"]).unwrap();
        run(&module, &["checkout", "--detach", "origin/HEAD"]).unwrap();
        assert!(snapshot.unchanged().is_err());
        let snapshot_path = snapshot.path.clone();
        drop(snapshot);
        assert!(!snapshot_path.exists());
        assert_eq!(
            run(&root, &["worktree", "list", "--porcelain"]).unwrap(),
            registrations
        );
        // Fail after the first module has cloned, while fetching its nested module.
        fs::rename(&leaf, temp.path().join("leaf-unavailable")).unwrap();
        assert!(Worktree::create(&root, "HEAD", "selected").is_err());
        assert_eq!(fs::read(root.join(".git/config")).unwrap(), config);
        assert_eq!(
            run(&root, &["worktree", "list", "--porcelain"]).unwrap(),
            registrations
        );
        fs::rename(&child, temp.path().join("child-unavailable")).unwrap();
        assert!(Worktree::create(&root, "HEAD", "selected").is_err());
        assert_eq!(
            run(&root, &["worktree", "list", "--porcelain"]).unwrap(),
            registrations
        );
    }
}
