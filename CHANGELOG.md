# Changelog

What changed in each release of ARGUS, newest first. The version shown under Sign Out comes from package.json. Start a new release with `npm run release -- X.Y.Z`.

## v1.4.1 (2026-11-06)

- The assistant is a chat panel: your messages on the right, answers in cards with proper formatting (no stray asterisks), starters when a conversation is empty, a question box that grows, a wider view, and a thinking indicator.
- Cards on the board show the initials of the person who added or last changed them.
- Board filters look like GoldenEye's: Show, Kind, Priority, Person, Created and Updated, centred beside the title, with counts.
- The page you're on is highlighted light blue in the top menu.
- The version and commit show under Sign Out. `npm run release` sets the version and starts the changelog.
- Manual v1.2.3, written for the live site.

## v1.4

- The assistant sees the page you're on, keeps your conversations (new, search, carry on) and uses the workspace default model when none is picked for it.
- AGENTS.md, lessons and project history for anyone working on ARGUS. Dark mode by default. A reset refuses a hosted database.

## v1.3

- Cloudflare hosting: the server in a Container, Postgres on Neon, evidence in R2. The demo loads against a live site.

## v1.2.2

- Controls and Knowledge Base menus, icons on every menu item, Title Case, Upload Controls (CSV or Excel), the manual's "Start Here" path.

## v1.2.1

- All demo clients in one switchable demo, plus a saved copy per client.

## v1.2

- Renamed ARGUS with the pheasant logo, five steps on the board, AI as one menu, modules, responsive layout, five demo engagements from scenario files, the versions script.

## v1.1

- Use Case Planner, drag and drop, more agents per stage with routing, Act As, engagement and workspace settings, Overview charts.

## v1.0

- PDF, Excel and Word evidence, incidents, scheduled monitoring and drift, connectors, members-only engagements, single sign-on, the full manual.

## v0.3 to v0.9

- v0.9 demo data and scripts; v0.8 the assistant; v0.7 the Verifier and golden dataset; v0.6 knowledge base and grounding; v0.5 the drafting agents; v0.4 engagements and archiving; v0.3 the assurance layer.
