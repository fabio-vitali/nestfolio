export default {
  id: 'add-notes-scalar', skill: 'backlog-add',
  fixture: 'clean',
  // The notes one-liner begins with a leading "-", which a bare YAML value would parse as a list (or a
  // leading ":" as a map) rather than a string. The skill's template mandates emitting notes as a
  // double-quoted scalar string. golden.scalarStrings asserts typeof frontmatter.notes === 'string'.
  // Title is pinned EXACTLY so the derived slug is deterministic.
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"dash prefixed notes scalar guard\": a finding whose one-line summary begins with a leading dash, e.g. \"- retry path lacks idempotency key, so a redelivered webhook double-applies\". Make sure the notes field is filed correctly. Route it.",
  terminal: 'completed',
  golden: { scalarStrings: [{ file: 'dash-prefixed-notes-scalar-guard', field: 'notes' }], lintExit0: true },
  rubric: ['The notes summary begins with a leading dash that bare YAML would parse as a list. Is the notes field emitted as a double-quoted YAML scalar STRING (not a nested list/map)?'],
};
