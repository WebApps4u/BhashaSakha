# Page Design Spec (Desktop-first)

## Global Styles (All pages)
- Layout system: Hybrid CSS Grid (page scaffolding) + Flexbox (component internals). Max content width 1200px, 24px gutters, 8px spacing scale.
- Theme tokens:
  - Background: #0B1220 (app shell) and #0F172A (cards)
  - Text: #E5E7EB primary, #94A3B8 secondary
  - Accent: #6366F1 (primary), #22C55E (success), #F97316 (warning), #EF4444 (error)
  - Typography: 14/16/20/24/32 scale; headings semibold; body regular.
- Buttons: Primary (accent), Secondary (neutral outline), Danger (red). Hover: +6% brightness; Disabled: 40% opacity + no pointer.
- Links: Accent color + underline on hover.
- Loading language: “Loading…” for page loads; “Translating…” for translation requests; always provide retry on error.

## Global Meta (All pages)
- Base title: “BhashaSakha”
- Default description: “Translate content with plan-based monthly usage limits.”
- Open Graph: title/description derived from page; og:type=website.

## Shared App Shell (All pages)
- Page structure: Top navigation bar + main content area + optional right-side info panel (desktop only).
- Top nav components:
  - Left: App logo + primary nav links: Translator, Subscription & Usage; Admin visible only to admins.
  - Right: Usage pill (e.g., “12/100 requests”), user avatar menu (Profile/Sign out).

### App-wide Loading Activity Indicator
- Trigger sources:
  - Route transitions (initial load and navigation).
  - Blocking data loads for a page (usage summary, admin tables).
  - Optional: long-running translation calls.
- Visual:
  - Top-of-page slim progress bar (3px) for route/data loads.
  - Full-screen dim overlay only for first app bootstrap (prevent layout thrash).
  - For translation calls: inline spinner on the “Translate” button + optional small status line.
- Interaction states:
  - While global loading: keep nav clickable unless a hard bootstrap.
  - While translation in-flight: disable submit, keep text editable (optional), show cancel if supported.

---

## Page: Translator (Home)
### Meta
- Title: “Translator — BhashaSakha”
- Description: “Submit translation requests and track remaining monthly usage.”

### Layout
- Two-column desktop grid (8/4):
  - Left: translation workspace.
  - Right: usage + tier summary card.

### Sections & Components
1. Header strip
   - Breadcrumb: Home / Translator
   - Status chip: “Within limit” (green) or “Limit reached” (orange/red).
2. Translation workspace (card)
   - Language selectors (source/target)
   - Source textarea (with character count)
   - Translate button (primary) with inline spinner state (“Translating…”) during request
   - Result panel (read-only) with copy button
   - Error banner when request fails; show retry action
3. Quota messaging (inline)
   - If remaining quota low: warning message
   - If quota exhausted: block submission; show CTA link to Subscription & Usage
4. Right column: Usage summary card
   - Current tier name
   - Progress bars: requests used; characters used (if applicable)
   - Reset date (month boundary)

---

## Page: Subscription & Usage
### Meta
- Title: “Subscription & Usage — BhashaSakha”
- Description: “View tiers and monthly usage limits.”

### Layout
- Stacked sections, card grid for tiers (3-up on desktop).

### Sections & Components
1. Current subscription card
   - Tier name, effective date
   - Usage progress (requests/chars), remaining numbers, reset date
2. Tier catalog
   - Cards: tier name, monthly limits, “Current” badge
3. Change request panel
   - Minimal form: select desired tier + notes
   - Submit button with inline loading; success confirmation state

---

## Page: Admin Console
### Meta
- Title: “Admin Console — BhashaSakha”
- Description: “Manage tiers, user subscriptions, and usage monitoring.”

### Layout
- Left sidebar (240px) + main panel.
- Sidebar items: Plans, Users, Usage, Audit Log.

### Sections & Components
1. Plans (table + editor drawer)
   - Table columns: code, name, request limit, char limit, active
   - Actions: add/edit, activate/deactivate
   - Save action shows blocking inline spinner (not full-page)
2. Users (search + detail)
   - Search by email/user id
   - User detail card: current plan, overrides, effective date
   - Actions: set plan, set overrides, reset current month usage
3. Usage (dashboard table)
   - Filters: month, plan, threshold (e.g., >80%)
   - Table: user, plan, requests used, chars used, last updated
   - Export button (CSV) with progress state
4. Audit Log (read-only)
   - Table: time, actor, action, target, details

---

## Page: Login / Register
### Meta
- Title: “Sign in — BhashaSakha”
- Description: “Authenticate to access translation and usage features.”

### Layout
- Centered auth card (480px) with minimal distractions.

### Sections & Components
- Email/OAuth sign-in (as currently supported)
- Error messaging inline
- After auth: redirect to last intended route; show brief global loading during session bootstrap
