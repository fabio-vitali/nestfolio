// Test-only bridge module for worker.test.mjs's fakeRegistryWithGate helper. `module:` is the only
// evaluator scheme (§4 run-grammar) that can invoke arbitrary injected JS at check-time, so a test that
// wants a gate whose findings change between two runGate calls (the W-A replay-forever regression) needs
// a real file on disk to import — this is that file. setGateGetter closes over the test's live variable;
// check() reads it fresh on every invocation (never snapshotted).
let getter = () => [];
export function setGateGetter(fn) { getter = fn; }
export function check() { return getter(); }
