# Review: CDK Constructs Grouping Design Spec

**Spec**: `docs/superpowers/specs/2026-03-21-cdk-constructs-grouping-design.md`
**Verdict**: **Issues Found** -- 4 items to fix before implementation

---

## What the spec does well

- Clear 4-group taxonomy with logical separation (core/observability/extensions/utils)
- Consumer migration table is thorough and covers all 17 consumer projects
- Non-goals section properly scopes the work
- Subpath alias pattern is consistent with event-processor and shell conventions

---

## Issues

### Critical (must fix)

**C1. discover-js-resolvers.ts does not exist -- spec implies file extraction without stating it.**
The spec lists `discover-js-resolvers.ts` as a separate file in `core/`, but `discoverJsResolvers` is currently defined inside `facade.ts` (line 6 of `src/index.ts` re-exports it from `./facade`). The spec must explicitly call out that this function needs to be extracted from `facade.ts` into a new file, or simply note it stays in `facade.ts` and is re-exported from the `core/index.ts` barrel. As written, someone implementing this would look for a file that does not exist.

**C2. Six test files missing from spec test tree.**
The spec test organization omits 6 existing test files:

| Test file on disk | Correct new location | Spec status |
|---|---|---|
| `adapter-schedule.test.ts` | `test/extensions/` | MISSING |
| `knowledge-base.test.ts` | `test/extensions/` | MISSING |
| `default-lambda-props.test.ts` | `test/utils/` | Contradicted ("no dedicated tests") |
| `naming-service.test.ts` | `test/utils/` | Contradicted ("no dedicated tests") |
| `resolve-pipeline-config.test.ts` | `test/utils/` | Contradicted ("no dedicated tests") |
| `tagging.test.ts` | `test/utils/` | Contradicted ("no dedicated tests") |

The spec says utils has "(no dedicated tests -- utilities tested indirectly through consumers)" but 4 dedicated test files exist today. This is factually wrong and would cause the implementor to either delete or misplace these tests.

### Important (should fix)

**I1. dashboard.test.ts listed in spec but does not exist on disk.**
The spec lists `observability/dashboard.test.ts` in the test tree, but there is no `dashboard.test.ts` in the current `test/` directory. Either the spec should note this as a new test to create, or remove it from the tree to avoid confusion.

**I2. Missing exports from the spec's group tables.**
The `index.ts` barrel reveals several exports not listed in the spec tables:

- **core/**: `parseSchemaFields`, `JsResolverConfig`, `LambdaResolverConfig` (from facade), `ServiceStackProps`, `StateProps`, `GsiConfig`, `IngressProps`, `EgressProps`, `FacadeProps` -- Props types are not listed
- **utils/**: `agentLambdaProps` (from default-lambda-props), `NamingService`, `NamingServiceConfig`, `getPrefix`, `discoverSubsystem` (from naming-service), `ResolvedPipelineConfig`, `ScheduleConfig`, `inferServiceMetadata`, `loadTierDefaults`, `mergeConfigs`, `HARDCODED_FALLBACKS` (from resolve-pipeline-config), `StandardTagsProps` (from tagging)
- **extensions/**: `RuntimeConfigSsmPaths`, `SharedParameterProps`, `CrossAccountBusPolicyProps`, `DomainAccountMap`, `getDomainAccounts`, `getConsumerAccountIds`, `resolveBusArn`, `resolveSsmValue` (from cross-account)

While Props types might be considered implicit, utility functions like `agentLambdaProps`, `getPrefix`, `discoverSubsystem`, `inferServiceMetadata`, `loadTierDefaults`, `mergeConfigs`, and `getDomainAccounts`/`getConsumerAccountIds`/`resolveBusArn`/`resolveSsmValue` are real exports that consumers may import. The tables should be complete or explicitly note "all exports from each source file are re-exported."

---

## Consistency check: subpath alias pattern

The proposed pattern matches the existing conventions:
- **event-processor**: `@nestfolio/event-processor/*` wildcard maps to `libs/event-processor/src/*`
- **shell**: explicit `@nestfolio/shell/testing` before `@nestfolio/shell/*` wildcard
- **cdk-constructs (proposed)**: 4 explicit subpaths, no wildcard, no root alias

The spec correctly proposes explicit subpath entries (no wildcard). This is a valid approach. However, note that event-processor uses a wildcard pattern while this spec does not. Both are acceptable, but using a wildcard (`@nestfolio/cdk-constructs/*` -> `libs/cdk-constructs/src/*/index.ts`) would be simpler and consistent with event-processor. This is a suggestion, not a blocker.

---

## Summary of required fixes

1. **C1**: Clarify that `discoverJsResolvers` extraction from `facade.ts` is needed, or keep it in `facade.ts`
2. **C2**: Add the 6 missing test files to the test tree (4 in `utils/`, 2 in `extensions/`)
3. **I1**: Remove phantom `dashboard.test.ts` or mark it as "to be created"
4. **I2**: Complete the export tables or add a note that all module exports are included
