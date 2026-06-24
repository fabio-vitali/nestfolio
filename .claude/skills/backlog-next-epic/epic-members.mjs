#!/usr/bin/env node
/**
 * Epic member resolver for /backlog-next-epic.
 *
 * Enumerates an epic's members from their `epic:` pointers and picks the next
 * CORE member to work — the deterministic ordering that used to live as inline
 * bash in /backlog-next Step 1a, now a tested pure helper.
 *
 * Usage:
 *   node epic-members.mjs <epic-id>       # roster + next core member (or drainable)
 *   node epic-members.mjs --active-epics  # rule-11 guard: ids of all active epics (E1)
 *   node epic-members.mjs --candidates    # open epics + open/total core counts (selection gather)
 *   node epic-members.mjs --classify "X"  # disambiguate a bare arg: epic-id=<id> | criterion
 *
 * Output (stdout): the epic's resolved roster + the selected next core member,
 * or a "drainable" marker when no open core member remains. With --active-epics:
 * one active-epic id per line (or "(none)").
 *
 * Exit codes:
 *   0  — a next core member was selected (printed as `next=<id>`), OR --active-epics query ran
 *   10 — epic is drainable (no open core members) → ready to ship
 *   1  — error (epic not found, not a type:epic, etc.)
 */
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBacklogFiles } from '../backlog-lint/lib/frontmatter.mjs';

const OPEN_STATUSES = new Set(['active', 'queued', 'parking']);

/** The records main() feeds to the resolver, built via the ONE canonical backlog
 * frontmatter parser (backlog-lint/lib/frontmatter.mjs) — so epic-members resolves
 * rosters byte-identically to the lint gate. No 4th hand-rolled parser to drift:
 * inline comments (`status: active # WIP`) and `rank: null` are handled by the real
 * `yaml` parser, not lost to a regex. A file the canonical loader cannot parse
 * yields fm:{}, which simply fails the epic filter (the lint gate reports it located). */
export function loadRecords(dir) {
  return loadBacklogFiles(dir).map((f) => ({ id: f.id, fm: f.frontmatter ?? {} }));
}

/** From a list of {id, fm} records, the CORE members of `epicId` (role core or
 * unset; captured excluded), each as {id, status, rank, role}. */
export function coreMembers(records, epicId) {
  return records
    .filter((r) => r.fm.epic === epicId)
    .map((r) => ({
      id: r.id,
      status: r.fm.status,
      rank: r.fm.rank != null ? Number(r.fm.rank) : undefined,
      role: r.fm.epic_role || 'core',
    }))
    .filter((m) => m.role === 'core');
}

/** Open core members (status ∈ {active, queued, parking}). */
export function openMembers(members) {
  return members.filter((m) => OPEN_STATUSES.has(m.status));
}

/** True when no open core members remain → rule 9 will pass, epic is shippable. */
export function isDrainable(members) {
  return openMembers(members).length === 0;
}

/** Ids of all `type: epic` files currently `status: active` — the rule-11 / single-active-epic
 * surface. Reuses the ONE canonical parser (no grep), so the E1 pre-promotion guard cannot
 * drift from the lint gate. The E0 preflight does NOT cover this: at promotion time the target
 * is still parking, so 0-or-1 epics are active and the guard is load-bearing (F-32). */
export function activeEpics(records) {
  return records
    .filter((r) => r.fm.type === 'epic' && r.fm.status === 'active')
    .map((r) => r.id)
    .sort((a, b) => a.localeCompare(b));
}

const CANDIDATE_STATUS_ORDER = { active: 0, queued: 1, parking: 2 };

/** Deterministic base order for the candidate menu: active first, then queued by rank
 * (missing rank last), then parking alphabetically. The impact RANKING is applied on top
 * of this by the SKILL (model judgment) — this only gives a stable, reproducible baseline. */
function candidateOrder(a, b) {
  const sa = CANDIDATE_STATUS_ORDER[a.status];
  const sb = CANDIDATE_STATUS_ORDER[b.status];
  if (sa !== sb) return sa - sb;
  if (a.status === 'queued') {
    const ra = a.rank ?? Infinity;
    const rb = b.rank ?? Infinity;
    if (ra !== rb) return ra - rb;
  }
  return a.id.localeCompare(b.id);
}

/** Selection candidates: every `type:epic` record in an OPEN status (active|queued|parking),
 * annotated with its open/total CORE member counts (via the same coreMembers/openMembers logic
 * the member loop uses) and the fields a ranker needs. Shipped/dropped epics are excluded.
 * Feeds `--candidates` → the at-selection-time impact ranking. Persists nothing. */
export function candidateEpics(records) {
  return records
    .filter((r) => r.fm.type === 'epic' && OPEN_STATUSES.has(r.fm.status))
    .map((r) => {
      const core = coreMembers(records, r.id);
      return {
        id: r.id,
        status: r.fm.status,
        rank: r.fm.rank != null ? Number(r.fm.rank) : undefined,
        openCore: openMembers(core).length,
        totalCore: core.length,
        notes: r.fm.notes ?? '',
      };
    })
    .sort(candidateOrder);
}

/** Disambiguate a bare positional arg: an exact match against a `type:epic` file id is an
 * epic-id; anything else is a free-text criterion. The `--like` flag and the no-arg default
 * are decided by the caller — this resolves only the single ambiguous case. */
export function classifyPositional(records, phrase) {
  const hit = records.find((r) => r.id === phrase && r.fm.type === 'epic');
  return hit ? { kind: 'epic-id', id: phrase } : { kind: 'criterion', text: phrase };
}

/**
 * The next CORE member to work, by the deterministic ordering:
 *   1. a core member already `active` → resume it (the in-flight slice);
 *   2. else the lowest-`rank` `queued` core member (missing rank sorts last);
 *   3. else the first `parking` core member, alphabetical by id;
 *   4. else null (drainable).
 * Returns the member id, or null.
 */
export function selectNextMember(members) {
  const open = openMembers(members);
  const active = open.filter((m) => m.status === 'active');
  if (active.length > 0) return active.sort((a, b) => a.id.localeCompare(b.id))[0].id;

  const queued = open.filter((m) => m.status === 'queued').sort((a, b) => {
    const ra = a.rank ?? Infinity;
    const rb = b.rank ?? Infinity;
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
  if (queued.length > 0) return queued[0].id;

  const parking = open.filter((m) => m.status === 'parking').sort((a, b) => a.id.localeCompare(b.id));
  if (parking.length > 0) return parking[0].id;

  return null;
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const dir = join(repoRoot, 'docs/backlog');
  const records = loadRecords(dir);

  // Rule-11 / E1 pre-promotion guard: list every currently-active epic (one id per line,
  // or "(none)"). The orchestrator stops if any id other than the target it is about to
  // promote appears. Always exits 0 — it's a query, not a gate.
  if (args.includes('--active-epics')) {
    const ids = activeEpics(records);
    console.log(ids.length ? ids.join('\n') : '(none)');
    process.exit(0);
  }

  // Selection gather: emit every open epic with its open/total core counts + notes, in the
  // deterministic baseline order. The SKILL ranks this by impact (default) or --like criterion.
  if (args.includes('--candidates')) {
    const cands = candidateEpics(records);
    console.log(`candidates (${cands.length}):`);
    for (const c of cands) {
      const note = c.notes ? `  — ${c.notes}` : '';
      console.log(`  ${c.status.padEnd(8)} rank=${c.rank ?? '-'}  core=${c.openCore}/${c.totalCore}  ${c.id}${note}`);
    }
    process.exit(0);
  }

  // Disambiguate a bare positional arg into an epic id or a free-text criterion.
  const classifyIdx = args.indexOf('--classify');
  if (classifyIdx !== -1) {
    const phrase = args[classifyIdx + 1];
    if (!phrase) {
      console.error('Usage: epic-members.mjs --classify "<phrase>"');
      process.exit(1);
    }
    const res = classifyPositional(records, phrase);
    console.log(res.kind === 'epic-id' ? `epic-id=${res.id}` : 'criterion');
    process.exit(0);
  }

  const epicId = args[0];
  if (!epicId) {
    console.error('Usage: epic-members.mjs <epic-id> | --active-epics | --candidates | --classify "<phrase>"');
    process.exit(1);
  }

  const epic = records.find((r) => r.id === epicId);
  if (!epic) {
    console.error(`Epic '${epicId}' not found in docs/backlog/.`);
    process.exit(1);
  }
  if (epic.fm.type !== 'epic') {
    console.error(`'${epicId}' is type: ${epic.fm.type || '(unset)'}, not 'epic'. Use /backlog-next for non-epic items.`);
    process.exit(1);
  }

  const members = coreMembers(records, epicId);
  const captured = records
    .filter((r) => r.fm.epic === epicId && r.fm.epic_role === 'captured')
    .map((r) => ({ id: r.id, status: r.fm.status }));

  console.log(`epic=${epicId}  status=${epic.fm.status}`);
  console.log(`core members (${members.length}):`);
  for (const m of members.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${m.status.padEnd(8)} rank=${m.rank ?? '-'}  ${m.id}`);
  }
  if (captured.length > 0) {
    console.log(`captured members (${captured.length}, ride-along — audited at close):`);
    for (const c of captured.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`  ${String(c.status).padEnd(8)}  ${c.id}`);
    }
  }

  const next = selectNextMember(members);
  if (next === null) {
    console.log('next=(none) — epic is DRAINABLE (no open core members); run the captured audit, then ship the epic.');
    process.exit(10);
  }
  console.log(`next=${next}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
