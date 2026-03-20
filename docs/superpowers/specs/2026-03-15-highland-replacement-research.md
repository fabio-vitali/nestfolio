# Highland.js Replacement: TypeScript Alternatives Research

**Date**: 2026-03-15
**Context**: AWS Lambda SQS batch handler (1-100 records, short-lived)
**Status**: Research only — no recommendation yet

---

## Feature Matrix

| Feature | RxJS | p-map + p-limit | Node Streams | IxJS | Custom Generators | Callbag |
|---|---|---|---|---|---|---|
| fork() | partition / multicast + refCount | Manual (iterate twice) | PassThrough tee | No native | Manual (tee helper) | No native |
| merge() | merge / combineLatest | Promise.all | pipeline merge | merge | Promise.all | merge |
| parallel(N) | mergeMap(fn, N) | p-map(items, fn, {concurrency: N}) | parallel-transform | No native | Custom pooled mapper | No native |
| filter/map/flatMap | Yes (native) | Array methods + async | Transform streams | Yes (native) | Yes (native async gen) | Yes (operators) |
| group() | groupBy | Map-based grouping | Custom Transform | groupBy | Map-based grouping | No native |
| errors() | catchError / retry | try/catch per item | pipeline error handler | catchError | try/catch per item | No native |
| collect().toPromise() | lastValueFrom(obs.pipe(toArray())) | await Promise.all | pipeline + collect | toArray() | for-await-of + push | No native |

---

## 1. RxJS

### Assessment
- **TypeScript support**: Excellent — written in TypeScript, ships .d.ts, generics throughout
- **Bundle size**: Full package ~53 KB min+gz (RxJS 7). Tree-shakeable — typical SQS handler using ~8-12 operators would import ~15-20 KB. In Lambda (no browser), bundle size matters less than cold start.
- **Maintenance**: Very active. v7.8.2 (latest stable), ~30M weekly npm downloads, 30k+ GitHub stars. Angular dependency ensures long-term maintenance.
- **Last release**: v7.8.2 (2024). RxJS 8 in development.
- **API ergonomics**: Powerful but has a learning curve. The Observable mental model (push-based) is somewhat unnatural for pull-based batch processing. You'd use `from(records).pipe(...)` and convert back with `lastValueFrom()`.
- **Feature coverage**: **7/7** — all features covered natively.
- **Lambda suitability**: Overkill. RxJS is designed for long-lived event streams (UI events, WebSocket, etc.). For short-lived batch processing of 1-100 records, the Observable subscription lifecycle, scheduler system, and hot/cold distinction are unnecessary complexity. The `mergeMap(fn, concurrency)` pattern is excellent for parallel(N), but you're paying for a lot of machinery you don't need.

### Key operators for our use case
```
from(records).pipe(
  groupBy(r => r.tenantId),           // group()
  mergeMap(group => group.pipe(...)),  // fork-like
  mergeMap(processRecord, 5),         // parallel(5)
  filter(r => r.valid),               // filter
  catchError(handleErr),              // errors
  toArray()                           // collect
)
// then: lastValueFrom(stream$)       // toPromise
```

### Verdict
Full coverage, proven, but architecturally mismatched. Like using a chainsaw to cut bread.

---

## 2. p-map + p-limit + Custom Helpers

### Assessment
- **TypeScript support**: p-map and p-limit ship TypeScript types. Custom helpers = you write your own types.
- **Bundle size**: p-map ~1.5 KB, p-limit ~1 KB (min+gz). Extremely lightweight.
- **Maintenance**: Actively maintained by Sindre Sorhus. p-limit v7.2.0, p-map v7.0.0. Millions of weekly downloads.
- **ESM-only warning**: **Both p-map and p-limit are pure ESM packages** (no CommonJS). If your Lambda bundler (esbuild/webpack) doesn't handle ESM imports, this is a blocker. With esbuild (CDK default), this works fine. With raw `require()`, it breaks.
- **API ergonomics**: Very natural for batch processing. `await pMap(records, processFn, { concurrency: 5 })` is immediately readable.
- **Feature coverage**: **4/7 native, 3/7 with helpers**.
  - parallel(N): p-map native
  - filter/map/flatMap: Array methods + p-map
  - errors: p-map has `stopOnError: false` option
  - collect/toPromise: native (returns Promise<T[]>)
  - fork: **needs helper** — iterate array twice with different filters, or tee utility
  - merge: **needs helper** — Promise.all or custom combiner
  - group: **needs helper** — `Map`-based groupBy utility (~10 lines)

### What you'd need to write
```typescript
// ~10 lines: groupBy utility
function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]>

// ~15 lines: fork/merge pattern
async function forkMerge<T, R>(
  items: T[],
  branches: Array<{ filter: (t: T) => boolean; process: (items: T[]) => Promise<R[]> }>
): Promise<R[]>

// Total custom code: ~25-30 lines
```

### Verdict
Excellent fit for the use case. Minimal dependency weight. The missing fork/merge/group semantics require small helpers but those are trivially testable. **Best pragmatic choice** if you don't need true streaming.

---

## 3. Node.js Native Streams (stream/pipeline + Transform)

### Assessment
- **TypeScript support**: `@types/node` ships types for stream module. Types are adequate but verbose.
- **Bundle size**: Zero — built into Node.js runtime. No npm dependency.
- **Maintenance**: Maintained by Node.js core team. Always available.
- **API ergonomics**: **Poor for this use case.** Transform streams require implementing `_transform()` and `_flush()` methods. The pipeline API is designed for I/O streaming (file→transform→file), not batch array processing. Converting arrays to/from streams adds ceremony.
- **Feature coverage**: **4/7 native, 3/7 with extra packages**.
  - filter/map: Transform streams (verbose)
  - errors: pipeline error handling via callback
  - collect: pipeline + writable that accumulates
  - parallel(N): **Needs `parallel-transform` or `through2-concurrent` package** (both poorly maintained, last updated 3-6 years ago)
  - fork: PassThrough tee (awkward)
  - merge: Custom merge stream
  - group: Custom Transform

### Key pain points
- Converting `SQSRecord[]` to a Readable stream and back is boilerplate
- No native concurrency control in Transform — you need a third-party lib
- Error handling in streams is notoriously tricky (error events, destroyed streams)
- Backpressure management is irrelevant for 1-100 records in memory

### Verdict
Wrong tool. Native streams solve I/O streaming problems (large files, network sockets). For in-memory batch processing of small arrays, they add complexity without benefit.

---

## 4. IxJS (Interactive Extensions for JavaScript)

### Assessment
- **TypeScript support**: Written in TypeScript, good type inference for async iterables.
- **Bundle size**: ~12 KB min+gz for async iterable module. Tree-shakeable.
- **Maintenance**: **Effectively dormant.** Last npm release over 12 months ago. No PR activity. 1,249 GitHub stars, ~11K weekly downloads. Under ReactiveX org but receives minimal attention.
- **API ergonomics**: Clean async iterable API. `from(records).pipe(filter(...), map(...))` feels natural.
- **Feature coverage**: **4/7**.
  - filter/map/flatMap: Yes, native
  - groupBy: Yes
  - errors: catchError operator
  - collect: toArray()
  - parallel(N): **No native support** — this is the critical gap
  - fork: **No native support**
  - merge: merge operator exists

### Verdict
**Disqualified.** No parallel(N) support (the most critical feature for Lambda batch processing), and the project appears abandoned. Adopting a dormant dependency for a core processing pipeline is a risk.

---

## 5. Custom Async Generator Utilities

### Assessment
- **TypeScript support**: Full control — you write the types.
- **Bundle size**: Zero dependencies. Only your utility code.
- **Maintenance**: You own it. No upstream risk.
- **API ergonomics**: Can be designed exactly for your use case.
- **Feature coverage**: **7/7 — if you write them.**

### Estimated implementation

```typescript
// ~15 lines: asyncMap with concurrency
async function asyncMap<T, R>(items: T[], fn: (t: T) => Promise<R>, concurrency: number): Promise<R[]>

// ~10 lines: groupBy
function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]>

// ~20 lines: forkMerge (split → parallel branches → combine)
async function forkMerge<T, R>(items: T[], branches: Branch<T, R>[]): Promise<R[]>

// ~10 lines: asyncFilter
async function asyncFilter<T>(items: T[], predicate: (t: T) => Promise<boolean>, concurrency: number): Promise<T[]>

// ~15 lines: asyncFlatMap with concurrency
async function asyncFlatMap<T, R>(items: T[], fn: (t: T) => Promise<R[]>, concurrency: number): Promise<R[]>

// ~10 lines: processWithErrors (continue on error, collect failures)
async function processWithErrors<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<{ results: R[]; errors: Error[] }>

// Total: ~80-100 lines of utility code + ~120-150 lines of tests
```

### Key implementation note: parallel(N) without p-limit
The core `asyncMap` with concurrency can be implemented using a semaphore pattern:
```typescript
async function asyncMap<T, R>(items: T[], fn: (t: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
```
This is ~10 lines and handles the most critical feature (parallel N) with zero dependencies.

### Verdict
**Strong contender.** ~80-100 lines of focused, testable utility code with zero dependencies. You get exactly what you need, nothing more. The risk is maintaining custom code, but the scope is small and well-bounded.

---

## 6. Callbag / callbag-basics

### Assessment
- **TypeScript support**: **Poor native types.** Requires separate `callbag-types` package. The core spec uses `(type: 0|1|2, payload?: any)` — not type-safe by design.
- **Bundle size**: Very small (~1-2 KB for basics). Each operator is a separate tiny function.
- **Maintenance**: **Effectively abandoned.** callbag-basics v4.0.0 last published 5+ years ago. The philosophy is explicitly "fork it yourself." Low community adoption.
- **API ergonomics**: Unusual callback-based API. The `(0|1|2, payload)` protocol is elegant in theory but obscure in practice. Debugging is difficult — no standard tooling.
- **Feature coverage**: **3/7**.
  - filter/map: Yes
  - merge: Yes
  - parallel(N): **No**
  - fork: **No**
  - group: **No**
  - errors: **No native error handling**
  - collect/toPromise: **No native**

### Verdict
**Disqualified.** Poor TypeScript support, abandoned maintenance, missing critical features (parallel, fork, group, errors). The "build it yourself" philosophy means you'd end up writing most of the code anyway, but on top of an obscure protocol rather than plain async/await.

---

## Summary Ranking (for AWS Lambda SQS batch processing)

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **p-map + p-limit + helpers** | 9/10 | Minimal deps, battle-tested concurrency, natural async/await API, ~30 lines of helpers |
| 2 | **Custom async generators** | 8/10 | Zero deps, full control, ~80-100 lines, but you own maintenance |
| 3 | **RxJS** | 6/10 | Full feature coverage but massive overkill, wrong mental model for batch processing |
| 4 | **Node native streams** | 3/10 | Wrong abstraction for in-memory batch processing |
| 5 | **IxJS** | 2/10 | Missing parallel(N), project dormant |
| 6 | **Callbag** | 1/10 | Abandoned, poor types, missing most features |

### Decision factors
- If you want **minimal custom code + proven libs**: Option 1 (p-map + p-limit)
- If you want **zero external dependencies**: Option 2 (custom utilities)
- If you want to **combine both**: Use p-limit for the concurrency primitive (1 KB), write the rest (~50 lines)
- **Avoid**: RxJS (overkill), Node streams (wrong tool), IxJS (dormant), Callbag (abandoned)
