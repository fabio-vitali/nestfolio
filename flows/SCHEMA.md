# Flow Specification Schema (v1)

Flow specs are machine-readable YAML describing end-to-end business flows.
Validated against code by `validate-flow` skill.

## Schema

```yaml
schema_version: 1
flow: {flow-name}                          # kebab-case
description: {one-line business description}
domains: [{domain1}, {domain2}, ...]

trigger: {service} emits {EVENT_NAME}

steps:
  - service: {service-name}
    receives: {EVENT_NAME}
    via: {Bus} → SQS → {service}-ingress
    state_change: {description}            # optional
    emits: {EVENT_NAME} ({CDC|explicit})
    idempotent: true|false

  - service: {adapter-name}               # cross-domain hop
    receives: {EVENT_NAME}
    via: {SourceBus} → SQS → {adapter}-ingress
    forwards_to: {TargetBus}
    emits: {EVENT_NAME}

success_criteria:
  - {observable outcome}

failure_modes:
  - step {N} fails: {consequence + recovery}
```

## Rules
- One file per flow: `flows/{flow-name}.flow.yaml`
- Generated from code by `generate-flow-spec`, not hand-authored
- Validated by `validate-flow`
- Human review required after generation
