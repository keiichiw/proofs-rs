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
                claim
            })
            .collect(),
    );
    Ok(value)
}
pub fn key(claim: &Value) -> Result<String> {
    Ok(claim["api_item_id"]
        .as_str()
        .context("Missing API ID")?
        .into())
}
pub fn claims_by_key(report: &Value) -> Result<BTreeMap<String, Value>> {
    let mut claims = BTreeMap::new();
    for claim in report["claims"].as_array().context("Missing claims")? {
        ensure!(
            claims.insert(key(claim)?, claim.clone()).is_none(),
            "Existing report has multiple claims for the same API; this CLI cannot update it"
        );
    }
    Ok(claims)
}
pub fn merge(config: &Config, mut generated: Value, existing: Option<&Value>) -> Result<Value> {
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
    let mut claims = vec![];
    for claim in generated["claims"]
        .as_array()
        .context("Missing generated claims")?
    {
        let mut merged = if let Some(previous) = old.get(&key(claim)?) {
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
        claims.push(merged);
    }
    body["claims"] = Value::Array(claims);
    Ok(body)
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
                if !current.contains_key(&key(claim)?) {
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
}
