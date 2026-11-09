# Design tokens (source of truth for web and Flutter)

The website (`frontend/src/app/globals.css`) and the Flutter app (Material 3 `ThemeData`, Phase 8) are both derived from this
file, so they read as one product. Change a value here first, then in both places.

Principles: warm neutrals, **one** accent colour, amber reserved for ratings. Restraint over decoration. Motion is short, springy
where a gesture is involved, and never on keyboard-driven or high-frequency actions.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FAF9F6` | `#0E1012` | page |
| `foreground` | `#14171C` | `#ECEEF1` | body text |
| `card` | `#FFFFFF` | `#15181C` | surfaces |
| `popover` | `#FFFFFF` | `#1A1D22` | menus, dialogs, sheets |
| `primary` | `#0B7A66` | `#3FCFAE` | the accent: actions, links, selection |
| `primary-foreground` | `#FFFFFF` | `#04211A` | text on primary |
| `secondary` / `muted` | `#F1EFE9` | `#1E2227` | quiet fills, segmented controls |
| `muted-foreground` | `#5B616D` | `#9AA1AD` | secondary text |
| `accent` | `#E2F3EE` | `#12332C` | selected rows, soft emphasis |
| `accent-foreground` | `#08594A` | `#7AE3C9` | text on accent |
| `border` | `#E6E3DC` | `#272B31` | hairlines |
| `input` | `#D8D4CB` | `#343A42` | field borders |
| `ring` | `#0B7A66` | `#3FCFAE` | focus ring |
| `destructive` | `#C4302B` | `#F0605B` | errors, destructive actions |
| `success` | `#11693A` | `#4ADE80` | confirmed, paid |
| `warning` | `#8A4B00` | `#FBBF24` | awaiting, caution |
| `info` | `#1D4ED8` | `#7AA2FF` | neutral information |
| `star` | `#F59E0B` | `#FBBF24` | ratings only |

Contrast: every text/background pair above meets WCAG AA (4.5:1) in both themes. Tinted status chips use the token at 8-14% opacity
as background (`success`/`warning`/`danger`/`info` chips). This is enforced by the accessibility test suite (axe, WCAG 2.1 A/AA).

## Type

Geist Sans (UI) and Geist Mono (codes, ids). System font stack as fallback; Flutter uses the platform font with Geist bundled.

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Display (hero) | 42-72 / 1.02 | 600 | -0.035em |
| H1 | 24-36 / 1.2 | 600 | -0.02em |
| H2 | 18-24 / 1.25 | 600 | -0.02em |
| Body | 14-15 / 1.5 | 400 | 0 |
| Small / meta | 12-13 / 1.4 | 400-500 | 0 |
| Overline | 11 / 1.3 | 500 | +0.04em, upper-case |

Numbers that line up (money, counts, dates, countdowns) use tabular figures. Inputs are **16 px** on touch (iOS zooms the page for
anything smaller) and 14 px with a fine pointer.

## Shape, spacing, elevation

- Radius: base `12 px`; controls 8-10 px, cards 16 px, sheets 24 px (top corners), pills fully rounded.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56. Page gutter 16 px (phones), 24 px (tablet and up). Max content width 1280 px.
- Touch targets: at least **44 x 44 px** on touch (visual size may be smaller, the hit area is not).
- Elevation: hairline border first, shadow second. Cards `0 1px 2px / 6%`; popovers `0 8px 24px / 14%`; modals `0 24px 64px / 28%`. Shadow colour is the foreground at low opacity.

## Motion

| Token | Value | Use |
|---|---|---|
| `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | entering, press feedback, hover |
| `ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | things moving on screen |
| `ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | side panels, bottom sheets |
| `press` | 100-160 ms, `scale(0.97)` on pointer-down | every pressable thing |
| `enter` | 150-250 ms; popovers scale from 0.95 + fade, from the trigger | menus, tooltips, dialogs |
| `exit` | 100-150 ms (faster than enter) | everything that closes |
| `sheet` | 300 ms `ease-drawer`; gestures use a spring, damping ~0.8 only when the gesture had momentum | drawers |

Rules: never animate from `scale(0)`; never `ease-in` on UI; animate `transform` and `opacity` only; no animation on keyboard
actions; respect reduced motion (opacity-only fallbacks, no parallax or springs); skip the delay on subsequent tooltips.
Flutter mapping: `Curves.easeOutQuint` ~ `ease-out`; bottom sheets use `DraggableScrollableSheet` with a spring; press feedback via
`AnimatedScale(0.97)`.

## Patterns shared across both apps

- **Prices** are shown with GST included wherever a total is shown, itemised on the next screen: room charges, discount, GST, total.
- **Status chips** map one-to-one to backend enums (`CONFIRMED` green, `PENDING_*` amber, `CANCELLED_*` neutral/red, ...); unknown values render a neutral chip with the humanised name, never an error.
- **Empty / error / loading** are designed states: loading uses skeletons of the final size, errors say what happened and offer a retry, empty states say what to do next.
- **Never trust data to fit**: long names wrap or truncate with a way to read them in full, counts use locale formatting, plurals are never hard-coded, zero ratings read "New", missing images fall back to a placeholder, user text is rendered as text and never as HTML.
