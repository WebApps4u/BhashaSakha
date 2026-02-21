# UI/UX Redesign – Page Design Specification (Desktop-first)

## Global Design System
- Layout: Hybrid CSS Grid (page scaffolding) + Flexbox (component internals). 12-column grid, max content width 1200–1280px, generous whitespace.
- Visual hierarchy: One primary action per screen; secondary actions grouped under “More”. Use typography + spacing instead of heavy borders.
- Color tokens:
  - Background: #0B0F14 (dark) and #FFFFFF (light); default = light with optional dark toggle.
  - Primary: #2563EB; Success: #16A34A; Warning: #F59E0B; Danger: #DC2626.
  - Neutrals: slate scale (50–950). Dividers at 10–12% opacity.
- Typography: Inter / system UI. Scale: 12, 14, 16, 20, 24, 32. Use 16 as body.
- Buttons:
  - Primary: solid, medium radius (10–12px), strong contrast.
  - Secondary: subtle outline or “ghost”.
  - Destructive: red text + confirm step.
- States: Focus rings always visible for keyboard. Loading uses inline spinners (no full-page blockers unless exporting).
- Motion: 150–200ms transitions for hover/focus; avoid distracting animation during live sessions.

## Page 1: Live Session (/live)
### Meta Information
- Title: “Live Session – Real-time Captions & Translation”
- Description: “Start real-time transcription and translation in one click.”
- Open Graph: title + short description + product thumbnail.

### Page Structure
- Two-column layout:
  - Left: Control rail (fixed width ~320px).
  - Right: Live canvas (fluid).

### Sections & Components
1. Top App Bar
   - Left: product mark + “Live” breadcrumb.
   - Center (optional): session title (editable inline after first save).
   - Right: Account (avatar) + theme toggle.

2. Control Rail (progressive disclosure)
   - Primary CTA block:
     - “Start Capture” / “Pause” / “Stop” (single prominent button that changes state).
     - Status chip: Live / Paused.
   - Language block:
     - Source language dropdown + “Auto-detect” toggle.
     - Target language dropdown (optional; hidden if transcription-only).
   - Audio block:
     - “Input source” select (mic / system audio where supported).
     - Level meter (tiny, calm).
   - Sharing block:
     - “Share” primary secondary button → opens modal with Link + QR.
     - Viewer mode note: “View-only, controls hidden.”
   - More (collapsed by default): diarization, custom vocabulary, voice output.

3. Live Canvas
   - Default view: streaming transcript lines as readable cards.
     - Each card: timestamp (subtle), speaker label (if enabled), original text, translated text (if enabled) on a second line.
   - “Presentation mode” toggle: full-width large text, hides side rail.
   - Inline “Mark” action (bookmark) for later review (no complex annotation).

4. Save / Upgrade Nudges
   - Only appears when user triggers save/export:
     - Minimal modal: “Save to Dashboard” → Login / Continue as guest (if not allowed, show why).

### Responsive (desktop-first)
- <=1024px: control rail collapses to a drawer; live canvas stays primary.

## Page 2: Dashboard (/dashboard)
### Meta Information
- Title: “Dashboard – Sessions”
- Description: “Your saved live sessions and exports.”

### Page Structure
- Header + content list.

### Sections & Components
1. Header
   - Primary CTA: “New Live Session” (top-right).
   - Search input (center-left).
   - Filters row (chips): All / Live / Saved / Processing / Exported.

2. Session List (table-like cards)
   - Each row/card: title, date, language pair, duration, status.
   - Quick actions: Open, Rename, Delete (under kebab menu).

3. Empty State
   - Minimal illustration + “Start your first live session”.

## Page 3: Session Editor (/session/:id)
### Meta Information
- Title: “Editor – Session”
- Description: “Edit transcript, captions, and exports.”

### Page Structure
- Three-pane editor:
  - Left: tool tabs (Transcript / Captions / Voice / Export).
  - Center: main editor.
  - Right: preview + properties (contextual).

### Sections & Components
1. Editor Header
   - Breadcrumb: Dashboard / Session.
   - Primary action: “Export” (always visible).
   - Secondary: “Share viewer link” (if supported).

2. Transcript Tab
   - Editable segment list with timestamps.
   - Inline speaker label edits (if diarization enabled).
   - Find/replace.

3. Captions Tab
   - Segmentation controls (merge/split).
   - Readability preview (caption blocks).
   - Minimal styling presets (e.g., Default / High Contrast).

4. Voice Tab
   - Voice selection + preview.
   - “Generate voice output” action (jobs-based).

5. Export Tab
   - Presets (Transcript / Subtitles / Voiceover) with format selection.
   - Job status area + download links.

## Page 4: Account & Billing (/account)
### Meta Information
- Title: “Account”
- Description: “Plan, usage, billing, and integrations.”

### Page Structure
- Two-column settings layout:
  - Left: settings nav.
  - Right: panels.

### Sections & Components
- Plan panel: current plan, usage meters, upgrade button.
- Billing panel: invoices, payment method.
- Integrations panel: toggle list (connect/disconnect).
- Team panel (optional): members list, invite, roles.

## Page 5: Login / Sign up (/login)
- Single card centered layout.
- After login: return you to the exact blocked action (save/export) with state preserved.
