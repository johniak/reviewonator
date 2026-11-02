# Paper Copper — Design Language

**Version:** 1.0  
**Scope:** an application for browsing Pull Requests, analyzing code changes, and conducting Code Review  
**Themes:** Paper Copper Light and Paper Copper Dark  
**Status:** design and implementation specification

---

## 1. Identity and philosophy

**Paper Copper** combines calm, warm, paper-like surfaces with precise copper accents. It should be professional and distinctive, yet almost invisible during long hours of working with code.

### Guiding principles

1. **Code first.** Code, changes, and conversation context have the highest visual priority.
2. **Quiet by default.** Neutral surfaces and thin lines; strong color only for actions, states, and selections.
3. **Warm, not vintage.** Warm hues and gentle contrasts without imitating paper texture, sepia, or skeuomorphism.
4. **Dense but legible.** Compact controls, but readable text and sufficiently large interactive targets.
5. **Semantic before decorative.** Green means addition/approval, red means deletion/error, amber means warning, copper means navigation and primary actions.
6. **Context stays visible.** The reviewer keeps their bearings: file, line, hunk, discussion, review status.
7. **Keyboard and accessibility are first-class.** Full keyboard support, clear focus, states that do not depend on color alone.
8. **Two genuine themes.** Dark mode is a separate set of tokens, not an inversion of light mode.

### Visual effect

- Light: porcelain-white content on a warm, light background; dark ink; muted copper.
- Dark: a deep brown-graphite canvas; warmer, lighter panels; light parchment text; illuminated copper.
- No gradients on base surfaces, no decorative shadows, no glassmorphism effects, and no excessive animation.

---

## 2. Color system

All components use **semantic tokens**. Raw HEX values are allowed only in token definitions and in documentation.

### 2.1. Base colors

| Usage | Light | Dark | Token |
|---|---|---|---|
| Application canvas | `#FAF7F2` | `#191714` | `--pc-bg-canvas` |
| Main content surface | `#FFFEFC` | `#24211D` | `--pc-bg-surface` |
| Elevated surface | `#FFFFFF` | `#302A24` | `--pc-bg-elevated` |
| Subtle surface | `#F3EDE5` | `#2C2722` | `--pc-bg-subtle` |
| Hover | `#F2E7DB` | `#393128` | `--pc-bg-hover` |
| Active/selected item | `#F5E7DC` | `#3A2B24` | `--pc-bg-selected` |
| Pressed state | `#E8DACC` | `#4A382C` | `--pc-bg-pressed` |
| Primary text | `#302921` | `#F1EAE0` | `--pc-fg-default` |
| Secondary text | `#71675E` | `#BBB0A1` | `--pc-fg-muted` |
| Least important text* | `#71675E` | `#BBB0A1` | `--pc-fg-subtle` |
| Standard border | `#E1D7CA` | `#49423A` | `--pc-border-default` |
| Soft border | `#EBE3D9` | `#3C3630` | `--pc-border-muted` |
| Strong border | `#C9B9A8` | `#67574A` | `--pc-border-strong` |
| Accent / link / active navigation | `#A64724` | `#F5A26D` | `--pc-accent` |
| Text on accent | `#FFFFFF` | `#191714` | `--pc-on-accent` |
| Subtle accent background | `#F8E6DA` | `#483025` | `--pc-accent-subtle` |
| Accent border | `#C97753` | `#C57E53` | `--pc-accent-border` |

\* Do not use lighter text that falls below WCAG AA for labels, metadata, or line numbers. Signal lower importance through size, weight, and layout.

### 2.2. Semantic colors

| Meaning | Light | Dark | Token |
|---|---|---|---|
| Success / approved | `#287149` | `#73C99A` | `--pc-success` |
| Danger / changes requested | `#C23B37` | `#F18D7F` | `--pc-danger` |
| Warning / pending | `#8D6000` | `#E8B76D` | `--pc-warning` |
| Info / neutral system event | `#236C83` | `#80C7DA` | `--pc-info` |
| Success badge background | `#E6F3E7` | `#213B2E` | `--pc-success-subtle` |
| Danger badge background | `#F9E6E3` | `#462724` | `--pc-danger-subtle` |
| Warning badge background | `#F7EDD8` | `#413322` | `--pc-warning-subtle` |
| Info badge background | `#E3F0F2` | `#22373B` | `--pc-info-subtle` |

**Rule:** copper serves product identity and interaction; it must not replace the green of approval, the red of errors, or the amber of warnings.

### 2.3. Diff colors

| Fragment | Light | Dark | Token |
|---|---|---|---|
| Added line | `#E6F3E7` | `#213B2E` | `--pc-diff-add-bg` |
| Deleted line | `#F9E6E3` | `#462724` | `--pc-diff-del-bg` |
| Added fragment within a line | `#BEE5C8` | `#325B3E` | `--pc-diff-add-word-bg` |
| Deleted fragment within a line | `#F4C6BE` | `#68362F` | `--pc-diff-del-word-bg` |
| Hunk header background | `#F1E7DB` | `#322C26` | `--pc-diff-hunk-bg` |
| Added line gutter | `#D5ECD9` | `#2C4A35` | `--pc-diff-add-gutter` |
| Deleted line gutter | `#F3D6D0` | `#56302B` | `--pc-diff-del-gutter` |
| Neutral gutter | `#F3EDE5` | `#2C2722` | `--pc-diff-gutter` |
| Row selection in the diff | `#F8E6DA` | `#483025` | `--pc-diff-selection` |
| Code text | `#302921` | `#F1EAE0` | `--pc-code-fg` |

**Diff rules:**

- The diff uses full but calm backgrounds; do not use garish red or green across the full width.
- A modified word has a stronger color than the rest of the changed line.
- The hunk header has a neutral-warm character; it must not be confused with an added or removed line.
- When the system contrast setting is increased, it is acceptable to strengthen the border and the `+`/`−` marker rather than necessarily the background saturation.
- Line numbers and `+`/`−` markers must be visible without interpreting color.

### 2.4. Syntax highlighting

Syntax is a layer independent of change coloring. Do not swap the semantic diff colors for language token colors.

| Syntax token | Light | Dark |
|---|---|---|
| Keyword | `#7A3FA0` | `#D9B1FF` |
| String | `#1F6B46` | `#8FD4A7` |
| Number / constant | `#8F4E12` | `#FFBC7D` |
| Function / symbol | `#265F9A` | `#8EC8FA` |
| Comment | `#71675E` | `#BBB0A1` |
| Identifier | `#302921` | `#F1EAE0` |

If a token's contrast drops when placed on the background of an added or deleted line, recompute it for that background and either apply a syntax color correction or drop part of the decorative coloring. **Legibility wins over syntax color accuracy.**

### 2.5. Contrast and accessibility

- Regular text: **minimum 4.5:1** against the actual background.
- Large text and key graphical UI elements: **3:1** respectively, in line with the applicable WCAG requirements.
- The `--pc-fg-default` on `--pc-bg-surface` pair: approximately **14.2:1** in Light and **13.4:1** in Dark.
- The `--pc-fg-muted` on `--pc-bg-surface` pair: approximately **5.5:1** in Light and **7.5:1** in Dark.
- Accent buttons: white text on copper in Light, very dark text on light copper in Dark.
- Check contrast for the **actual composited color**, including disabled, hover, selection, highlighted diff, and translucent elements.
- Distinguish states by icon, text, border, or shape, never by color alone.

---

## 3. Typography

### 3.1. Fonts

**Interface:** the system sans-serif, with no external font as a hard dependency.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto,
  "Helvetica Neue", Arial, sans-serif;
```

**Code:** a stable monospace with distinguishable `0/O` and `1/l/I` glyphs.

```css
font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
  "Liberation Mono", monospace;
font-variant-ligatures: none;
```

### 3.2. Scale

| Style | Size | Line-height | Weight | Usage |
|---|---:|---:|---:|---|
| Display | 28 px | 36 px | 600 | Main view title, rarely |
| Heading L | 22 px | 30 px | 600 | PR title |
| Heading M | 18 px | 26 px | 600 | Large sections |
| Heading S | 16 px | 24 px | 600 | Card and panel headings |
| Body | 14 px | 21 px | 400 | Default text |
| Body emphasized | 14 px | 21 px | 600 | Important labels, authors |
| Small | 12 px | 18 px | 400 | Metadata, badges, tables |
| Code | 13 px | 20 px | 400 | Diff and source code |
| Code compact | 12 px | 18 px | 400 | Optional compact mode |

**Rules:**

- Do not go below 12 px for important labels in the standard mode.
- Do not force wrapping on code when it could destroy the readability of the diff; provide horizontal scroll and a `Wrap lines` option.
- Counters and line numbers: `font-variant-numeric: tabular-nums`.
- Wrap long titles; truncate file paths from the start while preserving the ending, with the full name in a tooltip.

---

## 4. Layout, spacing, and shapes

### 4.1. Spacing tokens

Base grid: **4 px**.

| Token | px | Usage |
|---|---:|---|
| `--pc-space-1` | 4 | Icon + text, micro-spacing |
| `--pc-space-2` | 8 | Rows, padding of small controls |
| `--pc-space-3` | 12 | Elements of compact panels |
| `--pc-space-4` | 16 | Standard panels, cards |
| `--pc-space-5` | 20 | Larger sections |
| `--pc-space-6` | 24 | Groups, large gaps |
| `--pc-space-8` | 32 | Breathing room on large screens |

### 4.2. Radius and border

| Token | Value | Usage |
|---|---:|---|
| `--pc-radius-xs` | 3 px | Badge, small tag |
| `--pc-radius-sm` | 6 px | Button, input, compact card |
| `--pc-radius-md` | 8 px | Small panel, comment |
| `--pc-radius-lg` | 12 px | Dialog, popover |
| `--pc-radius-pill` | 999 px | Status capsule, avatar |
| `--pc-border-width` | 1 px | Default divider line |

### 4.3. Shadows and dividers

- Separate sections primarily with borders and distinct surfaces.
- Light shadows only in menus, dialogs, popovers, and floating panels.
- Do not apply a shadow to every PR row or file.
- Sticky header: surface + 1 px bottom border; a shadow only when needed to indicate scrolling.

### 4.4. Interaction sizes

| Control | Visual height | Comment |
|---|---:|---|
| Button / input compact | 28 px | For dense desktop toolbars |
| Button / input default | 32 px | Default desktop variant |
| Button / input comfortable | 40 px | Dialogs, forms, mobile |
| Standard icon | 16 px | A consistent family of line icons |
| Section icon | 20 px | Headings, sidebar |
| Avatar compact | 24 px | Rows and timeline |
| Avatar regular | 32 px | Comments |

Where touch accessibility rules require it, enlarge the **hit area** without artificially enlarging all visual elements.

---

## 5. Information architecture

The system has three primary surfaces and one shared set of patterns.

1. **PR List** — find, filter, and pick work to review.
2. **PR Overview / Conversation** — understand the intent, the course of the conversation, and merge readiness.
3. **Files Changed / Diff Review** — analyze code, discuss lines, and finalize the review.
4. **Shared overlays** — search, action menus, dialog, notification, preferences, command palette.

### 5.1. Global application frame

- Main bar: product/project, repository, search, notifications, profile.
- Repository subheader: name, active section, context.
- The canvas provides a warm background; the main work areas use the `surface` color.
- Do not use an elaborate marketing hero or decorative blocks in tool screens.

### 5.2. Responsive layout

| Viewport width | Layout |
|---|---|
| `>= 1440 px` | File tree + diff + optional discussion panel |
| `1024–1439 px` | Diff + collapsible file tree; discussion in a drawer |
| `768–1023 px` | One main panel; files and discussion as overlay/drawer |
| `< 768 px` | Reading and simple comments; unified diff, simplified toolbar |

Recommended widths: file panel **240–300 px**, context panel **300–360 px**, main diff as flexible as possible; for a comfortable `split diff` prefer **at least 800 px** of width for the code area.

---

## 6. PR List

### 6.1. Row elements

Each row contains:

- PR state (icon + optional label),
- title (the strongest typographic accent),
- number, author, and time,
- source/target branch, if relevant,
- labels and comment/review counters,
- CI and review summary,
- an action menu that is also reachable from the keyboard.

**Height:** about 56–76 px depending on metadata; in compact mode about 44–56 px. Do not turn every PR into a large card.

### 6.2. Filtering and navigation

- A search bar with a clear placeholder, status filters, and sorting.
- The active filter is highlighted with the accent and a label; it can be removed individually.
- States: `Open`, `Draft`, `Merged`, `Closed`.
- While loading, preserve the list structure; a skeleton may replace only the values.
- The empty state explains why there are no results and offers a useful action.

### 6.3. Interactions

- Hover highlights the row with `--pc-bg-hover`.
- Selection/keyboard navigation uses `--pc-bg-selected` and a visible focus.
- The row opens the PR; buttons and links inside it keep their own actions (no nesting of interactive HTML elements).
- On narrow screens metadata is reduced, but the title and status never disappear.

---

## 7. PR Overview / Conversation

### 7.1. Hierarchy

1. **Title + PR number**.
2. **Status + author + branch relationship**.
3. **Tabs:** `Conversation`, `Commits`, `Checks`, `Files changed` with counters.
4. **Main column:** description and activity timeline.
5. **Side column:** reviewers, labels, assignees, linked issues, merge readiness summary.

### 7.2. Timeline

Visually distinguish:

- Full comment — frame, header, author, Markdown content, reactions, replies.
- Commit, assignment, status change, review, check — a compact event with an icon and text.
- Review outcome — semantic color and an unambiguous label.
- Merge readiness — a separate, easily scannable block.

**Important:** the multitude of events must not make them all look like equal, heavy cards.

### 7.3. Markdown and comments

- Render paragraphs, lists, tables, quotes, checkboxes, links, and code blocks.
- Code blocks have their own typography and horizontal scroll.
- `Edit` opens the editor in place when possible.
- The action menu reveals functions only after interaction, but is reachable from the keyboard.

---

## 8. Files Changed — the main review screen

### 8.1. Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ PR title · status · tabs · summary of changed files                        │
├──────────────────┬───────────────────────────────────┬──────────────────────┤
│ FILE TREE        │ DIFF VIEWER                       │ CONTEXT / REVIEW     │
│ Search files     │ Toolbar: split / unified          │ Threads              │
│ Filters          │ File header                       │ Pending comments     │
│ Folder           │ Hunk headers                      │ Review checklist     │
│   file A         │ + and − code lines                │ Submit review        │
│   file B         │ Inline threads                    │ Merge readiness      │
│ Folder           │ Next file ...                     │                      │
└──────────────────┴───────────────────────────────────┴──────────────────────┘
```

The central diff is primary. The side panels are collapsible, have predictable widths, and must not suddenly resize the diff when a comment is opened.

### 8.2. Toolbar

Includes:

- `Unified / Split` — view toggle,
- `Hide whitespace` — optional filter,
- file filter and sorting,
- commit range selection,
- `Wrap lines` — user preference,
- the summary `N files changed`, `+A`, `−D`,
- the `Review changes` / `Submit review` action.

Low-frequency actions go into a menu; the basic toggles stay visible.

### 8.3. File tree

- Paths with directory hierarchy, file type icons, and change state.
- Modified, added, deleted, renamed, and binary files have clear labels/icons.
- `+N/−N` counters shown on demand or in an appropriate place next to the name.
- The `Viewed` state is remembered within the PR and used in filters.
- The active file has a subtle copper highlight; the tree automatically reveals the active item.
- After clicking a file, preserve context: scroll to the header, update the address/anchor, and set focus according to the kind of interaction.

### 8.4. File header

Order:

1. State icon and file path.
2. Added/deleted line counters.
3. `Viewed`.
4. Collapse/expand.
5. File menu and available actions.

The header sticks to the top edge while browsing a file, as long as it does not collide with the sticky toolbar.

### 8.5. Diff anatomy

- **Gutter** for old and new line numbers; in a unified diff do not confuse the two numberings.
- A `+`/`−` column or equivalent semantic markers.
- The code itself in monospace.
- A hunk header with function/section context, on a background different from added/deleted lines.
- The inline comment anchor appears on hover/focus and can anchor a **range of multiple lines**.
- In a split diff align both columns properly; do not lose the context of empty alignment lines.
- For long lines, predictable horizontal scroll or a deliberately enabled `Wrap lines`.
- For very long files: load/scroll efficiently without breaking text selection and line navigation.

### 8.6. Special changes

These must be handled without breaking the layout:

- new, deleted, and renamed files,
- permission changes,
- binary or unavailable diffs,
- very large files / a diff skipped due to size,
- missing trailing newline,
- tiny and very large hunks,
- a comment on a line that no longer exists in the current change range,
- whitespace-only changes,
- very long file names and paths.

---

## 9. Inline comments and review threads

### 9.1. Comment structure

1. Anchor to a line or range in the code.
2. Header: avatar, author, time, status, menu.
3. Markdown content.
4. Reactions and local actions.
5. Replies in the thread.
6. Reply field and actions, if the user has permission.

**Appearance:** `--pc-bg-surface` surface, `--pc-border-default` border, 8 px radius; the header uses `--pc-bg-subtle` only when it helps the hierarchy. Do not decorate comments with large colored backgrounds.

### 9.2. Thread states

| State | Visualization | Behavior |
|---|---|---|
| Open | Standard frame and label | Can be replied to and resolved |
| Pending / draft | Amber icon + `Pending` | Visible to the author of the draft review according to permissions |
| Resolved | Dimmed frame + check + `Resolved` | Collapsed or reduced by default |
| Outdated | `Outdated` label + reference to the old diff | Preserve history and source context |
| Reopened | Clear activity message | Returns to open threads |

**Never** assume that a resolved comment can be deleted. Review history is part of the decision documentation.

### 9.3. Adding a comment

- Hover/focus in the gutter → `Add comment` button.
- Click or select a range of lines → open the editor **next to the code**, without losing position.
- The editor supports Markdown, preview, and the `Add to review` / `Comment now` actions according to the adopted product model.
- A draft must not vanish after an accidental tab switch, scroll, or panel close without an appropriate warning or autosave.
- After publishing, preserve the reference to the file, line, diff side, and code revision.

### 9.4. Right review panel

The panel should make it easier to navigate between discussions, not duplicate the entire diff.

- A list of open threads with file and line.
- `All / Unresolved / Pending / Resolved` filters.
- A counter of comments waiting to be sent.
- Clicking a thread → jump to the corresponding place in the diff.
- An overview of potential review blockers and a clear finalization action.

---

## 10. Finalizing the review

### 10.1. Three decisions

| Action | Meaning | Color |
|---|---|---|
| **Comment** | Publish feedback without approval | Neutral |
| **Approve** | Approve the changes | `--pc-success` |
| **Request changes** | Mark required fixes | `--pc-danger` |

For these decisions use **radio/select with labels and descriptions**, not three identical buttons without explanations.

### 10.2. Review window

- A clear title, the number of pending comments, a field for the summary.
- Single-selection choice of the decision.
- Visible conditions and consequences of the action.
- The primary CTA carries the semantic name of the action, e.g. `Submit review`.
- Controls unavailable due to permissions have a justification.
- Before sending, display and verify exactly what will be published.
- A send error must not delete the written content.

### 10.3. Review statuses

- `Approved` — green icon + text.
- `Changes requested` — red icon + text.
- `Pending review` — amber icon + text.
- `Commented` — neutral icon + text.
- `Dismissed` / `Stale` — a secondary status with a clear explanation.

---

## 11. Component catalog

| Component | Variants / states | Usage |
|---|---|---|
| Button | primary, secondary, subtle, danger; rest/hover/focus/disabled/loading | Main actions |
| IconButton | standard, selected, danger; tooltip + label | Toolbar, contextual actions |
| Input / SearchInput | normal, focus, invalid, disabled | Filtering, search |
| Textarea / MarkdownEditor | edit, preview, draft, error | Comments |
| Badge | neutral, accent, success, danger, warning, info | Metadata and statuses |
| Tabs | active/inactive, badges, overflow | PR sections |
| TreeView | folder, file, selected, viewed, collapsed | Change hierarchy |
| DiffViewer | unified, split; added/deleted/hunk/context | Code analysis |
| CommentThread | open, pending, resolved, outdated | Line discussion |
| TimelineItem | event, comment, review, status change | PR history |
| Dropdown / Menu | keyboard nav, separator, destructive action | Infrequent commands |
| Popover | contextual, close, focus return | Auxiliary actions |
| Drawer / SidePanel | left, right, resizable, dismissible | Files and threads |
| Dialog | default, confirm, destructive | Actions requiring a decision |
| Toast / InlineAlert | info, success, warning, error | Feedback |
| Skeleton | list, card, diff metadata | Waiting for data |
| EmptyState | no results, no comments, no files | No data |

### 11.1. Buttons

- **Primary:** copper background, text in `--pc-on-accent`, minimum radius 6 px.
- **Secondary:** subtle background or surface, border, standard text.
- **Subtle:** no distinct background at rest, hover marks the interaction.
- **Danger:** red meaning only for a genuinely destructive action; `Request changes` does not have to be a destructive solid button.
- **Success:** green for the positive approving decision, not for the global primary action.
- Loading blocks a repeated send and does not abruptly change the button's width.

### 11.2. Icons

- A uniform outline style, 16 px in toolbars, 20 px in larger sections.
- Important states: icon + readable label (not color alone).
- Icon-only buttons have an `aria-label` and a tooltip; the tooltip does not replace the accessibility label.
- Do not mix line icons with heavy, colorful system illustrations.

### 11.3. Badges and markers

- Small, calm, usually 12 px text, radius 3–999 px depending on function.
- Review statuses: a light semantic background and clear content.
- Repository labels may have their own colors, but adequate text contrast must be enforced automatically.

---

## 12. Interactions and motion

### 12.1. Hover, focus, active

- Hover: `--pc-bg-hover`, without shifting the layout.
- Selected: `--pc-bg-selected`, optionally a 2 px left bar in `--pc-accent`.
- Focus: a clear 2 px ring with a 2 px offset, contrasting on every actual background.
- Active / pressed: `--pc-bg-pressed`.
- Disabled: reduced visual prominence, but without removing information about the reason when it is needed.

### 12.2. Animations

- Fast hover/focus transitions: about **120–160 ms**.
- Opening panels: about **160–220 ms**.
- No animating the diff width while reading when it causes large content jumps.
- `prefers-reduced-motion: reduce`: remove non-essential motion; keep the information about the state change.

### 12.3. Keyboard

- `Tab` / `Shift+Tab` works logically throughout the UI.
- `Enter` activates a button or link; `Space` a button and checkbox according to semantics.
- `Escape` closes a menu/drawer/dialog wherever this does not lead to losing work.
- `ArrowUp` / `ArrowDown` operate menu and tree items according to their ARIA pattern.
- Shortcuts for the next/previous change and the next unresolved thread are welcome, but **configurable**, documented, and must not conflict with typing in the editor.
- After a dialog closes, focus returns to the element that opened it, unless the performed action clearly changes the place of work.

---

## 13. Themes: behavior and preferences

- User setting: `System`, `Light`, `Dark`.
- `System` respects `prefers-color-scheme`.
- A manual choice takes precedence over the system setting and is remembered.
- The theme must be applied before the first visual render to avoid a flash of the wrong background.
- Switching the theme does not reset the current PR, scroll position, open panels, filters, or drafts.
- Optional: `Compact density`, `Wrap lines`, `Split/Unified`, code font size — independent of the theme.
- High contrast and system accessibility preferences should be separate layers on top of the palettes, not hidden exceptions in individual components.

---

## 14. CSS tokens — reference implementation

The definition below is the **source of truth** for the base colors. Components consume the semantic variables, not their own HEX values.

```css
:root,
[data-theme="light"] {
  color-scheme: light;

  --pc-bg-canvas: #FAF7F2;
  --pc-bg-surface: #FFFEFC;
  --pc-bg-elevated: #FFFFFF;
  --pc-bg-subtle: #F3EDE5;
  --pc-bg-hover: #F2E7DB;
  --pc-bg-selected: #F5E7DC;
  --pc-bg-pressed: #E8DACC;

  --pc-fg-default: #302921;
  --pc-fg-muted: #71675E;
  --pc-fg-subtle: #71675E;
  --pc-border-default: #E1D7CA;
  --pc-border-muted: #EBE3D9;
  --pc-border-strong: #C9B9A8;

  --pc-accent: #A64724;
  --pc-on-accent: #FFFFFF;
  --pc-accent-subtle: #F8E6DA;
  --pc-accent-border: #C97753;

  --pc-success: #287149;
  --pc-danger: #C23B37;
  --pc-warning: #8D6000;
  --pc-info: #236C83;
  --pc-success-subtle: #E6F3E7;
  --pc-danger-subtle: #F9E6E3;
  --pc-warning-subtle: #F7EDD8;
  --pc-info-subtle: #E3F0F2;

  --pc-diff-add-bg: #E6F3E7;
  --pc-diff-del-bg: #F9E6E3;
  --pc-diff-add-word-bg: #BEE5C8;
  --pc-diff-del-word-bg: #F4C6BE;
  --pc-diff-hunk-bg: #F1E7DB;
  --pc-diff-add-gutter: #D5ECD9;
  --pc-diff-del-gutter: #F3D6D0;
  --pc-diff-gutter: #F3EDE5;
  --pc-diff-selection: #F8E6DA;
  --pc-code-fg: #302921;

  --pc-syntax-keyword: #7A3FA0;
  --pc-syntax-string: #1F6B46;
  --pc-syntax-number: #8F4E12;
  --pc-syntax-function: #265F9A;
  --pc-syntax-comment: #71675E;
  --pc-syntax-identifier: #302921;
}

[data-theme="dark"] {
  color-scheme: dark;

  --pc-bg-canvas: #191714;
  --pc-bg-surface: #24211D;
  --pc-bg-elevated: #302A24;
  --pc-bg-subtle: #2C2722;
  --pc-bg-hover: #393128;
  --pc-bg-selected: #3A2B24;
  --pc-bg-pressed: #4A382C;

  --pc-fg-default: #F1EAE0;
  --pc-fg-muted: #BBB0A1;
  --pc-fg-subtle: #BBB0A1;
  --pc-border-default: #49423A;
  --pc-border-muted: #3C3630;
  --pc-border-strong: #67574A;

  --pc-accent: #F5A26D;
  --pc-on-accent: #191714;
  --pc-accent-subtle: #483025;
  --pc-accent-border: #C57E53;

  --pc-success: #73C99A;
  --pc-danger: #F18D7F;
  --pc-warning: #E8B76D;
  --pc-info: #80C7DA;
  --pc-success-subtle: #213B2E;
  --pc-danger-subtle: #462724;
  --pc-warning-subtle: #413322;
  --pc-info-subtle: #22373B;

  --pc-diff-add-bg: #213B2E;
  --pc-diff-del-bg: #462724;
  --pc-diff-add-word-bg: #325B3E;
  --pc-diff-del-word-bg: #68362F;
  --pc-diff-hunk-bg: #322C26;
  --pc-diff-add-gutter: #2C4A35;
  --pc-diff-del-gutter: #56302B;
  --pc-diff-gutter: #2C2722;
  --pc-diff-selection: #483025;
  --pc-code-fg: #F1EAE0;

  --pc-syntax-keyword: #D9B1FF;
  --pc-syntax-string: #8FD4A7;
  --pc-syntax-number: #FFBC7D;
  --pc-syntax-function: #8EC8FA;
  --pc-syntax-comment: #BBB0A1;
  --pc-syntax-identifier: #F1EAE0;
}

:root {
  --pc-space-1: 4px;
  --pc-space-2: 8px;
  --pc-space-3: 12px;
  --pc-space-4: 16px;
  --pc-space-5: 20px;
  --pc-space-6: 24px;
  --pc-space-8: 32px;

  --pc-radius-xs: 3px;
  --pc-radius-sm: 6px;
  --pc-radius-md: 8px;
  --pc-radius-lg: 12px;
  --pc-radius-pill: 999px;
  --pc-border-width: 1px;

  --pc-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter,
    Roboto, "Helvetica Neue", Arial, sans-serif;
  --pc-font-code: ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, "Liberation Mono", monospace;

  --pc-control-compact: 28px;
  --pc-control-default: 32px;
  --pc-control-comfortable: 40px;
  --pc-focus-width: 2px;
}

/* Example base, not a complete component library. */
.pc-app {
  background: var(--pc-bg-canvas);
  color: var(--pc-fg-default);
  font: 14px / 1.5 var(--pc-font-ui);
}

.pc-panel {
  background: var(--pc-bg-surface);
  border: 1px solid var(--pc-border-default);
  border-radius: var(--pc-radius-md);
}

.pc-button--primary {
  background: var(--pc-accent);
  color: var(--pc-on-accent);
  border: 1px solid transparent;
  border-radius: var(--pc-radius-sm);
  min-height: var(--pc-control-default);
}

.pc-app :focus-visible {
  outline: var(--pc-focus-width) solid var(--pc-accent);
  outline-offset: 2px;
}

.pc-diff-line--added { background: var(--pc-diff-add-bg); }
.pc-diff-line--deleted { background: var(--pc-diff-del-bg); }
.pc-diff-word--added { background: var(--pc-diff-add-word-bg); }
.pc-diff-word--deleted { background: var(--pc-diff-del-word-bg); }
.pc-diff-line { color: var(--pc-code-fg); font-family: var(--pc-font-code); }

@media (prefers-reduced-motion: reduce) {
  .pc-app *, .pc-app *::before, .pc-app *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Implementation note:** on the colored background of a diff row, text selection and specific syntax tokens may require additional contrast overrides. The defined colors are a starting point, and the final sets of combinations must pass an audit in the finished component.

---

## 15. Technical requirements

### 15.1. Component architecture

- One `tokens` package + one package of shared components + domain components for PR/diff/review.
- Semantic tokens as the only color contract between the theme engine and the UI.
- Do not duplicate entire layouts for light/dark.
- Every component must support the `rest`, `hover`, `focus-visible`, `active/selected`, `disabled`, and `loading` states where applicable.
- Domain components must not assume a single programming language, file type, or a single provider data structure.

### 15.2. Performance

- Large PR lists and huge diffs require sensible pagination or virtualization.
- Virtualization must not break line navigation, selection, comment anchors, screen readers, or history browsing.
- Jumping to a comment must scroll to an actually loaded fragment; the position must not be computed from an arbitrary row height if rows are variable.
- Search and filters should not rebuild the entire tree and all syntax highlighting on every keystroke.
- The `Viewed` selection and collapsed files should not disappear after data refreshes during a session.

### 15.3. Content security

- Render comment Markdown and PR descriptions in an XSS-resistant way.
- Escape/untrusted rendering for branch names, paths, titles, logs, and commit content.
- Do not inject HTML from syntax highlighting without sanitization/safe token rendering.
- Changes and comments are data; they must not alter system labels or interface behavior.

---

## 16. Tests and acceptance criteria

### 16.1. Automated tests

- **Unit:** token resolution, statuses, filters, component logic, state behavior.
- **Component:** all variants and states in both themes.
- **E2E:** PR list → overview → files → add comment → pending → submit review → resolved/reopened.
- **Accessibility:** HTML/ARIA semantics, focus order, keyboard only, role/label, contrasts; automated tests plus manual checks with a screen reader.
- **Visual regression:** light/dark screenshots, list views, overview, split/unified, comments, badges, dialogs, and error states.
- **Performance:** a large diff with many files, comments, and exceptionally long lines.

### 16.2. Screenshot matrix

| Case | Light | Dark |
|---|:---:|:---:|
| PR list: empty and full | ✓ | ✓ |
| PR overview: comments and CI | ✓ | ✓ |
| Diff unified: add/delete/hunk | ✓ | ✓ |
| Diff split: changed word | ✓ | ✓ |
| Comment: pending / resolved / outdated | ✓ | ✓ |
| Submit review dialog | ✓ | ✓ |
| File tree: selected / viewed / collapsed | ✓ | ✓ |
| Hover / focus / disabled controls | ✓ | ✓ |
| Responsive: desktop / tablet / mobile | ✓ | ✓ |

### 16.3. Definition of "done"

A solution complies with Paper Copper when:

1. All key views use exactly the same semantic tokens.
2. Light and Dark look like one family, but have separately tuned surfaces and contrast.
3. Code is the main work surface, and the panels are collapsible.
4. Added/deleted lines and fragments remain unambiguous in both themes.
5. Comments are permanently attached to the correct file, line, range, and revision.
6. Pending / submitted / resolved / outdated are distinguishable states in both content and appearance.
7. Review submission separates `Comment`, `Approve`, and `Request changes`.
8. The most important flows are available from the keyboard alone.
9. Components pass contrast verification and screenshot regression in both themes.
10. No unrelated, decorative elements distract attention from the code.

---

## 17. Do and don't

| Do | Don't |
|---|---|
| Use copper for the active element and the main CTA | Color all headings and frames copper |
| Build hierarchy through size, weight, and subtle borders | Separate every element with a large shadow |
| Keep code and comments close together | Open a comment on a separate, context-free page |
| Use separate add/delete backgrounds and word highlights | Mark changes with green/red text color alone |
| Preserve drafts, scroll, focus, and selections | Reset the user's position after every view change |
| Show the meaning of a state with an icon and a label | Require states to be told apart by color alone |
| Use warm surfaces without textures | Add paper imitation, leather textures, gradients |
| Design and test Light and Dark in parallel | Build Light first, then automatically invert the colors |

---

## 18. Short implementation brief

> Implement the PR and Code Review interface in the **Paper Copper Design Language**. Use the defined CSS tokens in two independent Light/Dark themes. Warm surfaces, ink text, and a copper accent dominate; green and red remain strictly semantic for diffs and review decisions. Main screens: a compact PR list, an overview with an activity timeline, and above all a three-area diff review with a file tree, a virtualized diff, and a comments panel. Account for the full thread and review lifecycle, keyboard navigation, responsiveness, accessibility, draft persistence, content safeguards, and automated visual tests of both themes. Do not add visual ornaments unrelated to working on code.

**Priority:** usability of multi-hour code review > information density > brand distinctiveness > decorativeness.
