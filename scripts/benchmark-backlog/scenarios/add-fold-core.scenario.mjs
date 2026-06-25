export default {
  id: 'add-fold-core', skill: 'backlog-add',
  fixture: 'active-epic',
  // Thematically near the active acme epic AND load-bearing for its done_when ("the public interface
  // change is merged"): the finding is a gap IN that public-interface redesign, so leaving it undone
  // falsifies a done_when clause → router branch 1 folds it as `core` (not captured).
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"acme public interface missing error contract\": while redesigning the acme public interface that the acme epic is delivering, I found the new public interface has no error-return contract. The acme epic's done_when requires the public interface change to be merged, and an interface without its error contract is an incomplete interface change — so this is part of the epic's done-definition, not orthogonal to it.",
  terminal: 'completed',
  golden: { frontmatter: { 'acme-public-interface-missing-error-contract': { epic: 'acme-epic', epic_role: 'core' } }, scalarStrings: [{ file: 'acme-public-interface-missing-error-contract', field: 'notes' }], lintExit0: true },
  rubric: ['The finding is load-bearing for the active acme epic done_when (an incomplete public-interface change). Is folding it as `core` (required for closure, drained by epic closure) the correct routing rather than captured?'],
};
