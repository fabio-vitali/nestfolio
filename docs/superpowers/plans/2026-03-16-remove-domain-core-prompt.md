Execute the plan at `docs/superpowers/plans/2026-03-16-remove-domain-core.md`.

Key context:
- This removes `libs/domain-core/` entirely, distributing its contents to publishing services and `@nestfolio/event-processor`
- Each publishing service gets a `src/domain/` folder with events, schemas, models, and a barrel `index.ts`
- Consumer services import event type constants from producers via `@nestfolio/<service>/domain` tsconfig path aliases (compile-time safety)
- 18 test files have `jest.mock('@nestfolio/domain-core', () => ({}))` that must be removed
- 11 event-listener.ts files must replace string literals with typed imports from producer services
- Test files are flat in `test/` (not nested subdirectories) for all services except investor-bff

Run tests after each chunk to catch issues early. Use `npx nx run-many -t test --all` for full suite verification at chunk boundaries.
