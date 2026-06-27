export default {
  id: 'add-mint-aggregation', skill: 'backlog-add',
  fixture: 'parking-cluster',
  // No active epic and no existing theme epic, so branches 1+2 cannot fire. The finding shares a root
  // cause (a missing CDK retention/lifecycle policy → unbounded log growth) with ≥1 existing parking
  // orphans (log-retention-missing, log-retention-lambda) → router branch 3 SUGGESTS minting a new
  // theme epic aggregating them. decoy-idle-nat shares only the cost SYMPTOM, not the root cause.
  // Branch 3 is a NON-BLOCKING suggest (file-and-continue, the skill's defining contract): the run
  // files the finding as a parking orphan AND emits a one-line suggestion to mint a theme epic
  // aggregating the two retention orphans — it does NOT pause (the actual mint defers to
  // /backlog-themes). So terminal=completed; rubricGate:4 enforces that the suggestion correctly
  // names the cluster and excludes the decoy. (Canonized via /backlog-next-epic --auto decision log.)
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"step functions log group no retention\": the Step Functions execution log groups are also created with no retention policy and grow forever — the same missing-CDK-retention-policy root cause as the existing log-retention-missing and log-retention-lambda parking items. Route it.",
  terminal: 'completed',
  rubric: ['Three parking orphans exist: two share the missing-retention-policy root cause (log-retention-missing, log-retention-lambda) and decoy-idle-nat shares only the cost symptom. Did it correctly identify the shared-root-cause cluster and SUGGEST minting a NEW theme epic that aggregates this finding with the two retention orphans (naming them, excluding the decoy)? Filing the finding as a provisional parking orphan alongside the suggestion is fine; silently filing it with NO mint suggestion (or lumping in the decoy) is not.'],
  rubricGate: 4,
};
