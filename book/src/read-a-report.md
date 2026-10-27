# Find and read a report

This guide is for readers who want to know what has been verified about a crate
they use. A Report is evidence to inform your own decision, not a verdict. Read it
for the APIs you call, under the conditions you use them.

## 1. Find the crate and version

[Search Crates](/crates) for the crate and open its page. Use the **Version**
selector to choose the exact version in your Cargo.lock. Everything on the page,
including Reports, Findings, and the API catalogue, refers to the selected
version only.

proofs.rs does not infer that a result for one version applies to another. If
only a different version has Reports, read them as an indication of what was
studied, not as evidence for your version. Compare the source changes between the
versions yourself, or ask on the Report whether the author expects the result to
carry over.

## 2. Find the APIs you use

The crate page's API catalogue links each API to the Reports and Claims that
mention it. An em dash (—) means that no public Report covers that API. A
Report about the crate does not cover APIs it does not list.

## 3. Read the Claim

Open the Claim for each API you care about. Check:

- **Preconditions:** the inputs and states under which the Claim holds. If your
  code can call the API outside these conditions, the Claim says nothing about
  that call. For Lean-based tools, also read the **Formal statement**.
- **Explanation:** what property was verified, such as absence of panics or
  undefined behavior, or a functional specification. A strong proof of a weak
  specification still gives a weak guarantee.
- **Evidence:** links to the harness, contract, or theorem in the recorded source
  commit.

## 4. Read the Report context

The Report gathers the context shared by its Claims:

- **Overview:** what the author verified and why.
- **What is trusted:** assumptions taken without proof, such as the compiler,
  allocator, or stubs.
- **Technical limitations:** what the verification does not cover, both for this
  Report and for the tool version used. Tool limitations are maintained on the
  [Tools](/tools) pages.
- **Evidence** and **Reproduce:** the source commit, the exact command, tool
  version, check results, and logs. These describe the author's run;
  proofs.rs has not independently rerun it. Check whether the recorded features
  and target match how you build the crate, and whether the verified source is a
  fork rather than the published release.

## 5. Check findings and discussion

**Findings** record what the author learned during verification, including bugs,
with upstream status reported by the author. **Comments** show questions and
objections from other readers and how the author responded. A Claim with an open
objection about its specification deserves more scrutiny. See
[Discuss a report](discuss-a-report.md) to raise your own.

## 6. Check dependencies

**Dependencies** lists the crate's direct dependencies and links to public Reports
for matching versions. A link marked **reviewed** means the author declared that
they read that evidence; it does not mean the dependency is fully verified.

## Special cases

- **No Reports:** nothing has been published for this crate or version. It says
  nothing about the crate's quality either way. You can
  [publish a report](publish-a-report.md) yourself.
- **Withdrawn:** the author withdrew the Report. It remains readable for
  reference, but the author no longer stands behind it. Read the withdrawal notice
  and comments for the reason.
- **Older revisions:** a Report can be revised. The revision history keeps
  earlier versions, and a link that names a revision (`?v=…`) shows that exact
  revision.

See [Concepts and terminology](concepts.md) for the meaning of statuses and
labels used on these pages.
