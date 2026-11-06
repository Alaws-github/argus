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
