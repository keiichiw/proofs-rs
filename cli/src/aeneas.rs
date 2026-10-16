//! Checks committed Aeneas Lean proofs. API/model correspondence is author supplied.
use crate::{
    config::{CreusotTarget, Project, Tool},
    scan,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    /// Public Rust path relative to the library (or a qualified trait path).
    pub api: String,
    pub module: String,
    pub theorem: String,
    /// Author's statement of the theorem's input assumptions.
    pub precondition: String,
}

pub fn configuration(tool: &Tool) -> Result<Value> {
    Ok(
        json!({"backend":"lean", "lean_dir": tool.lean_dir, "proofs": tool.proofs,
        "audit_command":["lake", "env", "lean", "--stdin"], "audit_source":audit_source(tool)}),
    )
}

pub fn require_clean_build(dir: &Path) -> Result<()> {
    let tracked = crate::git::run(dir, &["ls-files", "-z"])?;
    ensure!(!tracked.split('\0').any(|p| p.split('/').any(|part| part == ".lake")
        || p.contains(".olean") || p.ends_with(".ilean")),
        "Remove tracked .lake/ and Lean compiled artifacts before recording; proofs must build from source");
    Ok(())
}

fn lean_name(s: &str) -> bool {
    !s.is_empty()
        && s.split('.').all(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '\'')
        })
}

pub fn validate(tool: &Tool) -> Result<()> {
    ensure!(
        tool.proofs.len() <= 100,
        "At most 100 Aeneas API mappings are supported per report"
    );
    ensure!(
        tool.version.len() == 40 && tool.version.bytes().all(|c| c.is_ascii_hexdigit()),
        "Aeneas version must be a full 40-character Git revision matching lake-manifest.json"
    );
    if let Some(dir) = &tool.lean_dir {
        ensure!(
            !dir.as_os_str().is_empty()
                && !dir.is_absolute()
                && !dir
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir)),
            "lean_dir must stay within the package directory"
        );
    }
    let mut apis = BTreeSet::new();
    let mut theorems = BTreeSet::new();
    for proof in &tool.proofs {
        ensure!(
            !proof.api.trim().is_empty() && apis.insert(&proof.api),
            "Duplicate or empty Aeneas API mapping"
        );
        ensure!(
            lean_name(&proof.module) && lean_name(&proof.theorem),
            "Unsupported Lean module/theorem name; use dotted ASCII identifiers"
        );
        ensure!(
            theorems.insert(&proof.theorem),
            "Each Aeneas theorem must map to exactly one API"
        );
        ensure!(
            !proof.precondition.trim().is_empty(),
            "Each Aeneas proof requires an explicit precondition"
        );
    }
    Ok(())
}

pub fn directory(project: &Project, tool: &Tool) -> Result<PathBuf> {
    let package = project
        .manifest
        .parent()
        .context("Missing package directory")?;
    let dir = package
        .join(tool.lean_dir.as_deref().unwrap_or(Path::new(".")))
        .canonicalize()
        .context("Resolve [tool].lean_dir")?;
    ensure!(
        dir.starts_with(package.canonicalize()?),
        "Lean directory escapes the package"
    );
    Ok(dir)
}

pub fn pinned_version(dir: &Path, version: &str) -> Result<()> {
    let manifest: Value = serde_json::from_slice(
        &fs::read(dir.join("lake-manifest.json"))
            .context("Commit lake-manifest.json with a pinned Aeneas Git dependency")?,
    )?;
    let packages = manifest["packages"]
        .as_array()
        .context("Missing Lake packages")?;
    let aeneas: Vec<_> = packages.iter().filter(|p| p["name"] == "aeneas").collect();
    ensure!(
        aeneas.len() == 1,
        "Expected one pinned Aeneas Lake dependency"
    );
    let p = aeneas[0];
    ensure!(p["type"] == "git" && p["rev"].as_str().is_some_and(|rev| rev.eq_ignore_ascii_case(version))
        && matches!(p["url"].as_str(), Some("https://github.com/AeneasVerif/aeneas" | "https://github.com/AeneasVerif/aeneas.git"))
        && p["subDir"] == "backends/lean", "Aeneas Lake dependency must use the official repository, backends/lean, and [tool].version revision");
    ensure!(
        dir.join("lean-toolchain").is_file(),
        "Commit lean-toolchain for reproducibility"
    );
    Ok(())
}

pub fn discover(project: &Project, tool: &Tool) -> Result<Vec<scan::Contract>> {
    validate(tool)?;
    ensure!(
        !tool.proofs.is_empty(),
        "Aeneas requires [[tool.proofs]] API/module/theorem/precondition mappings"
    );
    let dir = directory(project, tool)?;
    pinned_version(&dir, &tool.version)?;
    // No Creusot attributes or Kani harnesses are inferred for Aeneas.
    let public = scan::public_contracts(project, false, CreusotTarget::All)?;
    tool.proofs
        .iter()
        .map(|proof| {
            let found: Vec<_> = public
                .iter()
                .filter(|c| c.api_paths.contains(&proof.api))
                .collect();
            ensure!(
                found.len() == 1,
                "Aeneas API {} must resolve to exactly one public Rust callable",
                proof.api
            );
            let file = dir
                .join(format!("{}.lean", proof.module.replace('.', "/")))
                .canonicalize()
                .with_context(|| format!("Cannot locate Lean source module {}", proof.module))?;
            ensure!(
                file.starts_with(&dir),
                "Lean proof source escapes the package"
            );
            let text = fs::read_to_string(&file)?;
            ensure!(!text.trim().is_empty(), "Empty Lean proof source");
            Ok(scan::Contract {
                api_paths: found[0].api_paths.clone(),
                precondition: proof.precondition.clone(),
                file,
                first_line: 1,
                last_line: text.lines().count().max(1),
                harness: proof.theorem.clone(),
            })
        })
        .collect()
}

pub fn validate_command(command: &[String]) -> Result<()> {
    ensure!(
        command == ["lake", "build"],
        "Use cargo proofs run -- lake build for Aeneas (from [tool].lean_dir)"
    );
    Ok(())
}

// Compile the configured modules explicitly, even when omitted from default Lake targets.
pub fn build_command(tool: &Tool) -> Vec<String> {
    let modules: BTreeSet<_> = tool
        .proofs
        .iter()
        .map(|p| format!("+{}", p.module))
        .collect();
    ["lake".to_owned(), "build".to_owned()]
        .into_iter()
        .chain(modules)
        .collect()
}

pub fn audit_source(tool: &Tool) -> String {
    let mut source = String::from("import Lean\n");
    for module in tool
        .proofs
        .iter()
        .map(|p| &p.module)
        .collect::<BTreeSet<_>>()
    {
        source.push_str(&format!("import {module}\n"));
    }
    source.push_str("open Lean Elab Command\n");
    for proof in &tool.proofs {
        source.push_str(&format!(
            r#"
run_cmd do
  let name := `{theorem}
  match (← getEnv).find? name with
  | some (.thmInfo _) => pure ()
  | _ => throwError "Expected a theorem: {theorem}"
  let axioms ← Lean.collectAxioms name
  for ax in axioms do
    unless [``propext, ``Classical.choice, ``Quot.sound].contains ax do
      throwError "Unapproved axiom in {theorem}: {{ax}}"
  liftIO <| IO.println "proofs.rs:checked:{theorem}"
"#,
            theorem = proof.theorem
        ));
    }
    source
}

pub fn audit(dir: &Path, tool: &Tool) -> Result<(String, String)> {
    pinned_version(dir, &tool.version)?;
    let mut child = Command::new("lake")
        .args(["env", "lean", "--stdin"])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Start Lean theorem/axiom audit")?;
    let mut stdin = child.stdin.take().context("Missing Lean stdin")?;
    let source = audit_source(tool);
    // Writing concurrently avoids blocking on compiler diagnostics with many mappings.
    let writer = std::thread::spawn(move || stdin.write_all(source.as_bytes()));
    let output = child.wait_with_output()?;
    let written = writer
        .join()
        .map_err(|_| anyhow::anyhow!("Lean stdin writer failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    ensure!(
        output.status.success(),
        "Lean theorem/axiom audit failed:\n{stdout}\n{stderr}"
    );
    written?;
    for proof in &tool.proofs {
        ensure!(
            stdout
                .lines()
                .any(|line| line.trim() == format!("proofs.rs:checked:{}", proof.theorem)),
            "Lean did not confirm theorem {}",
            proof.theorem
        );
    }
    Ok((stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tool() -> Tool {
        toml::from_str(&format!("name='aeneas'\nversion='{}'\n[[proofs]]\napi='f'\nmodule='Proofs.F'\ntheorem='demo.f_spec'\nprecondition='x > 0'", "a".repeat(40))).unwrap()
    }
    #[test]
    fn strict_configuration_and_injection_rejection() {
        assert!(validate(&tool()).is_ok());
        for name in ["", "A\nimport Evil", "A;run_cmd", "A..B", "../A", "A.«B»"] {
            let mut t = tool();
            t.proofs[0].module = name.into();
            assert!(validate(&t).is_err(), "{name}");
        }
        let mut t = tool();
        t.proofs.push(t.proofs[0].clone());
        assert!(validate(&t).is_err());
        let mut t = tool();
        t.lean_dir = Some("../outside".into());
        assert!(validate(&t).is_err());
        let mut t = tool();
        t.version = "main".into();
        assert!(validate(&t).is_err());
        assert!(validate_command(&["lake".into(), "build".into()]).is_ok());
        assert!(validate_command(&["lake".into(), "build".into(), "--help".into()]).is_err());
    }
    #[test]
    fn revision_and_source_identity_must_match() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("lean-toolchain"), "leanprover/lean4:v4.35.0").unwrap();
        let p = json!({"name":"aeneas","type":"git","url":"https://github.com/AeneasVerif/aeneas","rev":"a".repeat(40),"subDir":"backends/lean"});
        for (key, value) in [
            ("rev", json!("b".repeat(40))),
            ("url", json!("https://github.com/fork/aeneas")),
            ("type", json!("path")),
            ("subDir", json!("other")),
        ] {
            let mut wrong = p.clone();
            wrong[key] = value;
            fs::write(
                d.path().join("lake-manifest.json"),
                json!({"packages":[wrong]}).to_string(),
            )
            .unwrap();
            assert!(pinned_version(d.path(), &"a".repeat(40)).is_err());
        }
        fs::write(
            d.path().join("lake-manifest.json"),
            json!({"packages":[p]}).to_string(),
        )
        .unwrap();
        assert!(pinned_version(d.path(), &"a".repeat(40)).is_ok());
    }

    #[test]
    fn explicit_public_api_mapping_and_committed_evidence() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("Cargo.toml"), "").unwrap();
        fs::write(
            d.path().join("lib.rs"),
            "mod inner { pub fn f() {} } pub use inner::f as exported; fn private() {}",
        )
        .unwrap();
        fs::create_dir_all(d.path().join("Proofs")).unwrap();
        fs::write(
            d.path().join("Proofs/F.lean"),
            "-- evidence\ntheorem demo.f_spec : True := by trivial\n",
        )
        .unwrap();
        fs::write(d.path().join("lean-toolchain"), "leanprover/lean4:v4.35.0").unwrap();
        fs::write(d.path().join("lake-manifest.json"), json!({"packages":[{"name":"aeneas","type":"git","url":"https://github.com/AeneasVerif/aeneas","rev":"a".repeat(40),"subDir":"backends/lean"}]}).to_string()).unwrap();
        let project = Project {
            name: "demo".into(),
            version: "1".into(),
            lib_name: "demo".into(),
            manifest: d.path().join("Cargo.toml"),
            root_source: d.path().join("lib.rs"),
            features: Default::default(),
            cfg: Default::default(),
        };
        let mut t = tool();
        t.proofs[0].api = "exported".into();
        let contracts = discover(&project, &t).unwrap();
        assert_eq!(contracts[0].api_paths, ["exported"]);
        assert_eq!(contracts[0].harness, "demo.f_spec");
        assert_eq!(contracts[0].last_line, 2);
        assert!(contracts[0].file.ends_with("Proofs/F.lean"));
        for api in ["private", "missing", "inner::f"] {
            t.proofs[0].api = api.into();
            assert!(discover(&project, &t).is_err(), "{api}");
        }
        crate::git::run(d.path(), &["init", "-q"]).unwrap();
        fs::create_dir_all(d.path().join(".lake")).unwrap();
        fs::write(d.path().join(".lake/cached"), "cache").unwrap();
        crate::git::run(d.path(), &["add", ".lake/cached"]).unwrap();
        assert!(require_clean_build(d.path()).is_err());
    }

    #[test]
    #[ignore = "requires Lean on PATH; exercised by the Lean audit CI job"]
    fn real_lean_checks_theorems_and_transitive_axioms() {
        let d = tempfile::tempdir().unwrap();
        let mut t = tool();
        t.proofs[0].module = "Proofs".into();
        for (body, success) in [
            ("theorem demo.f_spec : True := by trivial", true),
            ("theorem demo.f_spec : True := by sorry", false),
            ("axiom bad : False\ntheorem helper : False := bad\ntheorem demo.f_spec : False := helper", false),
            ("def demo.f_spec : Nat := 0", false),
            ("theorem other : True := by trivial", false),
        ] {
            fs::write(d.path().join("Proofs.lean"), body).unwrap();
            let build = Command::new("lean").args(["-o", "Proofs.olean", "Proofs.lean"])
                .current_dir(d.path()).output().expect("Install Lean on PATH");
            assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stdout));
            let mut audit = Command::new("lean").arg("--stdin").env("LEAN_PATH", d.path())
                .current_dir(d.path()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
            audit.stdin.take().unwrap().write_all(audit_source(&t).as_bytes()).unwrap();
            let result = audit.wait_with_output().unwrap();
            assert_eq!(result.status.success(), success, "{body}\n{}\n{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
            if success {
                assert!(String::from_utf8_lossy(&result.stdout).lines().any(|line| line == "proofs.rs:checked:demo.f_spec"));
            }
        }
    }
}
