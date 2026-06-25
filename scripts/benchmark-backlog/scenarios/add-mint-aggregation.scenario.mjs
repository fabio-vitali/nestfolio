export default {
  id: 'add-mint-aggregation', skill: 'backlog-add',
  fixture: 'parking-cluster',
  // No active epic and no existing theme epic, so branches 1+2 cannot fire. The finding shares a root
  // cause (a missing CDK retention/lifecycle policy → unbounded log growth) with ≥1 existing parking
  // orphans (log-retention-missing, log-retention-lambda) → router branch 3 SUGGESTS minting a new
  // theme epic aggregating them. decoy-idle-nat shares only the cost SYMPTOM, not the root cause.
  // Branch 3 only mints if the user agrees, so the headless run must PAUSE on that confirmation.
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"step functions log group no retention\": the Step Functions execution log groups are also created with no retention policy and grow forever — the same missing-CDK-retention-policy root cause as the existing log-retention-missing and log-retention-lambda parking items. Route it.",
  terminal: 'pause',
  rubric: ['Three parking orphans exist: two share the missing-retention-policy root cause (log-retention-missing, log-retention-lambda) and decoy-idle-nat shares only the cost symptom. Did it SUGGEST minting a NEW theme epic that aggregates this finding with the two shared-root-cause orphans (not lump in the decoy, not file a bare orphan)?'],
  rubricGate: 4,
};
