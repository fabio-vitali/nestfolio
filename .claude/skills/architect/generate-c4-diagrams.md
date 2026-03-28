---
name: generate-c4-diagrams
description: Regenerate C4 architecture SVG diagrams from D2 source. Use after modifying any .d2 file in docs/architecture/, after creating/renaming services, or after changing CDK stacks.
---

## When This Skill Applies
- After modifying any `docs/architecture/c3/*.d2` file
- After modifying `docs/architecture/nestfolio.d2`
- After creating a new service (new C3 diagram needed)
- After renaming/removing services
- After changing CDK stack constructs (State/Ingress/Egress/Facade/AgentRuntime/Orchestration)
- User invokes `/generate-c4-diagrams`

## What It Does

Compiles the D2 C4 architecture source into navigable SVG diagrams with:
- Clickable C1 → C2 → C3 drill-down navigation
- Embedded AWS service icons (Lambda, DynamoDB, SQS, EventBridge, etc.)
- Per-service C3 diagrams showing the 6-construct CDK pattern

## Checklist

- [ ] 1. **Run the generation script**
  ```bash
  node tools/generate-c4-diagrams.mjs
  ```
  This compiles `docs/architecture/nestfolio.d2` → `docs/architecture/nestfolio/**/*.svg`, adds `.svg` extensions, and patches navigation links.

- [ ] 2. **Verify output** — spot-check that SVGs exist and icons render:
  ```bash
  ls docs/architecture/nestfolio/index.svg
  ls docs/architecture/nestfolio/c2-investor/c3-investor-bff.svg
  ```

- [ ] 3. **If a new service was added**, ensure it has:
  - A C3 D2 file at `docs/architecture/c3/{service-name}.d2`
  - A layer import in `docs/architecture/nestfolio.d2` under the domain's `layers:` block
  - A `link: layers.c3-{service-name}` on the service node in the C2 layer

## D2 Source Structure

```
docs/architecture/
  nestfolio.d2          # Root — classes, C1/C2 layers, layer imports
  c3/                   # C3 diagrams (one per service)
    investor-bff.d2
    investor-ctrl.d2
    ...
  icons/                # AWS service SVG icons (referenced by classes)
  nestfolio/            # Generated SVGs (DO NOT EDIT)
    index.svg           # C1 overview
    c2-investor/
      index.svg         # C2 domain view
      c3-investor-bff.svg
      ...
```

## C3 Diagram Template

Each C3 file follows the 6-construct CDK pattern. State is always a first-class construct visible in C3 (not hidden inside ServiceStack). DynamoDB tables are always explicitly shown. For orchestrated services, add an Orchestration group with Step Functions state machine and EventBridge trigger connections. Use this template for new services:

```d2
direction: down

title: "{service-name}\n[{service-type}]" {
  style: { font-size: 40; bold: true; fill: transparent; stroke: transparent }
}

facade: "Facade" {
  style: { fill: "#F3E5F5"; stroke: "#9C27B0"; border-radius: 12; font-size: 28 }
  # AppSync/SSM/API Gateway nodes here
}

ingress: "Ingress" {
  style: { fill: "#FFF8E1"; stroke: "#FFC107"; border-radius: 12; font-size: 28 }
  # EventBridge Rule → SQS → Lambda nodes here
}

state: "State" {
  style: { fill: "#E3F2FD"; stroke: "#2196F3"; border-radius: 12; font-size: 28 }
  table: "DynamoDB Table\n[{TableName}]" { class: aws-dynamodb }
  stream: "DynamoDB Stream\n[CDC]" { class: aws-ddb-stream }
  table -> stream
}

egress: "Egress" {
  style: { fill: "#FBE9E7"; stroke: "#FF5722"; border-radius: 12; font-size: 28 }
  processor: "Lambda\n[StreamProcessor]" { class: aws-lambda }
  bus: "EventBridge\n[{domain}-bus]" { class: aws-eventbridge }
  processor -> bus: "Publish events" {style.font-size: 22}
}

# Orchestration (only for orchestrated services — broker-ctrl, decision-workflow-ctrl)
# orchestration: "Orchestration" {
#   style: { fill: "#E8F5E9"; stroke: "#4CAF50"; border-radius: 12; font-size: 28 }
#   state-machine: "Step Functions\n[{StateMachineName}]" { class: aws-stepfunctions }
# }

# Flows — connect constructs to show data path
ingress.handler-fn -> state.table: "Read/Write" {style.font-size: 22}
state.stream -> egress.processor: "CDC trigger" {style.font-size: 22}

# Orchestration flows (if present):
# ingress.handler-fn -> orchestration.state-machine: "Start execution" {style.font-size: 22}
# orchestration.state-machine -> state.table: "Read/Write" {style.font-size: 22}
# EventBridge trigger: bus -> orchestration.state-machine (via EventBridge rule)
```

### C3 Detection Notes

When generating C3 diagrams from CDK code:
- **State:** Detect `new State(this, ...)` as a first-class construct — always render the State group with DynamoDB table
- **Orchestration:** Detect `new Orchestration(this, ...)` — render the Orchestration group with Step Functions state machine
- **EventBridge triggers:** If `OrchestrationProps.triggers` is defined, show EventBridge rule connections from the domain bus to the state machine
- **DynamoDB tables** are now always visible in C3 as part of the State construct (not hidden inside ServiceStack)

## Anti-Patterns
- NEVER edit SVGs directly — they are generated artifacts
- NEVER render C3 files standalone (`d2 c3/foo.d2`) — icons won't load; always render from the parent `nestfolio.d2`
- NEVER commit D2 changes without regenerating SVGs
