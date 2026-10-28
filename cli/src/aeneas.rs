//! Resolves committed Aeneas manifests and checks Lean propositions and their axioms.
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
    #[serde(default)]
    pub precondition: String,
}

pub fn configuration(tool: &Tool) -> Result<Value> {
    let mut value = json!({"backend":"lean", "lean_dir": tool.lean_dir, "proofs": tool.proofs,
        "audit_command":["lake", "env", "lean", "--stdin"], "audit_source":audit_source(tool)});
    if !tool.proof_modules.is_empty() {
        value["proof_modules"] = json!(tool.proof_modules);
    }
    if let Some(path) = &tool.translation_manifest {
        value["translation_manifest"] = json!(path);
    }
    Ok(value)
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
        tool.proofs.len() <= crate::MAX_REPORT_CLAIMS,
        "At most 200 Aeneas API mappings are supported per report"
    );
    ensure!(
        tool.version.len() == 40 && tool.version.bytes().all(|c| c.is_ascii_hexdigit()),
        "Aeneas version must be a full 40-character Git revision matching lake-manifest.json"
    );
    if let Some(path) = &tool.patch {
        crate::toolchain::relative(path)?;
    }
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
    ensure!(
        tool.proof_modules.len() <= 100 && tool.proof_modules.iter().all(|m| lean_name(m)),
        "Invalid proof_modules"
    );
    if let Some(path) = &tool.translation_manifest {
        ensure!(
            safe_relative(path),
            "translation_manifest must stay within lean_dir"
        );
    }
    let mut theorems = BTreeSet::new();
    for proof in &tool.proofs {
        ensure!(!proof.api.trim().is_empty(), "Empty Aeneas API mapping");
        ensure!(
            lean_name(&proof.module) && lean_name(&proof.theorem),
            "Unsupported Lean module/theorem name; use dotted ASCII identifiers"
        );
        ensure!(
            theorems.insert(&proof.theorem),
            "Each Aeneas theorem must map to exactly one API"
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
    dependency(&dir, tool)?;
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
        .chain(tool.proof_modules.iter().map(|m| format!("+{m}")))
        .collect();
    ["lake".to_owned()]
        .into_iter()
        .chain(tool.patch.as_ref().map(|_| "--no-cache".to_owned()))
        .chain(["build".to_owned()])
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
  let theorem_name := `{theorem}
  match (← getEnv).find? theorem_name with
  | some (.thmInfo _) => pure ()
  | _ => throwError "Expected a theorem: {theorem}"
  let axioms ← Lean.collectAxioms theorem_name
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

#[cfg(test)]
pub fn audit(dir: &Path, tool: &Tool) -> Result<(String, String)> {
    dependency(dir, tool)?;
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

fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path.components().all(|c| {
            matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
        && !path.to_string_lossy().contains(['\\', ':'])
}
fn local_source(dir: &Path, relative: &Path) -> Result<PathBuf> {
    ensure!(
        safe_relative(relative),
        "Invalid package-relative source path"
    );
    let file = dir.join(relative).canonicalize()?;
    ensure!(
        file.starts_with(dir.canonicalize()?)
            && !relative.components().any(|p| p.as_os_str() == ".lake"),
        "Source escapes the Lake package"
    );
    Ok(file)
}
fn local_modules(dir: &Path) -> Result<BTreeSet<String>> {
    let mut modules = BTreeSet::new();
    for entry in ignore::WalkBuilder::new(dir).hidden(true).build() {
        let entry = entry?;
        if entry.path().extension().is_some_and(|x| x == "lean") {
            let relative = entry.path().strip_prefix(dir)?;
            let name = relative
                .with_extension("")
                .to_string_lossy()
                .replace('/', ".");
            if lean_name(&name) && local_source(dir, relative).is_ok() {
                modules.insert(name);
            }
        }
    }
    Ok(modules)
}
fn probe_source(tool: &Tool, modules: &BTreeSet<String>) -> String {
    let imports: BTreeSet<_> = tool
        .proof_modules
        .iter()
        .chain(tool.proofs.iter().map(|p| &p.module))
        .collect();
    let mut source = String::from("import Aeneas\n");
    for module in imports {
        source.push_str(&format!("import {module}\n"));
    }
    source.push_str("set_option pp.all true\nset_option pp.universes true\nset_option pp.explicit true\nset_option pp.fullNames true\nset_option pp.notation false\nset_option pp.proofs true\nset_option pp.deepTerms true\nset_option pp.maxSteps 10000000\n");
    source.push_str(include_str!("aeneas_probe.lean"));
    let manual = tool
        .proofs
        .iter()
        .map(|p| format!("`{}", p.theorem))
        .collect::<Vec<_>>()
        .join(", ");
    let scope = if tool.proof_modules.is_empty() {
        BTreeSet::new()
    } else {
        modules.clone()
    };
    let roots = tool
        .proof_modules
        .iter()
        .map(|m| format!("`{m}"))
        .collect::<Vec<_>>()
        .join(", ");
    let scope = scope
        .iter()
        .map(|m| format!("\"{m}\""))
        .collect::<Vec<_>>()
        .join(", ");
    source.push_str(&format!(
        r#"
run_cmd do
  let manual : Array Name := #[{manual}]
  let localModules : Array String := #[{scope}]
  let roots : Array Name := #[{roots}]
  let env ← getEnv
  let mut closure : Array Name := #[]
  let mut pending := roots.toList
  while !pending.isEmpty do
    let m := pending.head!
    pending := pending.tail!
    if !closure.contains m then
      closure := closure.push m
      if let some idx := env.header.moduleNames.findIdx? (· == m) then
        pending := (env.header.moduleData[idx]!.imports.toList.map (·.module)) ++ pending
  let scope := closure.filter (fun m => localModules.contains m.toString)
  for n in manual do
    match env.find? n with
    | some (.thmInfo _) => pure ()
    | _ => throwError "Expected a theorem: {{n}}"
  for (n, ci) in env.constants.toList do
    let explicit := manual.contains n
    if explicit || scope.contains (ProofsProbe.moduleOf env n).toName then
      if let .thmInfo th := ci then
        let result ← liftTermElabM <| ProofsProbe.inspect n th.type explicit
        if let some value := result then
          liftIO <| IO.println ("proofs.rs:formal:" ++ value.compress)
"#
    ));
    source
}

/// Resolve and inspect in the built committed checkout. All matching uses the manifest's
/// exact program head; dependencies and theorem names are never used as API guesses.
pub fn extract(
    project: &Project,
    tool: &Tool,
    root: &Path,
) -> Result<(Vec<crate::record::Contract>, String, String, String)> {
    validate(tool)?;
    let dir = directory(project, tool)?;
    dependency(&dir, tool)?;
    let modules = local_modules(&dir)?;
    for module in tool
        .proof_modules
        .iter()
        .chain(tool.proofs.iter().map(|p| &p.module))
    {
        ensure!(
            modules.contains(module),
            "Proof module {module} is not a local package source"
        );
    }
    let manifest_path = tool
        .translation_manifest
        .as_deref()
        .unwrap_or(Path::new("translation.json"));
    let manifest = if !tool.proof_modules.is_empty() {
        let file = local_source(&dir, manifest_path)
            .context("Read committed Aeneas translation manifest")?;
        let bytes = fs::read(file)?;
        ensure!(
            bytes.len() <= 8 * 1024 * 1024,
            "Translation manifest exceeds 8 MiB"
        );
        let value: Value = serde_json::from_slice(&bytes)?;
        ensure!(
            value["crate"] == project.lib_name && value["functions"].is_array(),
            "Translation manifest crate/functions mismatch"
        );
        Some((value, crate::state::digest(&String::from_utf8(bytes)?)))
    } else {
        None
    };
    let mut source = probe_source(tool, &modules);
    let mut child = Command::new("lake")
        .args(["env", "lean", "--stdin"])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut input = child.stdin.take().context("Missing probe stdin")?;
    let source_copy = source.clone();
    let writer = std::thread::spawn(move || input.write_all(source_copy.as_bytes()));
    let output = child.wait_with_output()?;
    writer
        .join()
        .map_err(|_| anyhow::anyhow!("Probe writer failed"))??;
    let stdout = String::from_utf8(output.stdout)?;
    let mut stderr = String::from_utf8(output.stderr)?;
    ensure!(
        output.status.success(),
        "Lean formal extraction failed:\n{stdout}\n{stderr}"
    );
    let public = scan::public_contracts(project, false, CreusotTarget::All)?;
    let mut candidates = std::collections::BTreeMap::<String, Vec<crate::record::Contract>>::new();
    let mut observed = BTreeSet::new();
    for line in stdout
        .lines()
        .filter_map(|l| l.strip_prefix("proofs.rs:formal:"))
    {
        let mut formal: Value = serde_json::from_str(line)?;
        let theorem = formal["theorem"]
            .as_str()
            .context("Missing theorem")?
            .to_owned();
        ensure!(
            observed.insert(theorem.clone()),
            "Duplicate extracted theorem {theorem}"
        );
        let manual = tool.proofs.iter().find(|p| p.theorem == theorem);
        let mut provenance = Value::Null;
        let api = if let Some(proof) = manual {
            ensure!(
                formal["module"] == proof.module,
                "Explicit theorem module mismatch: {theorem}"
            );
            proof.api.clone()
        } else {
            let head = formal["program_head"].as_str().unwrap_or("");
            let Some((manifest, sha)) = &manifest else {
                continue;
            };
            let entries: Vec<_> = manifest["functions"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|f| f["lean_name"] == head)
                .collect();
            if entries.len() != 1 {
                stderr.push_str(&format!("Unresolved specification {theorem}: program head {head} has {} manifest entries\n", entries.len()));
                continue;
            }
            let entry = entries[0];
            if !entry["loop"].is_null() || !entry["parent_lean_name"].is_null() {
                stderr.push_str(&format!(
                    "Unresolved specification {theorem}: loop helper belongs to {}\n",
                    entry["parent_lean_name"]
                ));
                continue;
            }
            if entry["is_local"] != true {
                stderr.push_str(&format!(
                    "Unresolved specification {theorem}: external Rust function\n"
                ));
                continue;
            }
            let name = entry["rust_name"]
                .as_str()
                .context("Manifest function lacks rust_name")?;
            let api = name
                .strip_prefix(&format!("{}::", project.lib_name))
                .unwrap_or(name)
                .to_owned();
            let lean_file = entry["lean_file"]
                .as_str()
                .context("Missing generated Lean source")?;
            local_source(
                &dir,
                &manifest_path
                    .parent()
                    .unwrap_or(Path::new(""))
                    .join(lean_file),
            )?;
            provenance = json!({"path":manifest_path.to_string_lossy(),"sha256":sha,"aeneas_version":manifest["aeneas_version"],"charon_version":manifest["charon_version"],"entry":entry});
            api
        };
        let found: Vec<_> = public
            .iter()
            .filter(|c| c.api_paths.contains(&api))
            .collect();
        if found.len() != 1 {
            ensure!(
                manual.is_none(),
                "Explicit API {api} must resolve to exactly one public Rust callable"
            );
            stderr.push_str(&format!(
                "Unresolved specification {theorem}: {api} is not one public Rust callable\n"
            ));
            continue;
        }
        for definition in formal["definitions"]
            .as_array_mut()
            .context("Missing definition references")?
        {
            let module = definition["module"].as_str().unwrap_or("");
            if modules.contains(module) && !definition["source"].is_null() {
                let path = local_source(
                    &dir,
                    Path::new(&format!("{}.lean", module.replace('.', "/"))),
                )?;
                definition["source"]["file"] = json!(path
                    .strip_prefix(root.canonicalize()?)?
                    .to_string_lossy()
                    .replace('\\', "/"));
            } else {
                definition["source"] = Value::Null;
            }
        }
        let module = formal["module"]
            .as_str()
            .context("Missing theorem module")?;
        let file = local_source(
            &dir,
            Path::new(&format!("{}.lean", module.replace('.', "/"))),
        )?;
        let file = file
            .strip_prefix(root.canonicalize()?)?
            .to_string_lossy()
            .replace('\\', "/");
        let first = formal["first_line"]
            .as_u64()
            .context("Missing source position")? as usize;
        let last = formal["last_line"]
            .as_u64()
            .context("Missing source position")? as usize;
        formal.as_object_mut().unwrap().remove("first_line");
        formal.as_object_mut().unwrap().remove("last_line");
        formal["source"] = json!({"file":file,"first_line":first,"last_line":last});
        formal["mapping"] = json!(if manual.is_some() {
            "manual"
        } else {
            "manifest"
        });
        formal["manifest"] = provenance;
        candidates
            .entry(found[0].api_paths[0].clone())
            .or_default()
            .push(crate::record::Contract {
                api_paths: found[0]
                    .api_paths
                    .iter()
                    .map(|p| crate::record::qualify_api_path(&project.lib_name, p))
                    .collect(),
                precondition: manual.map(|p| p.precondition.clone()).unwrap_or_default(),
                file,
                first_line: first,
                last_line: last,
                harness: theorem,
                formal: Some(formal),
            });
    }
    for proof in &tool.proofs {
        ensure!(
            observed.contains(&proof.theorem),
            "Missing explicit theorem {}",
            proof.theorem
        );
    }
    let mut selected = vec![];
    for contract in candidates.into_values().flatten() {
        let axioms = contract.formal.as_ref().unwrap()["axioms"]
            .as_array()
            .context("Missing axiom audit")?;
        ensure!(
            axioms.iter().all(|a| matches!(
                a.as_str(),
                Some("propext" | "Classical.choice" | "Quot.sound")
            )),
            "Unapproved axiom in {}: {:?}",
            contract.harness,
            axioms
        );
        selected.push(contract);
    }
    ensure!(
        !selected.is_empty(),
        "No publishable Aeneas specifications\n{stderr}"
    );
    ensure!(
        selected.len() <= crate::MAX_REPORT_CLAIMS,
        "More than 200 selected specifications"
    );
    eprint!("{stderr}");
    let replay = Tool {
        proofs: selected
            .iter()
            .map(|c| Proof {
                api: c.api_paths[0].clone(),
                module: c.formal.as_ref().unwrap()["module"]
                    .as_str()
                    .unwrap()
                    .into(),
                theorem: c.harness.clone(),
                precondition: c.precondition.clone(),
            })
            .collect(),
        ..Tool::default()
    };
    source.push_str(
        audit_source(&replay)
            .split_once("open Lean Elab Command\n")
            .unwrap()
            .1,
    );
    Ok((selected, stdout, stderr, source))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tool() -> Tool {
        toml::from_str(&format!("name='aeneas'\nversion='{}'\n[[proofs]]\napi='f'\nmodule='Proofs.F'\ntheorem='demo.f_spec'\nprecondition='x > 0'", "a".repeat(40))).unwrap()
    }
    #[test]
    fn report_mapping_limit() {
        let mut t = tool();
        t.proofs = (0..crate::MAX_REPORT_CLAIMS)
            .map(|i| Proof {
                api: format!("f{i}"),
                module: "Proofs".into(),
                theorem: format!("Proofs.f{i}"),
                precondition: "true".into(),
            })
            .collect();
        assert!(validate(&t).is_ok());
        t.proofs.push(Proof {
            api: "extra".into(),
            module: "Proofs".into(),
            theorem: "Proofs.extra".into(),
            precondition: "true".into(),
        });
        assert!(validate(&t)
            .unwrap_err()
            .to_string()
            .contains("At most 200"));
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
        t.proofs[1].theorem = "demo.f_other_spec".into();
        assert!(validate(&t).is_ok());
        let mut t = tool();
        t.lean_dir = Some("../outside".into());
        assert!(validate(&t).is_err());
        let mut t = tool();
        t.version = "main".into();
        assert!(validate(&t).is_err());
        let mut t = tool();
        t.proof_modules = vec!["Proofs\nimport Bad".into()];
        assert!(validate(&t).is_err());
        t.proof_modules = vec!["Proofs".into()];
        t.translation_manifest = Some("../outside.json".into());
        assert!(validate(&t).is_err());
        t.translation_manifest = Some("Generated/translation.json".into());
        t.proofs[0].precondition.clear();
        assert!(validate(&t).is_ok());
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
    #[ignore = "requires pinned Lean and Aeneas; runs in Lean audit CI"]
    fn real_formal_extraction() {
        let d = tempfile::tempdir().unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/aeneas-formal");
        for entry in fs::read_dir(&fixture).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_file() {
                fs::copy(entry.path(), d.path().join(entry.file_name())).unwrap();
            }
        }
        if let Ok(cache) = std::env::var("PROOFS_TEST_AENEAS_CACHE") {
            fs::create_dir(d.path().join(".lake")).unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(
                Path::new(&cache).join(".lake/packages"),
                d.path().join(".lake/packages"),
            )
            .unwrap();
        } else {
            for args in [vec!["update"], vec!["exe", "cache", "get"]] {
                assert!(Command::new("lake")
                    .args(args)
                    .current_dir(d.path())
                    .status()
                    .unwrap()
                    .success());
            }
        }
        let project = Project {
            name: "formal_fixture".into(),
            version: "0.1.0".into(),
            lib_name: "formal_fixture".into(),
            manifest: d.path().join("Cargo.toml"),
            root_source: d.path().join("lib.rs"),
            features: Default::default(),
            cfg: Default::default(),
        };
        let config: crate::config::Config =
            toml::from_str(&fs::read_to_string(fixture.join("proofs.toml")).unwrap()).unwrap();
        let mut t = config.tool;
        let build = || {
            let o = Command::new("lake")
                .args(["build", "+Proofs"])
                .current_dir(d.path())
                .output()
                .unwrap();
            assert!(
                o.status.success(),
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
        };
        build();
        let (cs, _, _, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(cs.len(), 3);
        let identity = cs
            .iter()
            .find(|c| c.harness == "Proofs.identity_spec")
            .unwrap();
        let f = identity.formal.as_ref().unwrap();
        assert_eq!(f["program_head"], "formal_fixture.identity");
        assert!(f["statement"]
            .as_str()
            .unwrap()
            .contains("Proofs.reference"));
        assert_eq!(f["binders"][1]["kind"], "hypothesis");
        let parts = f["conclusion_segments"]
            .as_array()
            .expect("tagged conclusion");
        assert_eq!(
            parts
                .iter()
                .map(|p| p["text"].as_str().unwrap())
                .collect::<String>(),
            f["conclusion"].as_str().unwrap()
        );
        assert!(parts.iter().any(|p| p["ref"] == "Proofs.reference"));
        assert!(f["definitions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["name"] == "formal_fixture.identity"
                && d["source"]["file"] == "FormalFixture.lean"));

        assert_eq!(
            f["manifest"]["entry"]["rust_name"],
            "formal_fixture::identity"
        );
        let zero = cs
            .iter()
            .find(|c| c.harness == "Proofs.other_zero")
            .unwrap();
        assert!(zero.formal.as_ref().unwrap()["program"]
            .as_str()
            .unwrap()
            .contains('0'));
        // A loop entry is never promoted to a separate public API.
        let manifest_path = d.path().join("translation.json");
        let original_manifest = fs::read_to_string(&manifest_path).unwrap();
        let mut manifest: Value = serde_json::from_str(&original_manifest).unwrap();
        manifest["functions"][1]["loop"] = json!({"id":0,"pos":[0],"is_body":false});
        manifest["functions"][1]["parent_lean_name"] = json!("formal_fixture.identity");
        fs::write(&manifest_path, manifest.to_string()).unwrap();
        let (loop_cs, _, diagnostic, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(loop_cs.len(), 2);
        assert!(diagnostic.contains("loop helper"));
        fs::write(&manifest_path, original_manifest).unwrap();
        // Explicitly assigning a theorem elsewhere suppresses its automatic mapping.
        t.proofs.push(Proof {
            api: "other".into(),
            module: "Proofs".into(),
            theorem: "Proofs.identity_spec".into(),
            precondition: "Author explanation".into(),
        });
        let (manual_cs, _, _, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(manual_cs.len(), 3);
        let mapped = manual_cs
            .iter()
            .find(|c| c.harness == "Proofs.identity_spec")
            .unwrap();
        assert_eq!(mapped.api_paths, ["formal_fixture::other"]);
        assert_eq!(mapped.precondition, "Author explanation");
        t.proofs.clear();
        let original = fs::read_to_string(d.path().join("Proofs.lean")).unwrap();
        fs::write(d.path().join("Proofs.lean"), format!("{original}\ntheorem Proofs.duplicate (x : Aeneas.Std.U32) : formal_fixture.identity x ⦃ y => y = x ⦄ := by simp [formal_fixture.identity, Aeneas.Std.WP.spec_ok]\n")).unwrap();
        build();
        let (cs, _, _, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(cs.len(), 4);
        assert_eq!(
            cs.iter()
                .filter(|c| c.api_paths[0] == "formal_fixture::identity")
                .count(),
            3
        );
        t.proofs.push(Proof {
            api: "identity".into(),
            module: "Proofs".into(),
            theorem: "Proofs.manual".into(),
            precondition: String::new(),
        });
        let (cs, _, _, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(cs.len(), 5);
        assert!(cs.iter().any(
            |c| c.harness == "Proofs.manual" && c.formal.as_ref().unwrap()["program"].is_null()
        ));
        let manual = cs.iter().find(|c| c.harness == "Proofs.manual").unwrap();
        assert!(manual.formal.as_ref().unwrap()["binders"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["kind"] == "instance"));
        let f = manual.formal.as_ref().unwrap();
        let bs = f["binders"].as_array().unwrap();
        assert_eq!(
            bs.iter()
                .map(|b| b["kind"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["variable", "instance", "variable"]
        );
        assert_eq!(bs[2]["name"], "reference");
        assert_eq!(bs[2]["type"], "α");
        assert!(f["conclusion_segments"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["ref"] != "Proofs.reference"));
        t.proofs.push(Proof {
            api: "identity".into(),
            module: "Proofs".into(),
            theorem: "Proofs.duplicate".into(),
            precondition: "true".into(),
        });
        validate(&t).unwrap();
        let (cs, _, _, _) = extract(&project, &t, d.path()).unwrap();
        assert_eq!(cs.len(), 5);
        assert_eq!(
            cs.iter()
                .filter(|c| c.formal.as_ref().unwrap()["mapping"] == "manual")
                .count(),
            2
        );
        t.proofs.pop();
        for theorem in ["Proofs.missing", "Proofs.reference"] {
            t.proofs[0].theorem = theorem.into();
            assert!(extract(&project, &t, d.path()).is_err());
        }
        t.proofs[0].theorem = "Proofs.bad".into();
        fs::write(
            d.path().join("Proofs.lean"),
            format!("{original}\ntheorem Proofs.bad : False := by sorry\n"),
        )
        .unwrap();
        build();
        assert!(extract(&project, &t, d.path())
            .unwrap_err()
            .to_string()
            .contains("Unapproved axiom"));
    }

    #[test]
    #[ignore = "requires Lean on PATH; exercised by the Lean audit CI job"]
    fn real_lean_checks_theorems_and_transitive_axioms() {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("lean-toolchain"),
            "leanprover/lean4:v4.35.0\n",
        )
        .unwrap();
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
            assert!(build.status.success(), "{body}\nstatus: {}\nstdout:\n{}\nstderr:\n{}", build.status, String::from_utf8_lossy(&build.stdout), String::from_utf8_lossy(&build.stderr));
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
    #[test]
    #[ignore = "requires pinned Lean, Lake and network; exercised by Lean audit CI"]
    fn real_aeneas_checks_theorems_and_transitive_axioms() {
        let d = tempfile::tempdir().unwrap();
        let mut t = tool();
        t.version = "be86ab0f1989d04944292b345b24c435be3ad10a".into();
        t.proofs[0].module = "Proofs".into();
        fs::write(
            d.path().join("lean-toolchain"),
            "leanprover/lean4:v4.35.0\n",
        )
        .unwrap();
        fs::write(d.path().join("lakefile.toml"), format!(
            "name = \"audit-fixture\"\n[[lean_lib]]\nname = \"Proofs\"\n[[require]]\nname = \"aeneas\"\ngit = {{ url = \"https://github.com/AeneasVerif/aeneas\", subDir = \"backends/lean\" }}\nrev = \"{}\"\n", t.version)).unwrap();
        fs::write(
            d.path().join("Proofs.lean"),
            "import Aeneas\ntheorem demo.f_spec : True := by trivial\n",
        )
        .unwrap();
        // Local runs and CI can share freshly prepared pinned dependencies.
        // Each test still builds and audits its own proof sources.
        if let Ok(cache) = std::env::var("PROOFS_TEST_AENEAS_CACHE") {
            fs::copy(
                Path::new(&cache).join("lake-manifest.json"),
                d.path().join("lake-manifest.json"),
            )
            .unwrap();
            #[cfg(unix)]
            {
                fs::create_dir(d.path().join(".lake")).unwrap();
                std::os::unix::fs::symlink(
                    Path::new(&cache).join(".lake/packages"),
                    d.path().join(".lake/packages"),
                )
                .unwrap();
            }
        } else {
            for args in [vec!["update"], vec!["exe", "cache", "get"]] {
                let out = Command::new("lake")
                    .args(args)
                    .current_dir(d.path())
                    .output()
                    .unwrap();
                assert!(
                    out.status.success(),
                    "{}\n{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
            }
        }
        pinned_version(d.path(), &t.version).unwrap();
        for (body, success) in [
            ("theorem demo.f_spec : True := by trivial", true),
            ("theorem demo.f_spec : True := by sorry", false),
            ("axiom bad : False\ntheorem helper : False := bad\ntheorem demo.f_spec : False := helper", false),
            ("def demo.f_spec : Nat := 0", false),
            ("theorem other : True := by trivial", false),
        ] {
            fs::write(d.path().join("Proofs.lean"), format!("import Aeneas\n{body}\n")).unwrap();
            let build = Command::new("lake").args(["build", "+Proofs"]).current_dir(d.path()).output().unwrap();
            assert!(build.status.success(), "{}\n{}", String::from_utf8_lossy(&build.stdout), String::from_utf8_lossy(&build.stderr));
            let result = audit(d.path(), &t);
            assert_eq!(result.is_ok(), success, "{body}: {result:?}");
        }
    }
}

pub const REPOSITORY: &str = "https://github.com/AeneasVerif/aeneas";
const MANAGED: &str = ".proofs-toolchain/aeneas";

/// Static validation must also work before prepare (and after deleting managed sources).
pub fn dependency(dir: &Path, tool: &Tool) -> Result<()> {
    if tool.patch.is_none() {
        return pinned_version(dir, &tool.version);
    }
    let manifest: Value = serde_json::from_slice(&fs::read(dir.join("lake-manifest.json"))?)?;
    let packages = manifest["packages"]
        .as_array()
        .context("Missing Lake packages")?;
    let matches: Vec<_> = packages.iter().filter(|p| p["name"] == "aeneas").collect();
    ensure!(matches.len() == 1 && matches[0]["type"] == "path"
        && matches[0]["dir"] == format!("{MANAGED}/backends/lean"),
        "Patched Aeneas requires Lake path .proofs-toolchain/aeneas/backends/lean; run prepare then lake update");
    ensure!(
        dir.join("lean-toolchain").is_file(),
        "Commit lean-toolchain"
    );
    Ok(())
}

pub fn input_fingerprint(project: &Project, tool: &Tool) -> Result<Value> {
    let package = project.manifest.parent().context("Missing package")?;
    let root = PathBuf::from(crate::git::run(package, &["rev-parse", "--show-toplevel"])?);
    let (path, bytes) = crate::toolchain::patch_bytes(
        package,
        tool.patch.as_deref().context("Missing patch")?,
        &root,
    )?;
    let dir = directory(project, tool)?;
    dependency(&dir, tool)?;
    let mut inputs = std::collections::BTreeMap::new();
    for name in [
        "lean-toolchain",
        "lakefile.toml",
        "lakefile.lean",
        "lake-manifest.json",
    ] {
        if dir.join(name).exists() {
            inputs.insert(name, crate::toolchain::digest(&fs::read(dir.join(name))?));
        }
    }
    // Hash source inputs directly, without restoring tools. Editorial prose remains reusable.
    let mut source_inputs = std::collections::BTreeMap::new();
    let tracked = crate::git::run(&root, &["ls-files", "-z"])?;
    for path in tracked.split('\0').filter(|p| !p.is_empty()) {
        let p = Path::new(path);
        if p.file_name().is_some_and(|s| s == "proofs.toml") {
            continue;
        }
        if p.file_name().is_some_and(|n| {
            [
                ".gitignore",
                ".ignore",
                ".gitmodules",
                "config",
                "rust-toolchain",
            ]
            .iter()
            .any(|x| n == *x)
        }) || p.extension().is_some_and(|e| {
            ["rs", "lean", "toml", "lock", "json"]
                .iter()
                .any(|x| e == *x)
        }) {
            source_inputs.insert(
                path.to_owned(),
                crate::toolchain::digest(&fs::read(root.join(p))?),
            );
        }
    }
    fn lean_sources(
        root: &Path,
        dir: &Path,
        out: &mut std::collections::BTreeMap<String, String>,
    ) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let p = entry.path();
            if [".git", ".lake", ".proofs-toolchain", "target"]
                .iter()
                .any(|n| entry.file_name() == *n)
            {
                continue;
            }
            if entry.file_type()?.is_dir() {
                lean_sources(root, &p, out)?;
            } else if p.extension().is_some_and(|e| e == "lean") {
                ensure!(
                    !entry.file_type()?.is_symlink(),
                    "Proof Lean sources must not be symlinks"
                );
                out.insert(
                    p.strip_prefix(root)?.to_string_lossy().into_owned(),
                    crate::toolchain::digest(&fs::read(&p)?),
                );
            }
        }
        Ok(())
    }
    lean_sources(&root, &dir, &mut source_inputs)?;
    Ok(
        json!({"base_commit":tool.version.to_ascii_lowercase(), "patch_path":path,
        "patch_sha256":crate::toolchain::digest(&bytes), "configuration":configuration(tool)?,
        "manifest_path":project.manifest.strip_prefix(root)?.to_string_lossy(), "inputs":inputs, "sources":source_inputs}),
    )
}

pub fn prepare_project(args: &crate::ProjectArgs) -> Result<()> {
    let project = Project::load(args)?;
    let config = project.config()?;
    ensure!(
        config.tool.is_aeneas() && config.tool.patch.is_some(),
        "prepare requires [tool].name = aeneas and [tool].patch"
    );
    let prepared = prepare_source(&project, &config.tool)?;
    println!(
        "Prepared Aeneas {} + patch {} at {} (tree {})",
        &prepared.base_commit[..12],
        &prepared.patch_sha256[..12],
        prepared.path.display(),
        prepared.tree
    );
    Ok(())
}

pub fn prepare_source(project: &Project, tool: &Tool) -> Result<crate::toolchain::PreparedSource> {
    let package = project.manifest.parent().context("Missing package")?;
    let root = PathBuf::from(crate::git::run(package, &["rev-parse", "--show-toplevel"])?);
    let (_, bytes) = crate::toolchain::patch_bytes(
        package,
        tool.patch.as_deref().context("Missing patch")?,
        &root,
    )?;
    let dir = directory(project, tool)?;
    let destination = dir.join(MANAGED);
    // Refuse tracked managed checkouts, including before the destination exists.
    let relative = destination.strip_prefix(&root)?;
    ensure!(
        crate::git::run(
            &root,
            &[
                "ls-files",
                "--",
                relative.to_str().context("Non UTF8 path")?
            ]
        )?
        .is_empty(),
        "Managed toolchain sources must not be tracked; add .proofs-toolchain/ to .gitignore"
    );
    ensure!(
        Command::new("git")
            .current_dir(&root)
            .args(["check-ignore", "-q", "--"])
            .arg(&destination)
            .status()?
            .success(),
        "Add .proofs-toolchain/ to the Lean directory's .gitignore before prepare"
    );
    // Capture official pins before restoration applies a patch, using Git object contents afterward.
    let prepared = crate::toolchain::prepare(REPOSITORY, &tool.version, &bytes, &destination)?;
    validate_source_pins(&prepared, &dir, tool)?;
    Ok(prepared)
}

fn validate_source_pins(
    prepared: &crate::toolchain::PreparedSource,
    dir: &Path,
    tool: &Tool,
) -> Result<()> {
    for path in [
        "charon-pin",
        "backends/lean/lean-toolchain",
        "backends/lean/lakefile.lean",
        "backends/lean/lakefile.toml",
    ] {
        let base = Command::new("git")
            .current_dir(&prepared.path)
            .args(["show", &format!("{}:{path}", tool.version)])
            .output()?;
        if base.status.success() {
            ensure!(fs::read(prepared.path.join(path))? == base.stdout,
                "Patch must preserve official Aeneas pin and Lake package/dependency configuration: {path}");
        } else {
            ensure!(
                !prepared.path.join(path).exists(),
                "Patch cannot add Aeneas Lake configuration {path}"
            );
        }
    }
    let release = fs::read_to_string(prepared.path.join("backends/lean/lean-toolchain"))?;
    ensure!(
        fs::read_to_string(dir.join("lean-toolchain"))?.trim() == release.trim(),
        "Proof lean-toolchain must match the official Aeneas base release"
    );
    ensure!(
        prepared.path.join("backends/lean/Aeneas.lean").is_file(),
        "Aeneas package layout must be preserved"
    );
    Ok(())
}

pub fn observed_toolchain(
    project: &Project,
    tool: &Tool,
    prepared: &crate::toolchain::PreparedSource,
) -> Result<Value> {
    let dir = directory(project, tool)?;
    dependency(&dir, tool)?;
    let release = fs::read_to_string(prepared.path.join("backends/lean/lean-toolchain"))?
        .trim()
        .to_owned();
    let pin = fs::read_to_string(prepared.path.join("charon-pin"))?;
    let pins: Vec<_> = pin
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.starts_with('#'))
        .collect();
    ensure!(
        pins.len() == 1,
        "Official charon-pin must contain one commit"
    );
    let charon = crate::toolchain::sha(pins[0])?;
    let version = Command::new("lake")
        .args(["env", "lean", "--version"])
        .current_dir(&dir)
        .output()?;
    ensure!(
        version.status.success(),
        "Cannot observe Lean version in proof checking environment"
    );
    let reported = String::from_utf8(version.stdout)?.trim().to_owned();
    let expected = release
        .strip_prefix("leanprover/lean4:v")
        .context("Official Lean release must use leanprover/lean4:v...")?;
    ensure!(
        reported
            .split(|c: char| c.is_whitespace() || c == ',' || c == ')')
            .any(|s| s == expected),
        "Selected Lean differs from official base {release}: {reported}"
    );
    // Lake evaluates its configuration here; inspect the actual search path it passes to Lean.
    let resolved = Command::new("lake")
        .args(["env", "printenv", "LEAN_PATH"])
        .current_dir(&dir)
        .output()?;
    ensure!(
        resolved.status.success(),
        "Cannot inspect Lake's resolved Lean dependency path"
    );
    let expected_path = prepared.path.join("backends/lean/.lake/build/lib/lean");
    let expected_path = expected_path
        .canonicalize()
        .context("Build managed Aeneas dependency before recording its resolution")?;
    ensure!(
        expected_path.starts_with(prepared.path.canonicalize()?),
        "Managed build output escapes prepared source"
    );
    let paths = String::from_utf8(resolved.stdout)?;
    let mut found = false;
    for path in std::env::split_paths(paths.trim()) {
        let absolute = if path.is_absolute() {
            path
        } else {
            dir.join(path)
        };
        if let Ok(p) = absolute.canonicalize() {
            if p == expected_path {
                found = true;
            } else {
                ensure!(
                    !p.join("Aeneas.olean").exists() && !p.join("Aeneas").exists(),
                    "Lake resolves a different Aeneas dependency"
                );
            }
        }
    }
    ensure!(
        found,
        "Lake did not resolve the prepared Aeneas Lean library"
    );
    let fp = input_fingerprint(project, tool)?;
    Ok(json!({"schema_version":1,"components":{
        "aeneas":{"tool":"aeneas","source":{"kind":"git_patch","repository":REPOSITORY,"base_commit":prepared.base_commit,"patch":{"path":fp["patch_path"],"sha256":prepared.patch_sha256}},"materialized":{"git_tree":prepared.tree}},
        "charon":{"tool":"charon","source":{"kind":"git","repository":"https://github.com/AeneasVerif/charon","commit":charon}},
        "lean":{"tool":"lean","source":{"kind":"release","release_id":release}}},
        "uses":[{"component":"aeneas","role":"lean_library","observation":{"kind":"dependency_resolved","dependency_name":"aeneas","subdirectory":"backends/lean"}},
        {"component":"aeneas","role":"translator","observation":{"kind":"not_run"}},
        {"component":"charon","role":"rust_frontend","observation":{"kind":"not_run"}},
        {"component":"lean","role":"proof_checker","observation":{"kind":"process_executed","reported_version":reported}}]}))
}

#[cfg(test)]
mod patch_tests {
    use super::*;
    fn g(path: &Path, args: &[&str]) -> String {
        crate::git::run(path, args).unwrap()
    }
    #[test]
    fn official_pins_configuration_and_proof_lean_must_match() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let upstream = root.join("upstream");
        fs::create_dir_all(upstream.join("backends/lean")).unwrap();
        fs::write(
            upstream.join("charon-pin"),
            "# Charon\n1111111111111111111111111111111111111111\n",
        )
        .unwrap();
        fs::write(
            upstream.join("backends/lean/lean-toolchain"),
            "leanprover/lean4:v4.35.0\n",
        )
        .unwrap();
        fs::write(
            upstream.join("backends/lean/lakefile.lean"),
            "package aeneas\n",
        )
        .unwrap();
        fs::write(
            upstream.join("backends/lean/Aeneas.lean"),
            "def original := 0\n",
        )
        .unwrap();
        g(&upstream, &["init", "-q"]);
        g(&upstream, &["add", "."]);
        g(
            &upstream,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-qm",
                "fixture",
            ],
        );
        let tool = Tool {
            version: g(&upstream, &["rev-parse", "HEAD"]),
            ..Tool::default()
        };
        fs::write(root.join("lean-toolchain"), "leanprover/lean4:v4.35.0\n").unwrap();
        for (i, path) in [
            "backends/lean/Aeneas.lean",
            "charon-pin",
            "backends/lean/lean-toolchain",
            "backends/lean/lakefile.lean",
        ]
        .iter()
        .enumerate()
        {
            g(&upstream, &["reset", "--hard", "HEAD"]);
            fs::write(upstream.join(path), "changed\n").unwrap();
            let bytes = Command::new("git")
                .current_dir(&upstream)
                .args(["diff", "--binary", "HEAD", "--"])
                .output()
                .unwrap()
                .stdout;
            let prepared = crate::toolchain::prepare(
                upstream.to_str().unwrap(),
                &tool.version,
                &bytes,
                &root.join(format!("source{i}")),
            )
            .unwrap();
            assert_eq!(
                validate_source_pins(&prepared, &root, &tool).is_ok(),
                i == 0,
                "{path}"
            );
            if i == 0 {
                fs::write(root.join("lean-toolchain"), "leanprover/lean4:v4.32.0\n").unwrap();
                assert!(validate_source_pins(&prepared, &root, &tool).is_err());
                fs::write(root.join("lean-toolchain"), "leanprover/lean4:v4.35.0\n").unwrap();
            }
        }
    }
    #[test]
    fn reuse_fingerprints_work_without_materialized_sources_and_change_with_patch_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers=['nested/member']\nresolver='2'\n",
        )
        .unwrap();
        let package = root.join("nested/member");
        let lean = package.join("proofs");
        fs::create_dir_all(package.join("src")).unwrap();
        fs::create_dir_all(&lean).unwrap();
        fs::write(package.join("src/lib.rs"), "pub fn f() {}\n").unwrap();
        fs::write(
            package.join("Cargo.toml"),
            "[package]\nname='test-patch-input'\nversion='1.0.0'\nedition='2021'\n",
        )
        .unwrap();
        fs::write(lean.join("lean-toolchain"), "leanprover/lean4:v4.35.0\n").unwrap();
        fs::write(lean.join("lakefile.toml"), "name='test'\n").unwrap();
        fs::write(lean.join("lake-manifest.json"), r#"{"packages":[{"name":"aeneas","type":"path","dir":".proofs-toolchain/aeneas/backends/lean"}]}"#).unwrap();
        fs::write(lean.join("a.patch"), "first bytes").unwrap();
        g(&root, &["init", "-q"]);
        g(&root, &["add", "."]);
        let project = Project::load(&crate::ProjectArgs {
            manifest_path: Some(package.join("Cargo.toml")),
            ..Default::default()
        })
        .unwrap();
        let tool = Tool {
            name: "aeneas".into(),
            version: "a".repeat(40),
            patch: Some("proofs/a.patch".into()),
            lean_dir: Some("proofs".into()),
            ..Default::default()
        };
        let initial = input_fingerprint(&project, &tool).unwrap();
        assert_eq!(initial["patch_path"], "nested/member/proofs/a.patch");
        assert_eq!(initial["manifest_path"], "nested/member/Cargo.toml");
        assert!(!lean.join(MANAGED).exists());
        assert_eq!(initial, input_fingerprint(&project, &tool).unwrap());
        fs::write(lean.join("a.patch"), "second bytes").unwrap();
        assert_ne!(initial, input_fingerprint(&project, &tool).unwrap());
        fs::write(
            lean.join("lake-manifest.json"),
            r#"{"packages":[{"name":"aeneas","type":"path","dir":"elsewhere"}]}"#,
        )
        .unwrap();
        assert!(dependency(&lean, &tool).is_err());
    }
}
