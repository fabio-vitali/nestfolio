#!/usr/bin/env node
// advance-lifecycle.mjs — advanceLifecycle(): the check state machine (§7). EVERY transition requires
// floorApproval===true; the floor guard is evaluated FIRST (precedence, §11), then from-state legality.
// The meta-check never advances state; only the floor does. CLI: 0 applied, 1 refused, 2 usage.
import { fileURLToPath } from 'node:url';

// legal { from → allowed transitions } per the §7 transition table.
const LEGAL = {
  candidate: new Set(['ratify', 'edit', 'decline']),
  active: new Set(['supersede', 'retire']),
  superseded: new Set(),
  retired: new Set(),
};

export function advanceLifecycle({ check, transition, floorApproval, successor, retiredReason }) {
  if (floorApproval !== true) return { check, event: 'REFUSED_NO_FLOOR' };          // precedence: floor FIRST
  if (!LEGAL[check.status]?.has(transition)) return { check, event: 'REFUSED_ILLEGAL_TRANSITION' };

  switch (transition) {
    case 'ratify':
      return { check: { ...check, status: 'active',
        provenance: { ...check.provenance, ratified: check.provenance.ratified ?? isoNow() } }, event: 'RATIFIED' };
    case 'edit':
      return { check: { ...check, status: 'candidate' }, event: 'EDITED' };
    case 'decline':
      return { check: null, event: 'DISCARDED' };                                    // never persisted
    case 'retire':
      return { check: { ...check, status: 'retired',
        provenance: { ...check.provenance, retired_reason: retiredReason ?? 'retired at floor' } }, event: 'RETIRED' };
    case 'supersede': {
      if (!successor) return { check, event: 'REFUSED_NO_SUCCESSOR' };
      const superseded = { ...check, status: 'superseded',
        provenance: { ...check.provenance, superseded_by: successor.id } };
      const chainedSuccessor = { ...successor,
        provenance: { ...successor.provenance, supersedes: check.id } };
      return { check: superseded, successor: chainedSuccessor, event: 'SUPERSEDED' };
    }
    default:
      return { check, event: 'REFUSED_ILLEGAL_TRANSITION' };
  }
}

// ISO timestamp: this is runtime code (not a workflow script), so `new Date()` is fine here.
function isoNow() { return new Date().toISOString(); }

function main() { console.error('advance-lifecycle.mjs is driven by the floor procedure (SPEC 2)'); process.exit(2); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
