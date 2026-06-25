---
id: simple-single-svc
status: queued
rank: 20
type: task
notes: "Single-service one-file off-by-one fix in investor-ctrl; no public interface change, no deploy gate."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# simple-single-svc: One-file off-by-one fix in a single service

A small, self-contained fix touching exactly one file in one service (`investor-ctrl`). It
changes no public interface, no event contract, no CDK construct, and requires no deploy or e2e
gate to validate — the existing unit test covers it. The expected lane is **Simple**: land
directly on `main`, no worktree, no PR.
