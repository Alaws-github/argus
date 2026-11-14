# AGENTS.md

How to work on ARGUS. Read this before changing anything, then [`CLAUDE.md`](CLAUDE.md) (what the product is and the rules it must keep), [`docs/LESSONS.md`](docs/LESSONS.md) (pitfalls already found) and [`docs/context/project-history.md`](docs/context/project-history.md) (who it is for, what was decided and why). Claude reads this file through `CLAUDE.md`; other agents read it directly.

---

## Planning changes

For a change that is large, touches several areas or is hard to undo, write a short plan and get the owner's agreement first. Questions, investigations and small fixes don't need one. A plan covers:

1. The problem or feature, in plain words.
2. Assumptions, written so they can be checked, and checked where you can.
3. Acceptance criteria: what the owner will see when it works.
4. Files affected, including indirect ones (search for them: routes, `OWNERS` in `archive.ts`, `reset.ts`, the manual, the demo scenarios).
5. Which of the rules in `CLAUDE.md` it touches, and how they still hold.
6. Options, only when there is a real choice, compared on simplicity, security, effort and usage cost.
7. A recommendation and why. If the right answer is unclear, ask.

The owner watches his usage. Prefer the smallest change that does the job, and don't rebuild what already works.

---

## Recording lessons

### Before changing anything

Read [`docs/LESSONS.md`](docs/LESSONS.md). It says which files under `docs/lessons/` apply to the area you're changing and indexes every lesson. Always read `docs/lessons/general.md`, plus the area files for what you touch. Lessons are durable rules, not an incident log.

Each lesson has a tag:

- `bug`: found or fixed in code.
- `correction`: the owner corrected an assumption or redirected the approach.
- `design`: a product or UI decision the owner made that later changes must keep.

### When to add one

Add a lesson straight away, without asking, when:

- you fix a defect, even a small one;
- you spot a bug while reading code, even if you weren't asked to fix it;
- the owner reports that something is broken;
- the owner says an assumption was wrong, redirects the approach or points out a convention you missed;
- the owner makes a design decision that a later change could easily undo.

Put it in the area file that fits, under the closest `##` section, then run `npm run lessons` to rebuild the index. `npm run check:lessons` fails if the index is stale or an entry is malformed.

### Format

```
### short-kebab-case-slug `bug` | `correction` | `design`
The rule, stated as a pattern to check for. **Why:** the cause, if not obvious. **Applies to:** where it matters, if not obvious.
**Enforced by:** check <name> | test <script> | none - <why it needs judgement>
```

Write the rule, not the story: no symptoms, no "tried A then B", no commit hashes. Use a slug, never a number. If a lesson already covers the pattern, extend it. Prefer enforcing a lesson: a code pattern goes into `scripts/checks/lesson-checks.mjs`, a behaviour into a test that would fail without the fix.

### Before acting on a request

If a request would bring back a pattern in `docs/lessons/`, or goes against a `correction` or `design` lesson, stop, name the lesson's slug, explain the risk and ask the owner to confirm before going ahead.

---

## Branches, versions and delivery

- **Never work on `main`.** The owner works on a release branch (`release/vX.Y`), merges to `main` when the release is done, and tags it (`git tag -a vX.Y`). Deploys to Cloudflare are made from a tag.
- **Check the branch before delivering** (`git branch --show-current` on the owner's machine) and say which branch the change landed on.
- **Check the owner's copy hasn't changed** since the last delivery (compare md5 sums) before overwriting anything. If it has, work out why before writing over it.
- **Ask the owner to commit after each delivery.** Uncommitted deliveries can be lost by a later `git checkout` or branch switch (see `uncommitted-delivery-can-be-undone-by-git`).
- The owner's folder doesn't allow deletes: extract archives with `tar --overwrite`, and move anything to remove into `_to_delete/`.
- Never stage `data/` while the app may be running.
- Never ask for or accept API keys, tokens or passwords in chat. Keys go in the app's Models & Keys page, Cloudflare secrets through `npx wrangler secret put`, GitHub pushes through the owner's own sign-in.

---

## Every change: update these files

Before handing over, go through this list and update what the change touches, in the same delivery:

- [ ] `CHANGELOG.md`: a line under the current version, in plain words.
- [ ] Root `package.json` version, for a new release: `npm run release -- X.Y.Z`.
- [ ] `docs/manual.md` and its screenshots (`docs/images/manual/`) if anything a user sees changed; then `npm run manual`.
- [ ] `CLAUDE.md` (rules, layout, commands) and `README.md` (endpoints, scripts).
- [ ] A JSDoc comment on every new export, and a header comment on every new file; then `npm run docs` to rebuild `docs/API.md`, the OpenAPI file and the feature READMEs (also after `npm run release`, since the OpenAPI file carries the version).
- [ ] `apps/server/src/assistant-pages.ts` if a page or tab was added, renamed or removed.
- [ ] `docs/lessons/`: a lesson for every bug fixed, correction made or design decision; then `npm run lessons`.
- [ ] `docs/context/project-history.md` when a release ships or a decision changes.
- [ ] Tests for the behaviour, including what must be refused.

## UI and UX

How ARGUS looks and feels matters as much as what it does. Check every UI change in the browser, dark mode first, at 1440, 1366, 1280 and 390px, and look at the screenshots before handing over: alignment, spacing, overflow, contrast, and whether it matches GoldenEye's look. See the UI and UX section of `docs/lessons/web.md`.

## Testing

Before handing over: `npm run check` (ESLint, Prettier and typecheck; see `docs/CODING-STANDARDS.md`), the suites the change touches (each needs a fresh database: stop the app, `npm run db:reset`, start it), `npm run check:lessons`, and a browser pass at desktop widths (1920, 1440, 1366, 1280) and 390px, checking for console errors and horizontal scroll. The full list of suites is in `CLAUDE.md` under "Run it". Every behaviour change gets a check, including the thing that must be refused.

---

## Writing

UI text, docs and comments: plain English, short sentences, active voice, no jargon, no marketing language, no em dashes. Menu items, page titles, buttons and badges use Title Case. Each file starts with a comment saying what it is for; comments explain why, not what.
