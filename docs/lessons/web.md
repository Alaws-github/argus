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
