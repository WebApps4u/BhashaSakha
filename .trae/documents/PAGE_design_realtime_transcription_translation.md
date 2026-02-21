# Page Design — Real-time Transcription + Translation
Desktop-first specs (responsive down to tablet/mobile).

## Global Styles (Design Tokens)
- Background: `#0B1220` (app) / `#0F172A` (panels)
- Surface: `#111C33`, Border: `rgba(255,255,255,0.08)`
- Text: primary `#E5E7EB`, secondary `#94A3B8`, danger `#F87171`, success `#34D399`
- Accent: `#60A5FA` (primary buttons/links), focus ring `rgba(96,165,250,0.4)`
- Typography: Inter/system; scale 12/14/16/20/24
- Buttons: primary filled; secondary outline; disabled at 40% opacity; hover +4% brightness; pressed translateY(1px)
- Links: underline on hover; visited slightly desaturated
- Motion: 120–180ms ease-out for hover/focus, 220ms for panel transitions

## Layout System
- Use CSS Grid for page scaffolding + Flexbox within components.
- Breakpoints: desktop ≥1200px (2–3 columns), tablet 768–1199px (2 columns), mobile <768px (stacked; sticky controls).

---

## Page 1: Home
### Meta Information
- Title: “Live Transcribe & Translate — Start a Session”
- Description: “Real-time transcription and translation in your browser with sharing and exports.”
- OG: title/description + simple product image

### Page Structure
- Centered container (max-width 1040px) with stacked sections.

### Sections & Components
1. Top Nav
   - Left: product name
   - Right: “Sign in” / user menu
2. Start Session Card (primary)
   - Language selectors: Source language (single), Target languages (multi-select)
   - Mode toggle: Verbatim / Clean
   - Mic selector dropdown + input level meter
   - Primary CTA: “Start Live Session”
3. Join Session Card
   - Input: session ID / paste link
   - CTA: “Open Session”
4. Recent Sessions (signed-in)
   - Table/list: title, updated time, visibility icon
   - Actions: open, delete
5. Footer
   - Privacy note (“Audio processed for transcription/translation”) + help link

### Interaction States
- Mic permission denied: inline troubleshooting panel + retry.
- Network offline: disable start, show toast.

---

## Page 2: Live Session Workspace
### Meta Information
- Title: “Session — Live Transcription & Translation”
- Description: “View and edit live transcript with speaker labels and exports.”
- OG: session title + “Live Session” badge (avoid exposing content if restricted)

### Page Structure
- Desktop: 3-column grid
  - Left: Session + Speakers
  - Center: Transcript
  - Right: Translation + Share/Export
- Sticky top bar for transport controls.

### Sections & Components
1. Top Bar (sticky)
   - Left: Back, session title (editable inline)
   - Center: Start/Pause/Stop, timer, connection indicator (RTT ms)
   - Right: “Share”, “Export” buttons
2. Left Sidebar
   - Session details: source/target languages, visibility dropdown
   - Speakers list: “Speaker 1…N” with color chips
   - Tools: relabel speaker, merge speakers, add speaker
3. Transcript Panel (center)
   - Virtualized list of segments
   - Segment row: timestamp range, speaker chip, text (editable), “edited” badge
   - Live partial segment pinned at bottom with shimmer state
   - Controls: auto-scroll toggle, search within session
4. Translation Panel (right)
   - Tabs per target language
   - Shows translation aligned per segment; highlights segments currently translating
   - Per-segment quick actions: copy, revert to original
5. Share Modal
   - Visibility: public/unlisted/restricted
   - Generate/revoke link; copy button; warning text for public
6. Export Modal
   - Format picker: TXT/SRT/VTT/JSON
   - Options: include speakers, include timestamps, include translations (per language)
   - Download action + progress

### Editing Rules
- Edits are local immediately; auto-save debounce (e.g., 500–1000ms) to reduce churn.
- Keep original text/translation accessible via “View original” tooltip.

---

## Page 3: Shared Session
### Meta Information
- Title: “Shared Session — Transcript & Translation”
- Description: “View shared transcript and download exports (if allowed).”
- OG: generic (do not expose transcript content in meta)

### Page Structure
- Two-column desktop layout: content + right rail.

### Sections & Components
1. Header
   - Session title, visibility badge, “Open in app” (if you have access)
2. Read-only Transcript
   - Same segment list styling as workspace but locked
   - Toggle: show/hide timestamps, show/hide speakers
3. Translation Viewer
   - Language dropdown or tabs
   - Inline alignment with transcript segments
4. Downloads Panel (right rail)
   - Allowed formats list; download buttons
   - If restricted: sign-in prompt + “Request access” CTA (opens /auth)

### Responsive Behavior
- Mobile: sticky bottom bar for Download + Language; transcript full width; speakers/timestamps as toggles.
