# Coding standards

How code in ARGUS is written, and why. It follows the guides published by the maintainers of each language, framework and library ARGUS uses, plus a few project rules. ESLint and Prettier check most of it automatically (see [Tools](#tools)); the rest is for review.

If a rule here and a maintainer's guide disagree, the maintainer's guide wins: fix this file.

## Sources

| Area | Guide followed | Where it is enforced |
|---|---|---|
| JavaScript | ESLint recommended rules (`@eslint/js`) | `eslint.config.mjs` |
| TypeScript | [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html), `strict` mode; [typescript-eslint recommended](https://typescript-eslint.io/users/configs#recommended) | `tsconfig.json` in each app, `eslint.config.mjs` |
| Vue 3 | [Vue style guide](https://vuejs.org/style-guide/) (priority A, B and C rules) through [eslint-plugin-vue](https://eslint.vuejs.org/) `flat/recommended`; [Composition API with `<script setup>`](https://vuejs.org/api/sfc-script-setup.html) and [TypeScript with Vue](https://vuejs.org/guide/typescript/composition-api.html) | `eslint.config.mjs`, review |
| Pinia | [Pinia core concepts](https://pinia.vuejs.org/core-concepts/) (setup stores) | review |
| Express 4.21 | [Express routing](https://expressjs.com/en/guide/routing.html), [error handling](https://expressjs.com/en/guide/error-handling.html), [production best practices: security](https://expressjs.com/en/advanced/best-practice-security.html) and [performance](https://expressjs.com/en/advanced/best-practice-performance.html) | review, tests |
| PostgreSQL (SQL) | [PostgreSQL docs: identifiers](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS), [DDL](https://www.postgresql.org/docs/current/ddl.html) | review |
| Zod | [Zod docs](https://zod.dev/) (parse at the edge, infer types from schemas) | review |
| Node.js | [Node.js ES modules](https://nodejs.org/api/esm.html) (`node:` prefix for built-ins) | review |
| Formatting | [Prettier](https://prettier.io/docs/en/rationale.html) with the settings in `.prettierrc.json` | `npm run format:check` |

## Tools

```
npm run lint          # ESLint on the whole repository
npm run lint:fix      # ESLint, fixing what it safely can
npm run format        # Prettier rewrites code files in place
npm run format:check  # Prettier lists files that aren't formatted
npm run check         # lint + format check + typecheck + docs check: run before handing over
npm run docs          # rebuild the API reference and feature READMEs from the code
```

A pre-commit hook (Husky and lint-staged) runs ESLint and Prettier on the files being committed, so unformatted or failing code doesn't reach a commit. It is installed by `npm install` in a git checkout. Skip it only in an emergency (`git commit --no-verify`) and fix the code straight after.

ESLint errors block a commit. Warnings don't, but don't add new ones. The current warnings are all `@typescript-eslint/no-explicit-any` (about 580 at v1.7.5): replace `any` with a real type when you touch that code.

## Formatting

- Prettier decides layout: 120 characters a line, single quotes, semicolons, trailing commas. Don't hand-format around it.
- One statement a line. Don't chain side effects with commas (`if (x) (a(), (b = c))`); write a block.
- Prettier formats code only. Markdown docs and `schema.sql` are left alone (see [SQL](#sql)).
- **Vue templates and whitespace.** Prettier may move the space between two tags onto a new line. Vue's default compiler mode (`condense`) drops whitespace that contains a line break, which would join words ("IncidentsRecord"). The web app compiles templates with `whitespace: 'preserve'` (`apps/web/vite.config.ts`) so a line break between tags renders as one space, as in plain HTML. Keep that setting; if you want no space between two inline tags, put them on the same line with nothing between them.

## Folder structure

Code is organised by feature, with the same feature names in all three packages, so everything about one feature is in one place:

- **Server:** `apps/server/src/<feature>/` holds that feature's logic and its `*-routes.ts` files. `core/` holds what every feature uses (database, paths, HTTP helpers, formatters, storage). `api-router.ts` registers each feature's routes.
- **Web:** `apps/web/src/features/<feature>/` holds that feature's pages and components. `components/` holds building blocks used everywhere; `lib/` holds helpers.
- **Shared:** `packages/shared/src/<domain>.ts`, one file per domain, all re-exported from `index.ts`. Import from `@gh/shared`, never from a file inside it.

Before adding a helper, look in `core/` (server) or `lib/` (web): don't define `httpError`, `Wrap`, `toIso` or similar again in a feature file.

## Functions

- One function, one job. A function that needs a comment to separate its parts should be split into named functions (see `runCard` in `board/engine.ts`: each step is a function named after what it does).
- Route handlers stay short: parse the input, call a function that does the work, send the result. Logic that grows past a screen goes into a named function in the feature folder (see `engagements/create-engagement.ts`).
- Functions over about 100 lines are candidates to split. The list still to do is in `docs/plans/code-structure-backlog.md`.

## Naming

Names say what a thing is for, in the words the app uses (use case, control, evidence, gate). Avoid abbreviations a new reader wouldn't know.

| What | Style | Example |
|---|---|---|
| Server and shared files | kebab-case, named after the feature | `client-steps.ts`, `exit-criteria.ts` |
| Feature folders | kebab-case, the same name on server and web | `apps/server/src/controls/`, `apps/web/src/features/controls/` |
| Route files | `<thing>-routes.ts` in the feature folder, exporting `thingRoutes` | `integrations/workflow-routes.ts` |
| Row-to-record mappers | `<thing>-records.ts` in the feature folder | `issues/issue-records.ts` |
| Vue components and pages | PascalCase, at least two words (Vue style guide, priority A) | `AppIcon.vue`, `CardDrawer.vue`, `BoardPage.vue` |
| Base components used everywhere | `App` prefix (Vue style guide, priority B) | `AppIcon.vue` |
| Functions | camelCase verb phrase | `checkDueSteps`, `requirementCoverage` |
| Booleans | `is`, `has`, `can`, `should` or a plain adjective | `isMe`, `fullyMet` |
| Constants and lookup tables | UPPER_SNAKE_CASE | `FRAMEWORK_CATALOG`, `MAX_QUESTIONS` |
| Types and Zod schemas | PascalCase | `ClientStep`, `NewEngagement` |
| Database tables and columns | snake_case, tables plural | `ingest_tokens`, `workflow_mode` |
| JSON over the API | camelCase | `workflowMode`, `clientStepsDefault` |
| Unused arguments kept on purpose | leading underscore | `(_req, res) => ...` |

Short names (`q`, `c`, `r`) are fine inside a few lines where the meaning is obvious (a query handle, a loop item), not for anything that lives longer.

## TypeScript

- `strict` is on in every package. Don't turn checks off to make an error go away.
- Prefer real types to `any`. For data from the database or a request, parse with a Zod schema and use the inferred type.
- Shared shapes (API bodies, records the browser shows) live in `packages/shared/src` so the server and the web app agree.
- Use `import type` for type-only imports. Import Node built-ins with the `node:` prefix.
- Remove unused imports, variables and functions. ESLint refuses them.

## Vue

- Single-file components with `<script setup lang="ts">`, then `<template>`, then `<style scoped>` (Vue style guide, priority C order).
- Props and emits are typed: `defineProps<{ ... }>()` and `defineEmits<{ ... }>()`.
- Component names are multi-word and PascalCase, in templates and file names.
- `v-for` always has a `:key`; never put `v-if` on the same element as `v-for` (Vue style guide, priority A).
- Keep logic out of templates: anything longer than a short expression becomes a `computed` or a function.
- Shared state goes in the Pinia store (`stores/app.ts`); page state stays in the page.
- `v-html` is only for text that has been through `markdown.ts` (escaped first). ESLint warns on every other use.
- **Splitting a big screen** (v1.7.8): a page with tabs gets one component per tab (`SettingsGeneralTab.vue`), wrapped in `<KeepAlive>` so unsaved edits survive a tab switch. Where several panels share one set of state and actions, put them in a composable (`use-card-drawer.ts`, `use-workflow-builder.ts`) and pass its result to each panel as one prop. Lookup tables go in a plain `.ts` file beside the component.
- After moving markup between components, compare the rendered text of every affected page with the old version (it catches a tag or condition lost in the move), not only screenshots.
- Every UI change is checked in the browser, dark mode first, at 1440 and 390 pixels wide (AGENTS.md).

## Express

- Each feature registers its routes in its own function (`xxxRoutes(r, db, ...)`) on the shared router. Keep a route handler short: check input, call a function that does the work, send the result.
- Validate every request body and query with a Zod schema (`z.object(...).parse(req.body)`) before using it.
- Async handlers go through `wrap`, which passes errors to Express's error handler (Express 4 doesn't catch rejected promises by itself). Throw `httpError(status, message)` for errors the person should see.
- Middleware order is part of the security model (`index.ts`): request context, then routes mounted before sign-in (ingest), then auth, access, archive guard, routes. A new route must fit the rules in CLAUDE.md (RULES in `auth.ts`, OWNERS in `archive.ts`).
- Don't leak internals in error messages: no stack traces, SQL or secrets in responses.

## SQL

- Always use parameters (`$1`, `$2`). Never build SQL by joining strings with values from a request.
- Keywords in UPPER CASE, identifiers in snake_case, tables plural.
- Every write that changes a record writes its audit entry in the same transaction (`db.tx` and `logAudit(q, ...)`).
- `schema.sql` is append-only: each version adds `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at the end, and earlier statements are never edited or reformatted, because hosted databases replay it on start. That's why Prettier skips it.
- New tables go into the drop lists in `reset.ts`, and into the export and delete in `archive.ts` if they belong to an engagement.

## Comments

- Each file starts with a short comment saying what it is for and which version added it. Its first sentence is the file's line in the feature folder's README, so make it say what the file does.
- Every export (function, constant, class, type, Zod schema) has a JSDoc comment (`/** ... */`) right above it saying what it is for, in one or two sentences: what a function returns or does, what a constant holds, what a type describes. Add `@param` only where a parameter's meaning isn't clear from its name and type. A type that is only `z.infer<typeof X>` of the schema above it shares that schema's comment. Checked by `exports-are-documented`.
- A route function's JSDoc lists the routes it registers (`- GET /engagements/:id/issues`). Checked by `route-docs-match-routes`.
- Comment the why: a rule, a guardrail, a gotcha, a decision. Don't restate what the code says.
- When code enforces one of the rules in CLAUDE.md, name the rule or the lesson.
- Don't leave commented-out code; git keeps the history.

## Generated docs

`npm run docs` (`scripts/docs/build-docs.mjs`) builds these from the code; never edit them by hand:

- `docs/API.md` and `docs/api/openapi.json`: every route, from the real router, with its permission (`permissionFor` in `auth/auth.ts`), the file that registers it and its request fields (from the Zod schema the handler parses; a schema written inline in the handler is shown as code). Prefer a named schema in `@gh/shared` for a request body: it becomes typed fields in the reference.
- `README.md` in each feature folder: the feature's purpose (from `FEATURES` in the build script), each file's header comment, and its routes (server) or pages (web, from `main.ts`).

`npm run check:docs`, part of `npm run check`, fails when any of them is out of date. A new feature folder needs a line in `FEATURES`, or the build fails.

## Keeping it this way

- Run `npm run check` and the test suites before handing over (AGENTS.md).
- A bug or correction gets a lesson in `docs/lessons/` (AGENTS.md); a lesson that can be checked by code gets a check in `scripts/checks/lesson-checks.mjs`.
- A change to these standards is recorded in `CHANGELOG.md`.
