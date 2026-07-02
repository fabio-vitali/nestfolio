// runtime/adapters/claude-code/on-trigger.mjs — binds onTrigger to hooks/cron (in-process registry here).
export function makeOnTrigger({ bus } = {}) {
  const handlers = bus ?? new Map();
  return function onTrigger(spec, handler) {
    const set = handlers.get(spec.on) ?? new Set(); set.add(handler); handlers.set(spec.on, set);
    return () => set.delete(handler);
  };
}
