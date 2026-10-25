//! Pure report composition shared by publication and local preview.
use crate::{config::Config, state::State};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const REPORT_FIELDS: &[&str] = &[
    "crate",
    "version",
    "title",
    "explanation",
    "trusted_assumptions",
    "tool_version_id",
    "environment",
    "evidence_url",
    "limitations",
];
pub const CLAIM_FIELDS: &[&str] = &[
    "id",
    "api_item_id",
    "title",
    "precondition",
    "explanation",
    "trusted_assumptions",
    "evidence_url",
    "limitations",
];
fn text(value: &Value, key: &str) -> Value {
    Value::String(value[key].as_str().unwrap_or_default().into())
}
pub fn snapshot(report: &Value) -> Result<Value> {
    let mut value = json!({});
    for key in REPORT_FIELDS {
        value[*key] = text(report, key);
    }
    value["dependencies"] = Value::Array(report["dependencies"].as_array().into_iter().flatten().map(|dependency| json!({"crate":dependency["crate"],"report":dependency["report"],"revision":dependency["revision"]})).collect());
    value["run_ids"] = report.get("run_ids").cloned().unwrap_or_else(|| json!([]));
    value["claims"] = Value::Array(
        report["claims"]
            .as_array()
            .context("Report is missing claims")?
            .iter()
            .map(|c| {
                let mut claim = json!({});
                for key in CLAIM_FIELDS {
                    claim[*key] = text(c, key);
                }
                if let Some(r) = c.get("evidence_ref").filter(|v| !v.is_null()) {
                    claim["evidence_ref"] = r.clone();
                }
                claim
            })
            .collect(),
    );
    Ok(value)
}
pub fn key(claim: &Value) -> Result<String> {
    let api = claim["api_item_id"].as_str().context("Missing API ID")?;
    Ok(match claim["evidence_ref"]["harness"].as_str() {
        Some(theorem) => json!([api, theorem]).to_string(),
        None => api.into(),
    })
}
pub fn claims_by_key(report: &Value) -> Result<BTreeMap<String, Value>> {
    let mut claims = BTreeMap::new();
    for claim in report["claims"].as_array().context("Missing claims")? {
        ensure!(
            claims.insert(key(claim)?, claim.clone()).is_none(),
            "Multiple claims have the same API and theorem (or lack theorem references); this CLI cannot distinguish them"
        );
    }
    Ok(claims)
}
pub fn merge(config: &Config, mut generated: Value, existing: Option<&Value>) -> Result<Value> {
    config.report.validate()?;
    let mut body = if let Some(existing) = existing {
        snapshot(existing)?
    } else {
        json!({})
    };
    for field in ["crate", "version", "tool_version_id", "evidence_url"] {
        body[field] = generated[field].take();
    }
    body["run_ids"] = generated["run_ids"].take();
    body["title"] = json!(config.report.title.trim());
    for (field, value) in [
        ("explanation", &config.report.explanation),
        ("trusted_assumptions", &config.report.trusted_assumptions),
        ("limitations", &config.report.limitations),
        ("environment", &config.report.environment),
    ] {
        if let Some(value) = value {
            body[field] = json!(value);
        } else if body.get(field).is_none() {
            body[field] = json!("");
        }
    }
    if let Some(dependencies) = &config.dependencies {
        body["dependencies"] = json!(dependencies.iter().map(|(name, review)| json!({"crate":name,"report":review.report,"revision":review.revision})).collect::<Vec<_>>());
    } else if body.get("dependencies").is_none() {
        body["dependencies"] = json!([]);
    }
    let old = existing.map(claims_by_key).transpose()?.unwrap_or_default();
    let generated_claims = generated["claims"]
        .as_array()
        .context("Missing generated claims")?;
    claims_by_key(&generated)?;
    let mut claims = vec![];
    for claim in generated_claims {
        let previous = old.get(&key(claim)?).or_else(|| {
            // Preserve the existing single-claim workflow, including theorem renames
            // and migration from recordings without formal evidence. Never guess
            // which claim to reuse when either side has multiple claims for this API.
            let mut matches = old
                .values()
                .filter(|c| c["api_item_id"] == claim["api_item_id"]);
            let first = matches.next()?;
            (matches.next().is_none()
                && generated_claims
                    .iter()
                    .filter(|c| c["api_item_id"] == claim["api_item_id"])
                    .count()
                    == 1)
                .then_some(first)
        });
        let mut merged = if let Some(previous) = previous {
            let mut m = json!({});
            for f in CLAIM_FIELDS {
                m[*f] = text(previous, f);
            }
            m
        } else {
            json!({})
        };
        for f in ["api_item_id", "precondition", "evidence_url"] {
            merged[f] = claim[f].clone();
        }
        if let Some(reference) = claim.get("evidence_ref") {
            merged["evidence_ref"] = reference.clone();
            if claim["precondition"].as_str() == Some("") {
                if let Some(previous) = previous {
                    merged["precondition"] = text(previous, "precondition");
                }
            }
        } else {
            merged.as_object_mut().unwrap().remove("evidence_ref");
        }
        claims.push(merged);
    }
    body["claims"] = Value::Array(claims);
    // Findings have their own identity and history. Only create them with a new
    // Report; revisions never repost the local authoring array.
    if existing.is_none() && !config.report.findings.is_empty() {
        body["findings"] = json!(config
            .report
            .findings
            .iter()
            .map(|f| json!({"title":f.title,"body":f.body}))
            .collect::<Vec<_>>());
    }
    Ok(body)
}

/// Resolve each related API independently; aliases resolving to one ID are deduplicated.
pub fn resolve_finding_apis(
    config: &Config,
    body: &mut Value,
    mut resolve: impl FnMut(&str) -> Result<String>,
) -> Result<()> {
    if let Some(findings) = body.get_mut("findings").and_then(Value::as_array_mut) {
        for (finding, local) in findings.iter_mut().zip(&config.report.findings) {
            let mut ids = BTreeMap::new();
            for path in &local.api_paths {
                let id = resolve(path.trim())
                    .with_context(|| format!("Resolve API {path} for finding {}", local.title))?;
                ids.insert(id, ());
            }
            if !ids.is_empty() {
                finding["api_item_ids"] = json!(ids.into_keys().collect::<Vec<_>>());
            }
        }
    }
    Ok(())
}

pub fn compose(
    config: &Config,
    generated: Value,
    remote: &Option<Value>,
    saved: &State,
    selected: Option<u64>,
) -> Result<Value> {
    let mut baseline = remote.clone();
    if saved.report_id == selected {
        if let Some(baseline) = &mut baseline {
            let current = claims_by_key(baseline)?;
            for claim in saved.known_claims.values() {
                if !current.contains_key(&key(claim)?)
                    && !current.values().any(|c| c["id"] == claim["id"])
                {
                    baseline["claims"]
                        .as_array_mut()
                        .context("Missing claims")?
                        .push(claim.clone());
                }
            }
        }
    }
    merge(config, generated, baseline.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn related_finding_apis_resolve_independently_and_stay_out_of_revisions() {
        let cfg: Config = toml::from_str("[report]\ntitle='Report'\n[[report.findings]]\ntitle='Observation'\nbody='Body'\napi_paths=['sample::a','sample::alias','sample::b']\n[tool]\nname='kani'\nversion='1'\n").unwrap();
        let generated = json!({"claims":[],"run_ids":["run"]});
        let mut body = merge(&cfg, generated.clone(), None).unwrap();
        assert!(body["findings"][0].get("api_paths").is_none());
        resolve_finding_apis(&cfg, &mut body, |path| {
            Ok(if path == "sample::b" { "b" } else { "a" }.into())
        })
        .unwrap();
        assert_eq!(body["findings"][0]["api_item_ids"], json!(["a", "b"]));
        assert!(resolve_finding_apis(&cfg, &mut body, |_| anyhow::bail!("missing API")).is_err());
        let mut revision = merge(&cfg, generated, Some(&body)).unwrap();
        resolve_finding_apis(&cfg, &mut revision, |_| {
            panic!("revisions must not resolve local findings")
        })
        .unwrap();
        assert!(revision.get("findings").is_none());
    }
    #[test]
    fn findings_are_created_once_and_never_added_to_revision_payloads() {
        let cfg: Config = toml::from_str("[report]\ntitle='Report'\n[[report.findings]]\ntitle='Observation'\nbody='**Markdown**'\n[tool]\nname='kani'\nversion='1'\n").unwrap();
        let generated = json!({"claims":[],"run_ids":["run"]});
        let first = merge(&cfg, generated.clone(), None).unwrap();
        assert_eq!(first["findings"][0]["body"], "**Markdown**");
        let mut existing = first.clone();
        existing["findings"][0]["body"] = json!("Web edit");
        let revision = merge(&cfg, generated, Some(&existing)).unwrap();
        assert!(revision.get("findings").is_none());
        assert!(snapshot(&existing).unwrap().get("findings").is_none());
        assert_eq!(existing["findings"][0]["body"], "Web edit");
        assert_eq!(first["run_ids"], revision["run_ids"]);
    }
    #[test]
    fn formal_reference_updates_without_overwriting_author_prose() {
        let config: Config =
            toml::from_str("[report]\ntitle='Local'\n[tool]\nname='aeneas'\nversion='1'\n")
                .unwrap();
        let old = json!({"claims":[{"id":"stable","api_item_id":"api","precondition":"Author explanation", "evidence_ref":{"run_id":"old","harness":"Old.spec"}}]});
        let generated = json!({"claims":[{"api_item_id":"api","precondition":"", "evidence_ref":{"run_id":"new","harness":"New.spec"}}]});
        let body = merge(&config, generated, Some(&old)).unwrap();
        assert_eq!(body["claims"][0]["id"], "stable");
        assert_eq!(body["claims"][0]["precondition"], "Author explanation");
        assert_eq!(body["claims"][0]["evidence_ref"]["harness"], "New.spec");
        assert_eq!(
            snapshot(&body).unwrap()["claims"][0]["evidence_ref"],
            body["claims"][0]["evidence_ref"]
        );
        assert!(
            snapshot(&json!({"claims":[{"api_item_id":"api","evidence_ref":null}]})).unwrap()
                ["claims"][0]
                .get("evidence_ref")
                .is_none()
        );
    }
    #[test]
    fn compose_restores_known_claims_only_for_the_selected_publication() {
        let config: Config =
            toml::from_str("[report]\ntitle='Local'\n[tool]\nname='kani'\nversion='1'\n").unwrap();
        let old_claim = json!({"id":"permanent","api_item_id":"api-f","title":"Original title","explanation":"Web text"});
        let mut state = State {
            report_id: Some(8),
            ..State::default()
        };
        state.known_claims.insert("api-f".into(), old_claim);
        let remote = Some(json!({"claims":[],"explanation":"Report prose"}));
        let generated = json!({"claims":[{"api_item_id":"api-f","precondition":"new","evidence_url":"https://example.com/new"}]});
        let body = compose(&config, generated.clone(), &remote, &state, Some(8)).unwrap();
        assert_eq!(body["claims"][0]["id"], "permanent");
        assert_eq!(body["claims"][0]["explanation"], "Web text");
        assert_eq!(body["claims"][0]["precondition"], "new");
        assert_eq!(body["explanation"], "Report prose");
        let other = compose(&config, generated, &remote, &state, Some(9)).unwrap();
        assert!(other["claims"][0].get("id").is_none());
    }
    #[test]
    fn multiple_theorems_keep_their_own_ids_and_prose_across_runs() {
        let config: Config =
            toml::from_str("[report]\ntitle='Local'\n[tool]\nname='aeneas'\nversion='1'\n")
                .unwrap();
        let old = json!({"claims":[
            {"id":"first","api_item_id":"api","precondition":"first condition","explanation":"first prose","evidence_ref":{"run_id":"old","harness":"A"}},
            {"id":"second","api_item_id":"api","precondition":"second condition","explanation":"second prose","evidence_ref":{"run_id":"old","harness":"B"}}
        ]});
        let generated = json!({"claims":[
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"B"}},
            {"api_item_id":"api","precondition":"true","evidence_ref":{"run_id":"new","harness":"A"}},
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"C"}}
        ]});
        let body = merge(&config, generated, Some(&old)).unwrap();
        let claims = body["claims"].as_array().unwrap();
        assert_eq!(claims[0]["id"], "second");
        assert_eq!(claims[0]["precondition"], "second condition");
        assert_eq!(claims[0]["explanation"], "second prose");
        assert_eq!(claims[0]["evidence_ref"]["run_id"], "new");
        assert_eq!(claims[1]["id"], "first");
        assert_eq!(claims[1]["precondition"], "true");
        assert_eq!(claims[1]["explanation"], "first prose");
        assert!(claims[2].get("id").is_none());
        // Removing one theorem must not transfer its prose to a replacement.
        let replacement = json!({"claims":[
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"C"}}
        ]});
        assert!(
            merge(&config, replacement, Some(&old)).unwrap()["claims"][0]
                .get("id")
                .is_none()
        );
    }
    #[test]
    fn restores_each_theorem_and_ignores_cached_old_names_for_current_ids() {
        let config: Config =
            toml::from_str("[report]\ntitle='Local'\n[tool]\nname='aeneas'\nversion='1'\n")
                .unwrap();
        let a = json!({"id":"first","api_item_id":"api","precondition":"A prose","evidence_ref":{"run_id":"old","harness":"A"}});
        let b = json!({"id":"second","api_item_id":"api","precondition":"B prose","evidence_ref":{"run_id":"old","harness":"B"}});
        let mut saved = State {
            report_id: Some(8),
            ..State::default()
        };
        // Includes an API-only key written by the previous CLI.
        saved.known_claims.insert("api".into(), a);
        saved.known_claims.insert(key(&b).unwrap(), b.clone());
        let remote = Some(json!({"claims":[b]}));
        let generated = json!({"claims":[
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"A"}},
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"B"}}
        ]});
        let body = compose(&config, generated, &remote, &saved, Some(8)).unwrap();
        assert_eq!(body["claims"][0]["id"], "first");
        assert_eq!(body["claims"][1]["id"], "second");
        assert_eq!(body["claims"][0]["precondition"], "A prose");
        let renamed = Some(
            json!({"claims":[{"id":"first","api_item_id":"api","precondition":"Current prose","evidence_ref":{"run_id":"current","harness":"Renamed"}}]}),
        );
        let generated = json!({"claims":[{"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"A"}}]});
        let body = compose(&config, generated, &renamed, &saved, Some(8)).unwrap();
        assert!(body["claims"][0].get("id").is_none());
    }
    #[test]
    fn splitting_a_legacy_claim_does_not_guess_which_theorem_inherits_it() {
        let config: Config =
            toml::from_str("[report]\ntitle='Local'\n[tool]\nname='aeneas'\nversion='1'\n")
                .unwrap();
        let old =
            json!({"claims":[{"id":"legacy","api_item_id":"api","precondition":"legacy prose"}]});
        let generated = json!({"claims":[
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"A"}},
            {"api_item_id":"api","precondition":"","evidence_ref":{"run_id":"new","harness":"B"}}
        ]});
        let body = merge(&config, generated, Some(&old)).unwrap();
        assert!(body["claims"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.get("id").is_none()));
        let duplicate = json!({"claims":[
            {"api_item_id":"api","evidence_ref":{"run_id":"one","harness":"A"}},
            {"api_item_id":"api","evidence_ref":{"run_id":"two","harness":"A"}}
        ]});
        assert!(claims_by_key(&duplicate).is_err());
    }
}
