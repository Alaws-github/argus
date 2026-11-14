# Web lessons

Read when changing `apps/web`: pages, the top bar, menus, styles and the store.

## Top bar and navigation

### top-bar-keeps-the-argus-name `correction`
On desktop widths the ARGUS name next to the logo always shows. When the bar gets crowded, shrink the engagement switcher, hide the badge and the add label, then drop the menu labels to icons (each has a tooltip), in that order. Check 1920, 1440, 1366 and 1280 for overflow after any change to the bar.
**Enforced by:** none - browser check at those widths

### navigation-order-and-names `design`
Top menu, in order: Overview, Use Cases, Controls, Registers, AI, Knowledge Base, Report, Settings. Controls and Knowledge Base are menus of their own because they are central to the work. Every menu item has a line icon from `Icon.vue`, like GoldenEye.
**Enforced by:** none - design decision

### ask-label-only-when-it-fits `design`
The top-bar assistant button shows "Ask" next to the AI mark down to 1366px wide, and the mark alone below that.
**Enforced by:** none - browser check

### e2e-selectors-follow-label-changes `bug`
Renaming a menu item, button or aria-label breaks the Playwright scripts that use it as a selector (the manual screenshots among them). Search the scripts for the old label when renaming.
**Enforced by:** none - search when renaming

## Layout

### long-menus-must-scroll `bug`
A dropdown that can grow (the account menu with its Act As list, the conversation list) gets a max height and scrolls inside itself, so its last item (Sign Out) never falls off the screen.
**Enforced by:** none - browser check at 900px height

### status-in-its-own-column `bug`
Badges such as "On" in a list of settings go in their own aligned column, not inline after text of varying length.
**Enforced by:** none - visual check

## Look

### dark-mode-by-default `design`
The app starts in dark mode for anyone who hasn't chosen a theme (the `|| 'dark'` fallback in `stores/app.ts`). A saved choice in the account menu wins.
**Enforced by:** none - check the fallback when touching the theme code

### attention-dots-blink `design`
The dot before statuses that need a person (Needs Your Approval, You Triage, Run Failed) blinks; others don't.
**Enforced by:** none - design decision

## UI and UX

### ui-ux-is-a-first-class-requirement `correction`
The owner judges ARGUS by how it looks and feels as much as by what it does. Every UI change is checked in the browser in dark mode (the default) and light mode, at 1440, 1366, 1280 and 390px wide, for alignment, overflow, readable contrast and no horizontal scroll, and compared with GoldenEye's look where one exists. Prefer polished, familiar patterns (chat panels, pill filters, menus) over plain form controls. Screenshot before handing over.
**Enforced by:** none - visual review in the browser

### ai-text-is-rendered-not-shown-raw `bug`
Text from a model is shown through `renderMarkdown` in `apps/web/src/markdown.ts`, never as raw text: models answer with `**bold**` and `- ` lists, which otherwise show as stray asterisks. The renderer escapes HTML first, so it is safe with `v-html`.
**Enforced by:** none - use renderMarkdown wherever model text is displayed

### assistant-is-a-chat-panel `design`
The assistant looks like a modern chat: your messages in bubbles on the right, answers in cards with an "Assistant" label, starter cards with icons and a greeting when a conversation is empty, a composer that grows with a round send button, a thinking indicator, conversation history with search, new conversation, wider view and close in the header. Dark first. Keep this shape when changing it.
**Enforced by:** none - design decision

### save-disabled-until-changed `design`
Every Save button stays disabled until the form differs from what was loaded or last saved. Use `useUnsaved` in `apps/web/src/lib/unsaved.ts`: call `mark()` after loading and after saving, and bind `:disabled="!u.dirty.value"`. Buttons that also conclude or submit something (Conclude, Add provider) are not covered.
**Enforced by:** none - review new forms

### board-filters-match-goldeneye `design`
Board filters are pill buttons ("Show All cards", "Kind Any", "Priority", "Person Anyone", "Created Any time", "Updated Any time") built with `FilterPill.vue`, centred beside the board title with search on the right. Cards show the initials of the person who last changed them (or added them), never an agent.
**Enforced by:** test scripts/smoke.mjs (no agent as the person on a card)

### active-menu-is-light-blue `design`
The top menu item for the page you're on is highlighted light blue (accent text on the accent background), as in GoldenEye.
**Enforced by:** none - design decision

### segmented-buttons-one-line `bug`
A segmented choice with a mark or icon (Plan with AI / Fill it in myself) keeps the mark and the label on one line: use the small `.seg-ai` mark, not the 30px `.ai-mark`, which stacks above the text.
**Enforced by:** none - visual check

## The dashboard look (v1.7)

### every-page-opens-with-kpis `design`
Each working page opens with a KPI strip (`components/KpiStrip.vue`): three to five tiles with a big number, an icon, one line of context, the first as the accent tile, each linking to where the number comes from. Numbers come from one read, `GET /engagements/:id/kpis`; add a page's tiles there and in `KpiStrip`, not with a new endpoint per page. Tabs and segmented choices are pill selectors. **Why:** the owner asked for the dashboard look on all pages.
**Enforced by:** none - visual check at 1440 and 390

### pages-wait-for-the-engagement `bug`
A page that loads data for the current engagement must wait for `app.engagementId` (watch it with `immediate: true` and return while it is empty), not load in `onMounted`. **Why:** on a direct visit (a link, a refresh) the page mounts before the engagement list loads, so it asked for `/engagements//workflows` and got a 404.
**Enforced by:** none - browser check of a direct visit

### ai-links-stay-inside-argus `design`
Links in AI answers are kept only when they point to a path inside ARGUS (one leading "/", not `/api`); record keys become links through `lib/links.ts`; anything else is shown as text. Links open with the router and leave the assistant open. **Why:** the owner wanted links to pages like Cloudflare's assistant, and model text must never carry a link out of the app.
**Enforced by:** none - markdown.ts; browser check

### the-assistant-works-in-the-open `design`
While the assistant works, its steps show live ("Working · N steps", each look-up, its own reasoning), then fold into "Worked Ns · N steps" above the answer. The answer arrives whole: no word-by-word streaming (the owner's choice). Thumbs up or down and copy sit under each answer.
**Enforced by:** test scripts/v17-test.mjs (trail, worked time, ratings)

### connectors-live-in-settings-and-start-in-place `design`
Connectors are engagement configuration, so they are managed in Settings > Connected tools beside the tools the client uses; Tests and Evidence keeps a read-only view of what they pull. Where the need arises (a workflow step in a tool ARGUS can read) the connector form opens in place and links the new connector to the step: no new tab, no losing your place. A client workflow can be drafted when the engagement is added (no credentials then). The engagement setting that decides where people approve is called "Approval gates", so "workflow" means only the client's process.
**Enforced by:** test scripts/v17-test.mjs (clientTools saved and filtered, workflow drafted with the engagement, no connector made); browser check of Settings, the builder modal and the wizard at 1440 and 390

### client-steps-make-the-workflow-useful `design`
A client workflow drawn once and never opened again is a diagram. Each client step can now say what proves it, and every use case shows its Client steps, checked in the client's tools by the use case key. The owner asked what the workflow was for; this is the answer: the client's own paper trail, checked, beside the gates people decide.
**Enforced by:** test scripts/v173-test.mjs (status, all done, wrong key, manual confirm, no new evidence on a re-check); browser check of the use case panel at 1440 and 390

### say-what-a-source-is `design`
A reviewer saw "K-55 · Risk tiers" and "Its sources share 45% of its key terms (limit, interact, duti)" and couldn't tell what either meant. Sources now say what they are (framework requirement, library control, ARGUS method, client document) and which frameworks they draw on (`describeSource`); the K-number stays, small, as the reference. Verifier verdicts say what to do (`VERDICT_ADVICE`), never show word stems, and the offline rules are called "the built-in rules (no AI model)".
**Enforced by:** test scripts/v174-test.mjs (no stems in reasons); browser check of a classification draft

### notice-is-a-flex-column `bug`
The `.notice` box lays its children out as a flex column, so a sentence with bold words and a link inside one `<p class="notice">` broke onto six lines (each inline element became its own row). Use `.notice` for a box of blocks; for a single sentence, set `display: block` on it or put the sentence inside a child element.
**Enforced by:** none - a browser check of Controls > Standards at 1440 and 390 (layout is not covered by the API tests)

### segmented-choices-in-table-cells `bug`
`.segmented` wraps by design (so long choice rows fit on phones), but in a narrow table cell that stacked Yes and No on top of each other on What Applies, and the control codes broke as "DAT-" / "01". Inside a `td`, segmented choices and codes now stay on one line (`styles.css`); the table scrolls sideways on a phone instead.
**Enforced by:** none - a browser check of Controls > What Applies at 1440 and 390 (layout is not covered by the API tests)

### menus-that-depend-on-modules-must-be-computed `bug`
The Settings menu was a plain list built once when the app loaded, before the engagement and its modules were known, so Client Workflows stayed hidden until a reload even after the module was switched on. Any menu or list that depends on `app.mod()` (or anything else that changes) must be a `computed`, like REGISTERS and AI_MENU.
**Enforced by:** none - a browser check that switches the module and opens the Settings menu without reloading (UI only)

### prettier-and-vue-whitespace `bug`
Prettier may move the space between two tags in a Vue template onto a new line. Vue's default compiler mode (`condense`) removes whitespace that contains a line break, so formatting joined words on the page ("IncidentsRecord", "Lee Lead)It applies"). Prettier's `htmlWhitespaceSensitivity: strict` doesn't help, because it still treats a space and a line break as the same. The web app compiles templates with `whitespace: 'preserve'` (`apps/web/vite.config.ts`), which renders a line break between tags as one space, as HTML does. Found by comparing screenshots of every page before and after formatting. **Why:** a formatter must never change what the page shows.
**Enforced by:** check vue-whitespace-preserve

