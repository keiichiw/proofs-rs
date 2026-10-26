// Stable public URLs and users. Every record is synthetic; no proof was run.
export const DEMO_SEED_VERSION = 1;
export const demoUsers = {
  author: {
    id: "440c2600-ef7e-5f9a-af35-3b471bd995c3",
    label: "Author · demo_mira",
  },
  other: {
    id: "c2d838d7-2a98-5d5f-a967-d278312963b7",
    label: "Other user · demo_nora",
  },
};
export const demoIDs = {
  report: 900001,
  findingOnlyReport: 900002,
  claim: "d0000000-0000-4000-8000-000000000001",
  openFinding: "d0000000-0000-4000-8000-000000000002",
  fixedFinding: "d0000000-0000-4000-8000-000000000003",
  claimOnlyAPI: "d0000000-0000-4000-8000-000000000004",
  findingOnlyAPI: "d0000000-0000-4000-8000-000000000005",
  bothAPI: "d0000000-0000-4000-8000-000000000006",
};
export const demoScenarios = [
  ["Home", "/"],
  ["Crates", "/crates"],
  ["Crate with claims and findings", "/crate/findings-demo"],
  ["Empty crate", "/crate/empty-demo"],
  ["API with claims only", `/api/${demoIDs.claimOnlyAPI}`],
  ["API with findings only", `/api/${demoIDs.findingOnlyAPI}`],
  ["Trait API with claims and findings", `/api/${demoIDs.bothAPI}`],
  ["Report with claims and findings", `/report/${demoIDs.report}`],
  ["Finding-only report", `/report/${demoIDs.findingOnlyReport}`],
  ["Claim", `/claim/${demoIDs.claim}`],
  ["Open finding · editable by author", `/finding/${demoIDs.openFinding}`],
  ["Fixed finding with upstream links", `/finding/${demoIDs.fixedFinding}`],
  ["Reports with pagination", "/reports"],
  ["Tools", "/tools"],
  ["Author profile", `/user/${demoUsers.author.id}`],
  ["My reports", "/my-reports"],
  ["My comments", "/my-comments"],
  ["My starred reports", "/my-starred-reports"],
  ["My starred claims", "/my-starred-claims"],
] as const;
