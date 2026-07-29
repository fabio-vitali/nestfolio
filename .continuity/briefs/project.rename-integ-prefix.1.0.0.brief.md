# Rename the integration prefix environment variable to `PREFIX`

The environment variable `NESTFOLIO_INTEG_PREFIX` is read and set in six code
and configuration files. Rename it to `PREFIX` in **exactly these six paths, and
nowhere else**:

- `libs/test-support/src/context.ts` — read four times, twice inside the error
  message that names the variable a caller must set. Rename it in the message
  too: an error naming a variable that no longer exists is worse than no error.
- `libs/test-support/test/context.test.ts` — read eight times, including a
  regular expression that asserts the error message names the variable. That
  expression must match the new name.
- `apps/nestfolio-e2e/playwright.config.ts` — read once. The local constant is
  already called `PREFIX`; only the `process.env` lookup changes.
- `apps/e2e-feature-tests/jest.global-teardown.ts` — read once.
- `.github/workflows/nestfolio-e2e.yml` — **sets** it, to `dev`.
- `.github/workflows/pr-deploy.yml` — **sets** it, to
  `sandbox-pr-${{ github.event.pull_request.number }}`.

The last two **set** rather than read, and both must be renamed with the rest.
Renaming only the readers would leave CI exporting a name nothing reads and every
test falling back to the `'dev'` default — silently, and only in CI.

Keep the default values, the fallbacks (`?? 'dev'`) and the surrounding logic
exactly as they are. This is a rename, not a redesign: no new option, no new
default, no reordering, no reformatting of untouched lines.

**Change nothing else.** In particular:

- **no file under `tests/`.** The declared suite is what judges this work. It is
  not yours to change. You may read it;
- **no documentation.** Roughly ninety-seven markdown files mention the old name.
  They are deliberately outside this change and are not yours to sweep;
- **no file under `.continuity/`.** That is the record of this work, not part of
  it;
- no other source file, no lockfile, no `package.json`, and no new file.

When the six files are done, stop. The declared level-1 suite must report its
assertion about this rename as passing; it also carries one assertion that was
already failing before you started, about a different change on an open pull
request, and that one is **not yours to fix**.
