# General lessons

Read for every change. How the owner works, how changes reach his machine, and conventions that cut across the code.

## Working with the owner

### keep-work-proportionate-to-usage `correction`
Do the smallest change that meets the request and don't redo work that already passes. Batch tool calls, read only the parts of files you need, and don't regenerate screenshots, PDFs or demo copies unless the change affects them. **Why:** the owner pays for usage and asked for it to be kept down.
**Enforced by:** none - judgement on each task

### never-handle-secrets-in-chat `correction`
Never ask for, accept or echo API keys, tokens, passwords or connection strings in chat. Keys go on the Models & Keys page, Cloudflare secrets through `npx wrangler secret put`, GitHub pushes through the owner's own sign-in. If a secret appears in chat, don't repeat it and tell the owner to rotate it.
**Enforced by:** none - conversational rule

### goldeneye-is-read-only `correction`
GoldenEye is a reference only. You may look at it or click through it, but never change, save or delete anything there.
**Enforced by:** none - outside this repository

### generic-names-only `correction`
No trademarked service or product names belonging to a client firm, in the app, the docs or the demo data. Demo companies are fictional and marked "(demo)"; scenarios may follow public cases without naming the companies.
**Enforced by:** none - needs judgement on each name (rule 11 in CLAUDE.md)

### keep-the-qa-framing `design`
Tests have preparers and reviewers, issues have a defect-style lifecycle, and evaluations are test suites. Keep that language and structure when adding features. **Why:** the owner is a QA engineer and the product is pitched on that framing.
**Enforced by:** none - product judgement

## Delivering changes

### check-the-owners-copy-before-overwriting `correction`
Before writing files into the owner's working copy, compare md5 sums with the copy last delivered. If a file differs, find out why (his own edit, a git operation, an `npm install`) before overwriting it. `package-lock.json` usually differs after his `npm install`; leave it out of deliveries unless dependencies changed.
**Enforced by:** none - delivery step

### uncommitted-delivery-can-be-undone-by-git `bug`
A delivered change that the owner hasn't committed is lost if he later runs `git checkout`, `git switch` with a discard, `git restore` or `git stash` without popping it. After each delivery, tell him to commit, and before the next one check `git status` and confirm earlier fixes are still there. **Why:** a deploy fix, the demo fixes and dark mode were all found reverted one release later.
**Enforced by:** none - check git status before delivering

### work-on-a-release-branch-not-main `correction`
Changes go on a release branch (`release/vX.Y`), never straight to `main`. The owner merges to `main` and tags the release; deploys are made from the tag. Check the current branch before delivering and say which branch the change landed on.
**Enforced by:** none - check `git branch --show-current` before delivering

### device-folder-has-no-delete `bug`
The connected folder on the owner's machine refuses deletes. Extract archives with `tar --overwrite`, move unwanted files into `_to_delete/` with `mv -n`, and tell the owner what is there to remove.
**Enforced by:** none - environment constraint

## Writing

### plain-english-title-case-no-em-dashes `correction`
UI text, docs and comments use plain English and no em dashes. Menu items, page titles, buttons, badges and the main options on cards use Title Case ("Use Cases", "Knowledge Base", "Needs Your Approval"). A lone "—" as an empty-value placeholder in a table cell is fine.
**Enforced by:** none - review the text

### follow-the-maintainers-guides `design`
Code follows `docs/CODING-STANDARDS.md`, which is taken from the guides published by each framework's maintainers (TypeScript, typescript-eslint, the Vue style guide, Express, PostgreSQL, Zod, Prettier). `npm run check` must pass with no ESLint errors before handing over, and new code adds no `any` warnings. A formatting or lint change must not change behaviour: run the suites and compare screenshots of every page before and after. **Why:** the owner wants code a developer can follow, and most of it was written by AI.
**Enforced by:** test - `npm run check`, and the pre-commit hook (Husky and lint-staged)

### document-every-export-and-generate-the-api-docs `design`
Since v1.7.8 every exported function, constant, type and schema has a JSDoc comment (`/** ... */`) saying what it is for, and each file starts with a comment saying what the file is for. Each route function's JSDoc lists the routes it registers. The API reference (`docs/API.md`, `docs/api/openapi.json`) and a README in every feature folder are generated from the code by `npm run docs`: the route list from the real router, the permission from `permissionFor` in `auth.ts`, request fields from the Zod schemas, and each file's purpose from its header comment. Never edit those files by hand; change the code comment and run `npm run docs`. A new feature folder needs a one-line description in `scripts/docs/build-docs.mjs`, or the build fails. **Why:** the owner wants a developer to be able to find and understand anything the AI wrote, and docs written by hand drift from the code.
**Enforced by:** check exports-are-documented, check route-docs-match-routes, and `npm run check:docs` (part of `npm run check`)

## Keeping things in step

### every-change-updates-its-records `correction`
A change isn't done until the files that describe it are updated in the same delivery: `CHANGELOG.md` (what changed), the version in the root `package.json` for a new release (`npm run release`), `docs/manual.md` and its screenshots when anything a user sees changes (then `npm run manual`), `CLAUDE.md` and `README.md` when rules, layout, commands or endpoints change, `apps/server/src/assistant-pages.ts` when a page is added or renamed, `docs/context/project-history.md` when a release ships or a decision changes, and a lesson in `docs/lessons/` for every bug, correction or design decision. The checklist is in AGENTS.md.
**Enforced by:** none - checklist in AGENTS.md

### versioning `correction`
The version lives in one place, the root `package.json`, and shows under Sign Out with the git commit. Each release: `npm run release -- X.Y.Z` on the release branch (sets the version and starts the CHANGELOG section), then merge and tag `vX.Y.Z`.
**Enforced by:** none - release step
