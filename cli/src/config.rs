use crate::ProjectArgs;
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

// Cargo may canonicalize aliases such as macOS /var -> /private/var.
// Compare canonical paths rather than the spelling of existing paths.
pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
    left.canonicalize()
        .ok()
        .zip(right.canonicalize().ok())
        .is_some_and(|(left, right)| left == right)
}

#[derive(Default, Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub findings: Vec<Finding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trusted_assumptions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limitations: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub api_paths: Vec<String>,
    pub title: String,
    pub body: String,
}
impl Report {
    pub fn validate(&self) -> Result<()> {
        ensure!(!self.title.trim().is_empty(), "[report].title is required");
        ensure!(
            self.findings.len() <= 20,
            "At most 20 report.findings are allowed"
        );
        for (index, finding) in self.findings.iter().enumerate() {
            ensure!(
                finding.api_paths.len() <= 50,
                "At most 50 API paths per finding are allowed"
            );
            ensure!(
                finding.api_paths.iter().all(|p| !p.trim().is_empty()),
                "Finding API paths must not be empty"
            );
            for (name, value, limit) in [
                ("title", &finding.title, 1000),
                ("body", &finding.body, 10000),
            ] {
                // Match the service's JavaScript string-length limit.
                ensure!(
                    !value.trim().is_empty() && value.trim().encode_utf16().count() <= limit,
                    "report.findings[{}].{name} must contain 1–{limit} characters",
                    index + 1
                );
            }
        }
        Ok(())
    }
}
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    /// Check explicitly mapped concrete root-type APIs with the Rust compiler.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub concrete_api: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charon_patch: Option<PathBuf>,
    /// Expand Rust macros for public API discovery using the selected native compiler.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub expand_api: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<PathBuf>,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<CreusotTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lean_dir: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub proofs: Vec<crate::aeneas::Proof>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub proof_modules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation_manifest: Option<PathBuf>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, clap::ValueEnum, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CreusotTarget {
    Annotated,
    All,
}
impl Tool {
    pub fn has_patches(&self) -> bool {
        self.patch.is_some() || self.charon_patch.is_some()
    }
    pub fn is_aeneas(&self) -> bool {
        self.name.eq_ignore_ascii_case("aeneas")
    }
    pub fn is_creusot(&self) -> bool {
        self.name.eq_ignore_ascii_case("creusot")
    }
    fn validate(&self) -> Result<()> {
        ensure!(
            self.is_aeneas() || self.is_creusot() || self.name.eq_ignore_ascii_case("kani"),
            "Supported tools: kani, creusot, aeneas"
        );
        ensure!(
            !self.version.trim().is_empty(),
            "[tool].version is required"
        );
        ensure!(
            self.is_aeneas()
                || (self.lean_dir.is_none()
                    && self.proofs.is_empty()
                    && self.proof_modules.is_empty()
                    && self.translation_manifest.is_none()
                    && !self.expand_api
                    && !self.concrete_api),
            "Lean proof and API discovery options apply only to Aeneas"
        );
        ensure!(
            (self.patch.is_none() && self.charon_patch.is_none()) || self.is_aeneas(),
            "[tool].patch is currently supported only for Aeneas"
        );
        if self.is_aeneas() {
            crate::aeneas::validate(self)?;
        }
        if self.is_creusot() {
            ensure!(
                self.target.is_some(),
                "Creusot requires [tool].target = \"annotated\" or \"all\""
            );
        } else {
            ensure!(
                self.target.is_none(),
                "[tool].target applies only to Creusot"
            );
        }
        Ok(())
    }
}
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Git {
    pub remote: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DependencyReview {
    pub report: std::num::NonZeroU64,
    pub revision: std::num::NonZeroU64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub report: Report,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<BTreeMap<String, DependencyReview>>,
    pub tool: Tool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git: Option<Git>,
}
pub struct Project {
    pub config_override: Option<PathBuf>,
    pub name: String,
    pub version: String,
    pub lib_name: String,
    pub manifest: PathBuf,
    pub root_source: PathBuf,
    pub features: BTreeSet<String>,
    pub cfg: BTreeSet<String>,
}
impl Project {
    pub fn load(args: &ProjectArgs) -> Result<Self> {
        if let Some(path) = &args.proofs_config {
            ensure!(
                !path.is_absolute()
                    && path
                        .components()
                        .all(|c| matches!(c, std::path::Component::Normal(_))),
                "--proofs-config must stay within the package"
            );
        }
        let mut command = Command::new("cargo");
        command.args(["metadata", "--format-version", "1", "--no-deps"]);
        if let Some(path) = &args.manifest_path {
            command.arg("--manifest-path").arg(path);
        }
        let output = command
            .output()
            .context("Run cargo metadata; install Rust/Cargo first")?;
        ensure!(
            output.status.success(),
            "cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let meta: Value = serde_json::from_slice(&output.stdout)?;
        let packages = meta["packages"].as_array().context("Missing packages")?;
        let requested = if let Some(path) = &args.manifest_path {
            Some(path.canonicalize()?)
        } else {
            let mut cwd = std::env::current_dir()?;
            loop {
                if cwd.join("Cargo.toml").exists() {
                    break Some(cwd.join("Cargo.toml").canonicalize()?);
                }
                if !cwd.pop() {
                    break None;
                }
            }
        };
        let mut candidates: Vec<&Value> = packages
            .iter()
            .filter(|p| {
                if let Some(name) = &args.package {
                    return p["name"].as_str() == Some(name);
                }
                requested.as_ref().is_some_and(|path| {
                    p["manifest_path"]
                        .as_str()
                        .is_some_and(|s| same_path(Path::new(s), path))
                })
            })
            .collect();
        if candidates.is_empty() && args.package.is_none() && packages.len() == 1 {
            candidates.push(&packages[0]);
        }
        ensure!(
            candidates.len() == 1,
            "Select exactly one workspace package with -p NAME"
        );
        let p = candidates[0];
        let target = p["targets"]
            .as_array()
            .context("Missing targets")?
            .iter()
            .find(|t| {
                t["kind"].as_array().is_some_and(|ks| {
                    ks.iter().any(|k| {
                        matches!(k.as_str(), Some("lib" | "rlib" | "cdylib" | "staticlib"))
                    })
                })
            })
            .context("The selected package must have a library target")?;
        let feature_map = p["features"].as_object().context("Missing feature map")?;
        let mut features = BTreeSet::new();
        let mut queue = args.features.clone();
        if args.all_features {
            queue.extend(feature_map.keys().cloned());
        }
        if !args.no_default_features && feature_map.contains_key("default") {
            queue.push("default".into());
        }
        while let Some(f) = queue.pop() {
            if f.starts_with("dep:") || f.contains('/') {
                continue;
            }
            let values = feature_map
                .get(&f)
                .with_context(|| format!("Unknown package feature {f}"))?;
            if features.insert(f) {
                queue.extend(
                    values
                        .as_array()
                        .context("Invalid feature list")?
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from)),
                );
            }
        }
        let mut rustc = Command::new("rustc");
        rustc.args(["--print", "cfg"]);
        if let Some(t) = &args.target {
            rustc.args(["--target", t]);
        }
        let out = rustc.output().context("Run rustc --print cfg")?;
        ensure!(
            out.status.success(),
            "rustc --print cfg failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let cfg = String::from_utf8(out.stdout)?
            .lines()
            .map(String::from)
            .collect();
        Ok(Self {
            config_override: args.proofs_config.clone(),
            name: p["name"].as_str().context("Missing crate name")?.into(),
            version: p["version"].as_str().context("Missing version")?.into(),
            lib_name: target["name"]
                .as_str()
                .context("Missing library name")?
                .into(),
            manifest: PathBuf::from(p["manifest_path"].as_str().context("Missing manifest")?)
                .canonicalize()?,
            root_source: PathBuf::from(
                target["src_path"]
                    .as_str()
                    .context("Missing library source")?,
            )
            .canonicalize()?,
            features,
            cfg,
        })
    }
    pub fn config_path(&self) -> PathBuf {
        self.config_override
            .as_ref()
            .map(|p| self.manifest.parent().unwrap().join(p))
            .unwrap_or_else(|| self.manifest.with_file_name("proofs.toml"))
    }
    pub fn config(&self) -> Result<Config> {
        Config::read(&self.config_path())
    }
}
impl Config {
    pub fn read(path: &Path) -> Result<Self> {
        let mut config: Config = toml::from_str(
            &fs::read_to_string(path).with_context(|| format!("Read {}", path.display()))?,
        )?;
        if config.tool.is_aeneas() {
            config.tool.version = config.tool.version.to_ascii_lowercase();
        }
        config.report.validate()?;
        config.tool.validate()?;
        Ok(config)
    }
}
pub fn init(
    args: &ProjectArgs,
    title: Option<String>,
    version: Option<String>,
    tool: String,
    target: Option<CreusotTarget>,
) -> Result<()> {
    let project = Project::load(args)?;
    let label = match tool.as_str() {
        "creusot" => "Creusot",
        "aeneas" => "Aeneas",
        _ => "Kani",
    };
    let version = match version {
        Some(v) => v,
        None => {
            ensure!(
                tool != "aeneas",
                "Aeneas requires --tool-version with the full pinned Aeneas Git revision"
            );
            let out = Command::new("cargo")
                .args([
                    tool.as_str(),
                    if tool == "creusot" {
                        "version"
                    } else {
                        "--version"
                    },
                ])
                .output()
                .with_context(|| format!("Cannot detect {label}; pass --tool-version VERSION"))?;
            if !out.status.success() {
                bail!("Cannot detect {label}; pass --tool-version VERSION used for verification");
            }
            String::from_utf8(out.stdout)?
                .split_whitespace()
                .find(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .context("Cannot parse tool version; use --tool-version")?
                .to_owned()
        }
    };
    let config = Config {
        report: Report {
            title: title.unwrap_or_else(|| {
                format!(
                    "{label} verification of {} {}",
                    project.name, project.version
                )
            }),
            ..Report::default()
        },
        tool: Tool {
            name: tool,
            version,
            target,
            ..Tool::default()
        },
        git: None,
        dependencies: None,
    };
    config.tool.validate()?;
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(project.config_path())
        .context("Create proofs.toml (existing files are never overwritten)")?;
    file.write_all(toml::to_string_pretty(&config)?.as_bytes())?;
    println!(
        "Created {}. Review its title and the tool version used for verification.",
        project.config_path().display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn report_findings_are_optional_freeform_bounded_and_strict() {
        let base = "[report]\ntitle='Report'\n[tool]\nname='kani'\nversion='1'\n";
        let parse = |extra: &str| toml::from_str::<Config>(&format!("{base}{extra}"));
        assert!(parse("").unwrap().report.findings.is_empty());
        let valid = "[[report.findings]]\ntitle='Observation'\nbody='**Markdown** and `code`'\n";
        let cfg = parse(&valid.repeat(2)).unwrap();
        cfg.report.validate().unwrap();
        assert_eq!(cfg.report.findings.len(), 2);
        assert!(parse(&valid.repeat(21)).unwrap().report.validate().is_err());
        for invalid in [
            "[[report.findings]]\ntitle='Missing body'\n".to_owned(),
            format!("{valid}unknown='x'\n"),
        ] {
            assert!(parse(&invalid).is_err());
        }
        for (title, body) in [
            (" ".into(), "body".into()),
            ("title".into(), " ".into()),
            ("x".repeat(1001), "body".into()),
            ("title".into(), "x".repeat(10001)),
            ("title".into(), "🦀".repeat(5001)),
        ] {
            let mut cfg = parse(valid).unwrap();
            cfg.report.findings = vec![Finding {
                title,
                body,
                api_paths: vec![],
            }];
            assert!(cfg.report.validate().is_err());
        }
    }
    #[test]
    fn dependency_reviews_are_optional_strict_and_positive() {
        let base = "[report]\ntitle='Local'\n[tool]\nname='kani'\nversion='1'\n";
        assert!(toml::from_str::<Config>(base)
            .unwrap()
            .dependencies
            .is_none());
        let empty: Config = toml::from_str(&format!("{base}[dependencies]\n")).unwrap();
        assert!(empty.dependencies.unwrap().is_empty());
        let config: Config = toml::from_str(&format!(
            "{base}[dependencies]\nserde={{report=123,revision=2}}\n"
        ))
        .unwrap();
        assert_eq!(config.dependencies.unwrap()["serde"].report.get(), 123);
        for review in [
            "{report=0,revision=2}",
            "{report=123,revision=0}",
            "{report=123,revision=2,version='1'}",
            "{report=123,revision=2,rationale='x'}",
        ] {
            assert!(
                toml::from_str::<Config>(&format!("{base}[dependencies]\nserde={review}\n"))
                    .is_err()
            );
        }
    }
    #[test]
    fn concrete_api_requires_aeneas_and_excludes_expansion() {
        let mut tool: Tool =
            toml::from_str("name='kani'\nversion='0.66.0'\nconcrete_api=true").unwrap();
        assert!(tool.validate().is_err());
        tool.name = "aeneas".into();
        tool.version = "a".repeat(40);
        tool.lean_dir = Some("proofs".into());
        assert!(tool.validate().is_ok());
        tool.expand_api = true;
        assert!(tool
            .validate()
            .unwrap_err()
            .to_string()
            .contains("not both"));
    }
    #[test]
    fn tool_targets() {
        let mut tool: Tool = toml::from_str("name='kani'\nversion='0.66.0'").unwrap();
        assert!(tool.validate().is_ok());
        tool.target = Some(CreusotTarget::All);
        assert!(tool.validate().is_err());
        tool.name = "creusot".into();
        assert!(tool.validate().is_ok());
        tool.target = None;
        assert!(tool.validate().is_err());
        assert!(toml::from_str::<Tool>("name='creusot'\nversion='x'\ntarget='typo'").is_err());
    }
}
