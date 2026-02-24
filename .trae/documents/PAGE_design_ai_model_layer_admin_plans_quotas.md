# Page Design — AI Model Layer (Desktop-first)

## Global Styles
- Theme: light-first with optional dark mode.
- Tokens (example):
  - Background: #0B1220 (dark shell) / #F7F8FA (light)
  - Surface: #111A2E / #FFFFFF
  - Primary: #4F46E5; Success: #16A34A; Warning: #F59E0B; Danger: #DC2626
  - Text: #0F172A / #E5E7EB; Muted: #64748B
  - Font: Inter/system; scale 12/14/16/20/24/32
  - Buttons: solid primary + subtle secondary; hover = +4% brightness; disabled = 40% opacity
  - Tables: sticky header, zebra rows, right-aligned numeric columns
- Layout grid: 12-col max width 1200–1360px; page gutters 24px.

---

## 1) Login Page
### Layout
Centered card using Flexbox; background illustration optional; responsive collapses to full-width card on small screens.

### Meta Information
- Title: "Sign in — Model Layer"
- Description: "Authenticate to manage or use AI models."
- OG: same title/description.

### Page Structure
- Header-less minimal page.
- Main: Auth card.
- Footer: small links (privacy/terms).

### Sections & Components
1. Auth Card
   - Tabs: "Email" (default) (optional SSO buttons if enabled).
   - Inputs: email, password.
   - Primary CTA: "Sign in".
   - Secondary: "Forgot password".
2. Post-auth routing
   - If role=admin -> /admin; else -> /app.

---

## 2) Admin Console
### Layout
Hybrid: left sidebar + top bar + main content. Sidebar fixed (280px), main content scrolls; tables use CSS Grid for alignment.

### Meta Information
- Title: "Admin Console — Model Layer"
- Description: "Configure providers, models, routing, plans, and quotas."
- OG: same.

### Page Structure
- Top Bar: environment badge + global search + user menu.
- Left Sidebar Nav:
  - Providers & Keys
  - Models
  - Routing & Fallbacks
  - Plans & Entitlements
  - User Assignments
  - Usage & Audit
- Main Panel: section header + primary actions + table/detail split.

### Sections & Components
1. Providers & Keys
   - Provider Table: name, status, base URL, updated.
   - Provider Drawer: edit fields, disable toggle.
   - Keys Subtable: key label, status, priority, last used, rotate action.
   - Key Create Modal: paste key (masked), label, priority, environment tag.
2. Models
   - Model Table: internal model_id, display name, modality, status.
   - Model Editor: mappings list (provider + provider_model_name), status, notes.
   - Deprecation UI: warning banner when disabling/deprecating.
3. Routing & Fallbacks
   - Policy Builder (form + JSON preview):
     - Primary selection: provider + key strategy (priority/round-robin).
     - Fallback chain: ordered list (drag & drop), conditions (timeout/5xx/rate_limit), max attempts.
   - Test Panel: dry-run routing against sample error scenarios (no real calls).
4. Plans & Entitlements
   - Plans List: name, status.
   - Entitlements Matrix: rows=models, columns=enabled + quotas.
   - Inline quota editor: requests/month and tokens/month.
   - Validation: prevent enabling model without routing configured.
5. User Assignments
   - User lookup: email search.
   - Assign plan: dropdown + save.
   - Overrides: per-model enable/disable + quota overrides with clear “inherits plan” state.
6. Usage & Audit
   - Filters: date range, plan, user, model, provider, status.
   - KPIs: total requests, tokens, failures, fallback rate.
   - Usage Table: timestamp, user, model, provider, tokens, status.
   - Audit Log: config entity, action, actor, diff summary.

Interaction/States
- Empty states with "Create provider/model/plan" CTAs.
- Danger-confirmation for disable/delete; toast notifications for saves.

---

## 3) User Console
### Layout
Top bar + main card grid; model list as table on desktop, collapses to cards on smaller screens.

### Meta Information
- Title: "Model Selection — Model Layer"
- Description: "Choose an allowed model and track your quota."
- OG: same.

### Page Structure
- Header: current selected model pill + change button.
- Main:
  - Allowed Models panel
  - Quota panel
  - Recent usage panel

### Sections & Components
1. Allowed Models
   - Table: display name, model_id, remaining requests/tokens, resets at, status.
   - Row action: "Select" sets current model_id.
2. Quota & Warnings
   - Quota cards per selected model: remaining + progress bar.
   - Warning banners: “near limit” (80%) and “blocked” (100%).
3. Recent Usage
   - Small table: time, model, tokens, status.
   - Minimal detail view (no admin