export default {
  id: 'add-id-collision-suffix', skill: 'backlog-add',
  fixture: 'clean',
  // The natural kebab slug of this title is `clean-parking-item`, which ALREADY exists in the clean
  // fixture. The skill's id-uniqueness step must detect the collision and append `-2`, writing the
  // finding to `clean-parking-item-2.md` (NOT overwriting the pre-existing file). Title is pinned EXACTLY
  // so the colliding slug is deterministic; the golden asserts the -2-suffixed file was produced.
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"clean parking item\": a distinct new finding about a flaky retry that happens to derive the same slug as an existing backlog file. The CSV importer double-counts the header row on retry. Route it.",
  terminal: 'completed',
  golden: { present: [{ file: 'clean-parking-item-2', field: 'status' }], scalarStrings: [{ file: 'clean-parking-item-2', field: 'notes' }], lintExit0: true },
  rubric: ['The derived slug collides with the existing clean-parking-item file. Did it resolve the collision by appending a -2 suffix (clean-parking-item-2) rather than overwriting the existing file?'],
};
