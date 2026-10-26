# Brutalist × Minimalist Merged UI — Complete Token & Layout Contract

**Aesthetic Synthesis:** **Structured Institutional Ledger** — Brutalist cross-module architectural consistency × Minimalist tactile softness × `better-ui` & `better-colors` Logo-Aligned Corporate Finance Blue system.
**Target Audience Ergonomics:** Middle-aged accounting partners, CPAs, and senior bookkeepers (high-contrast `>=12px` legibility floor, anti-glare cool-alabaster substrate `#F8FAFC`, unmistakable `4.76:1` form input borders, and Jakob's Law enterprise conventions).

---

## 1. Two-Tier Color System (`better-colors` Verified)

All foreground/background pairs are mathematically measured in sRGB and OKLCH (`L`, `C`, `H`) and verified against WCAG 2.1 AA/AAA thresholds.

### Tier 1: Perceptual Primitives (Defined in `:root`, Never Used Directly in Components)
- **Cool Slate Neutral Ramp (`H ≈ 248°–265°`, subtly tinted toward the ATA/LTA logo blue)**:
  - `--slate-50`: `#F8FAFC` (`oklch(0.984 0.003 247.9)`)
  - `--slate-100`: `#F1F5F9` (`oklch(0.968 0.007 247.9)`)
  - `--slate-200`: `#E2E8F0` (`oklch(0.929 0.013 255.5)`)
  - `--slate-300`: `#CBD5E1` (`oklch(0.869 0.020 252.9)`)
  - `--slate-400`: `#94A3B8` (`oklch(0.704 0.040 256.8)`)
  - `--slate-500`: `#64748B` (`oklch(0.554 0.041 257.4)`)
  - `--slate-600`: `#475569` (`oklch(0.446 0.037 257.3)`)
  - `--slate-700`: `#334155` (`oklch(0.372 0.039 257.3)`)
  - `--slate-800`: `#1E293B` (`oklch(0.279 0.041 260.0)`)
  - `--slate-900`: `#0F172A` (`oklch(0.208 0.040 265.8)`)
- **Corporate Finance Blue Accent Ramp (`H ≈ 255°–265°`, aligned with ATA & LTA Logos)**:
  - `--blue-50`: `#EFF6FF` (`oklch(0.970 0.014 254.6)`)
  - `--blue-100`: `#DBEAFE` (`oklch(0.932 0.032 255.6)`)
  - `--blue-200`: `#BFDBFE` (`oklch(0.882 0.059 254.1)`)
  - `--blue-300`: `#93C5FD` (`oklch(0.809 0.105 251.8)`)
  - `--blue-600`: `#2563EB` (`oklch(0.546 0.245 262.9)`)
  - `--blue-700`: `#1D4ED8` (`oklch(0.488 0.217 264.4)`)
  - `--blue-800`: `#1E40AF` (`oklch(0.424 0.181 265.6)`)
  - `--blue-900`: `#1E3A8A` (`oklch(0.379 0.138 265.5)`)
- **Cerulean Sky Ramp (LTA Logo & Informational Status, `H ≈ 237°–243°`)**:
  - `--sky-50`: `#F0F9FF` (`oklch(0.977 0.012 236.6)`)
  - `--sky-200`: `#BAE6FD` (`oklch(0.901 0.058 230.9)`)
  - `--sky-300`: `#7DD3FC` (`oklch(0.828 0.111 230.3)`)
  - `--sky-700`: `#0369A1` (`oklch(0.500 0.119 242.7)`)
  - `--sky-800`: `#075985` (`oklch(0.443 0.100 240.8)`)

### Tier 2: Semantic Role Tokens (`@theme` & `:root`)

| Role | Token Name | Value | Measured Contrast & Usage |
|---|---|---|---|
| **Page Canvas** | `--color-bg-app` / `--color-canvas` / `--color-bg` | `#F8FAFC` | Soft cool-alabaster ground; eliminates harsh white glare. |
| **Elevated Surface** | `--color-surface` / `--color-panel` / `--color-bg-light` | `#FFFFFF` | Cards, ledger tables, active sheets, modal bodies, form inputs. |
| **Recessed Well / Sidebar** | `--color-sidebar` / `--color-bg-subtle` / `--color-bg-muted` | `#F1F5F9` | Left navigation rail, table headers, command toolbars, tab tracks. |
| **Component Hover** | `--color-hover` / `--color-bg-hover` | `#E2E8F0` | Interactive row, button, and tab hover feedback. |
| **Component Selected** | `--color-selected` / `--color-surface-selected` | `#DBEAFE` | Selected table row or active soft-blue navigation pill. |
| **Primary Text** | `--color-ink` / `--color-text` / `--color-text-main` / `--color-text-base` | `#0F172A` | **17.85:1** on `#FFFFFF`, **17.06:1** on `#F8FAFC` (WCAG AAA). |
| **Secondary Text** | `--color-text-secondary` | `#334155` | **9.90:1** on `#F8FAFC`, **9.45:1** on `#F1F5F9` (WCAG AAA). |
| **Muted / Supporting Text** | `--color-muted` / `--color-text-muted` | `#475569` | **7.58:1** on `#FFFFFF`, **7.24:1** on `#F8FAFC` (WCAG AAA). |
| **Placeholder Text** | `--color-placeholder` / `--color-text-placeholder` | `#64748B` | **4.76:1** on `#FFFFFF` (WCAG AA compliant). |
| **Inverse / On-Accent Text** | `--color-inverse` / `--color-text-inverse` | `#FFFFFF` | Crisp white label on `#1D4ED8` / `#1E40AF` / `#1E3A8A` / `#DC2626` fills. |
| **Structural Border / Divider** | `--color-border` / `--color-border-subtle` | `#CBD5E1` | `1px` structural card/table/section divider (clearly visible on `#FFFFFF` & `#F8FAFC`). |
| **Strong Structural Border** | `--color-border-strong` | `#94A3B8` | Emphasized header dividers and active container frames. |
| **Form Control Border** | `--color-control-border` | `#64748B` | **4.76:1** on `#FFFFFF` (>3:1 WCAG AA non-text contrast for middle-aged visibility). |
| **Brand Accent Solid (Primary Action)** | `--color-primary` / `--color-accent-solid` | `#1D4ED8` | **6.70:1** with `#FFFFFF`; used on the single primary action per view & active indicators. |
| **Brand Accent Hover** | `--color-primary-hover` / `--color-primary-dark` | `#1E40AF` | **8.72:1** with `#FFFFFF`; hover state for primary actions. |
| **Brand Accent Subtle** | `--color-primary-light` / `--color-accent-subtle` | `#EFF6FF` | Soft finance-blue highlight surface (`#1E40AF` text = **8.01:1**). |
| **Focus Ring** | `--color-focus` / `--color-accent` | `#1D4ED8` | `2px solid #1D4ED8` with `2px` offset (replaces Brutalist hazard red focus). |
| **Entity ATA** | `--color-ata` | `#1E3A8A` | Deep Institutional Navy (**10.36:1** w/ white; badge `#EFF6FF` bg / `#1E3A8A` text / `#93C5FD` border). |
| **Entity LTA** | `--color-lta` / `--color-entity-lta` | `#0369A1` | Corporate Cerulean (**5.93:1** w/ white; badge `#F0F9FF` bg / `#075985` text / `#7DD3FC` border). |
| **Document Viewer Well** | `--color-viewer-bg` / `--viewer-bg` | `#F1F5F9` | Recessed document/receipt viewer background well (`var(--slate-100)`). |
| **Deadline Track** | `--color-deadline-track` / `--deadline-track` | `#E2E8F0` | Neutral track for overdue / payment urgency progress bar (`var(--slate-200)`). |

### Semantic Status Ramps (`>=15°` OKLCH Hue Separation from Accent `264.4°`)
| Status Role | Surface Token | Text Token | Border Token | Measured Contrast |
|---|---|---|---|---|
| **Success** (Paid, Funded, Approved, Completed) | `#F0FDF4` (`--color-success-surface`) | `#166534` (`--color-success`) | `#86EFAC` (`--color-success-border`) | **6.81:1** (AA+) |
| **Warning** (Pending, Awaiting, 1–60d Overdue) | `#FEFCE8` (`--color-warning-surface`) | `#854D0E` (`--color-warning`) | `#FDE047` (`--color-warning-border`) | **6.62:1** (AA+) |
| **Danger** (Rejected, Overdue 61d+, Blocked, Error) | `#FEF2F2` (`--color-danger-surface`) | `#991B1B` (`--color-danger`) | `#FCA5A5` (`--color-danger-border`) | **7.60:1** (AAA) |
| **Info** (Sent, In Progress, Released, Partially Paid) | `#F0F9FF` (`--color-info-surface`) | `#075985` (`--color-info`) | `#7DD3FC` (`--color-info-border`) | **7.09:1** (AAA) |

---

## 2. Typography & Numeric Discipline (Middle-Aged Friendly & Jakob's Law)

- **Primary UI & Body Sans (`--font-sans`)**: `'Geist Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (locally bundled via `@fontsource/geist-sans` and `@fontsource/inter`).
- **Monospace Telemetry & IDs (`--font-mono`)**: `'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace` (locally bundled via `@fontsource/geist-mono` and `@fontsource/jetbrains-mono`).
- **Display / Editorial Sign-In (`--font-display`)**: `'Geist Sans', 'Inter', system-ui, sans-serif` (clean `600–700` weight; no aggressive `Archivo Black` uppercase shouting).
- **Scale & Hierarchy**:
  - **Module Title (`h1`)**: `24px` (`1.5rem`) / `32px` line-height, `font-semibold` (`600`) or `font-bold` (`700`), `-0.02em` tracking, `#0F172A`, natural sentence/title case (never forced all-caps).
  - **Section / Dialog Title (`h2`, `h3`)**: `16px–18px` / `24px`, `font-semibold` (`600`), `-0.015em` tracking, `#0F172A`.
  - **Body / Form Controls / Sidebar Nav**: `14px` (`0.875rem`) / `20px–22px`, `400` (`500` for labels and nav items).
  - **Dense Table Cells**: `13px` (`0.8125rem`) / `20px`, `400` (`500–600` for primary identifiers and totals).
  - **Supporting Metadata / Badges / Table Headers**: Strict **`12px` (`0.75rem`) minimum floor** (`text-xs`, never `text-[10px]` or `text-[11px]`).
  - **KPI / Primary Ledger Figures**: `24px–28px` / `32px`, `600–700`, `tabular-nums lining-nums`.

---

## 3. `better-ui` Surface Softness, Concentric Radii, Shadows & Motion

1. **Concentric Border Radii (`outerRadius = innerRadius + padding`)**:
   - `--radius-xs`: `4px` (inline badges, keyboard hints, inner compact chips)
   - `--radius-sm`: `6px` (buttons, inputs, selects, date pickers, nav links, inner tab triggers)
   - `--radius-md`: `8px` (cards, table containers, command toolbars, `p-1` segmented tab tracks where `6px` inner + `2px–4px` inset = `8px–10px` outer)
   - `--radius-lg`: `12px` (modal dialogs, drawers, dropdown menus, login card)
   - `--radius-pill`: `999px` (avatars, notification counters)
2. **Shadows for Elevation, Borders for Structure (`better-ui`)**:
   - `--shadow-card`: `0px 0px 0px 1px oklch(0 0 0 / 0.04), 0px 1px 2px -1px oklch(0 0 0 / 0.05), 0px 2px 4px 0px oklch(0 0 0 / 0.03)` paired with `border: 1px solid var(--color-border)` (`#CBD5E1`) for crisp forced-colors and middle-aged visibility.
   - `--shadow-float`: `0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 10px 25px -5px rgba(15, 23, 42, 0.08), 0px 4px 10px -2px rgba(15, 23, 42, 0.04)` for dialogs, popovers, and dropdown menus.
3. **Interactive Motion & Ergonomics (`better-ui`)**:
   - **Press scale**: Primary and interactive buttons scale to `0.96` on press (`motion-safe:enabled:active:scale-[0.96]`) over `150ms` with `ease-out`, with an optional `static` prop opt-out and disabled exclusion.
   - **Specific transitions**: Never use `transition-all`. Name changing properties (`transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out`).
   - **High-frequency interactions**: Table row hovers and tab switches use `<=150ms` color/background transitions only (no scale/bounce).
   - **Hover gating**: Wrap CSS `:hover` rules in `@media (hover: hover)` so touch screens never latch stuck hover states, and set `-webkit-tap-highlight-color: transparent` on interactive controls.
   - **Scroll containment**: All scrollable dialogs, drawers, side peeks, and dropdown menus enforce `overscroll-behavior: contain`.
   - **Reduced motion**: Gate movement/scale behind `@media (prefers-reduced-motion: no-preference)` / `motion-safe:`.
   - **Content image outlines**: Give content images (`img` excluding transparent logos) `outline: 1px solid oklch(0 0 0 / 0.1); outline-offset: -1px`.

---

## 4. Brutalist Cross-Module Layout Consistency + Minimalist Softness

1. **App Shell (`Shell.tsx`, `Sidebar.tsx`, `Topbar.tsx`)**:
   - `Shell.tsx`: Single responsive page gutter (`px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6`), `bg-[#F8FAFC]` (`bg-canvas`), `text-[#0F172A]` (`text-ink`).
   - `Sidebar.tsx`: Fixed `232px` desktop rail (`bg-[#F1F5F9]` / `bg-sidebar`, `border-r border-[#CBD5E1]`), displaying the official **ATA & LTA** brand identity with a soft `6px`-rounded corporate blue emblem (`#1D4ED8` / `#1E3A8A`), sentence-case `14px` navigation items (`rounded-[6px]`), and a calm active state (`bg-[#DBEAFE]/80 text-[#1E40AF] font-semibold shadow-2xs` with a `3px` `#1D4ED8` left accent bar).
   - `Topbar.tsx`: `56px` height (`bg-[#FFFFFF] border-b border-[#CBD5E1]`), mobile menu drawer trigger (`44px` touch target on mobile, accessible Radix `Dialog` drawer with `overscroll-behavior: contain`), compact Entity Scope selector (`ATA`, `LTA`, `ALL`), NotificationBellPanel, and User Menu with `rounded-full` avatar.
2. **Unified Module Header Across All 11 Routes**:
   - Every route (`dashboard`, `clients`, `operations`, `billing`, `disbursements`, `transmittals`, `documents`, `reports`, `admin`, `profile`) uses `w-full space-y-6` and opens with the unified header block (`border-b border-[#CBD5E1] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4`):
     - Left: Clean breadcrumb (`Modules / [Module]`), `24px` (`text-2xl font-semibold tracking-tight text-[#0F172A]`) `h1` title, and `13px–14px` (`text-[#475569]`) operational description.
     - Right: Soft segmented Entity Switcher (`bg-[#F1F5F9] p-1 rounded-[8px] border border-[#CBD5E1]` with `rounded-[6px]` buttons where active is `bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs font-semibold` and inactive is `text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0]/60`) + single filled Finance Blue (`#1D4ED8`) primary action button.
3. **Unified Inner Tab Strip Across All Modules**:
   - Standardize `<TabsList>` and `<TabsTrigger>` in `components/ui/tabs.tsx` and across `operations`, `billing`, `disbursements`, `transmittals`, `documents`, `reports`, `admin`, and `clients`:
     - Track (`TabsList`): Unified horizontal container (`w-full justify-start rounded-[8px] bg-[#F1F5F9] p-1 border border-[#CBD5E1] flex flex-nowrap overflow-x-auto scrollbar-none gap-1 h-auto`).
     - Trigger (`TabsTrigger`): Concentric `rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0]/60 data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-[background-color,color,box-shadow] duration-150 cursor-pointer shrink-0`.
     - Count badges inside triggers: `rounded-[4px] px-1.5 py-0 text-xs font-mono tabular-nums bg-[#E2E8F0] text-[#0F172A] data-[state=active]:bg-[#EFF6FF] data-[state=active]:text-[#1E40AF]`.
4. **Unified KPI Strips, Tables, Kanban & Modals**:
   - **KPI Summary Bands**: Retained from Brutalist's consistent grid layout, softened with `rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-card` cards, `12px` medium labels (`#475569`), `24px–28px` `tabular-nums` figures (`#0F172A`), and semantic top accent borders (`border-t-2 border-t-[#D97706]` / `border-warning-border` or `border-t-[#DC2626]` when `attention={true}`).
   - **Tables**: `rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-card overflow-hidden`, `#F1F5F9` header with `border-b border-[#CBD5E1]`, `12px` sentence-case/semibold column headers (`#334155`), `13px` body cells (`#0F172A`), `border-b border-[#E2E8F0]` row dividers, `#F1F5F9` hover, and right-aligned `tabular-nums` monetary/count columns.
   - **Modals & Drawers**: `rounded-[12px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-float overscroll-contain` with `bg-slate-950/30` overlay scrim.

---

## 5. Workspace & Multi-Pane Dimensions (eyeshare-Style Split Workflow)

- **Row Heights (Dense Accounting Ledger)**:
  - `--row-height-compact`: `40px` (dense data queue rows)
  - `--row-height-default`: `48px` (comfortable standard rows)
- **Pane Dimensions (eyeshare-Style Split Workspace)**:
  - `--pane-rail-width`: `200px` (left action & batch processing rail)
  - `--pane-detail-width`: `480px` (docked right invoice/disbursement detail & audit drawer)
  - `--pane-detail-collapsed`: `48px` (collapsed right rail handle)
- **Document Viewer & Telemetry**:
  - `--viewer-bg` (`--color-viewer-bg`): `var(--slate-100)` (`#F1F5F9`) (recessed invoice document viewer well)
  - `--deadline-track` (`--color-deadline-track`): `var(--slate-200)` (`#E2E8F0`) (overdue/urgency deadline bar track)

