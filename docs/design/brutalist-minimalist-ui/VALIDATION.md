# Validation & Acceptance Gates — Brutalist × Minimalist Redesign

## 1. Automated Build, Type, Lint & Test Gates
1. `npm --prefix frontend run typecheck` (`tsc -b`): Must pass with **0 errors**.
2. `npm --prefix frontend run build` (`vite build`): Must pass with **0 errors**.
3. `npm --prefix frontend run lint`: Must introduce **0 new lint errors** over the baseline (`<= 111` errors).
4. `npm --prefix frontend test -- --maxWorkers=2`: Full Vitest suite must pass with **0 failed tests** across all test suites.

## 2. `better-ui` & `better-colors` Compliance Gates
1. **Zero Brutalist Hardcoded Hex Residue**: No non-test, non-print source file under `frontend/src/` may retain raw brutalist hex classes (`#0A0A0A`, `#FAF9F5`, `#F4F4F0`, `#EAE8E3`, `#E4E2DC`, `#DDDAD2`, `#C8C5BC`, `#4A4945`, `#5C5B57`, `#E61919`, `#3A3935`, `shadow-[4px_4px_0px_#0A0A0A]`, `shadow-[6px_6px_0px_#0A0A0A]`).
2. **Zero Sub-12px Typography**: No non-test, non-print source file under `frontend/src/` may contain `text-[9px]`, `text-[10px]`, or `text-[11px]`.
3. **Concentric Radii & Soft Elevation**: Shared primitives (`button`, `input`, `select`, `card`, `table`, `tabs`, `dialog`, `dropdown-menu`, `badge`, `toast`, `date-input`) use the calibrated `4px / 6px / 8px / 12px / 999px` radius tokens and soft shadows (`--shadow-card`, `--shadow-float`).
4. **Motion & Overlay Polish**:
   - Buttons scale to `0.96` on press (`motion-safe:enabled:active:scale-[0.96]`) with `static` opt-out prop.
   - No `transition-all` in shared UI primitives.
   - `overscroll-behavior: contain` (`overscroll-contain`) applied on scrollable dialogs, drawers, and dropdown menus.
   - `@media (prefers-reduced-motion: reduce)` respected globally.
5. **Protected Print Templates Intact**: `frontend/src/lib/printDocuments.ts`, `frontend/src/lib/disbursementDocument.ts`, `PrintPreviewModal.tsx`, `DisbursementPrintModal.tsx`, and `TransmittalPrintModal.tsx` retain 100% of their official printed sheet geometry and tests.
