# Visual Creative UX v3 browser evidence

Chromium screenshots exercise the production CSS and the v3 Mixed / semantic
operation / Variants / Compare states with a bounded local visual harness. The
harness is intentionally not shipped. Actual state transitions and server
boundaries are covered by the accompanying automated tests.

- `desktop-mixed.png`
- `desktop-compare-partial.png`
- `mobile-390-mixed-partial.png`
- `mobile-390-compare.png`

Measured at 390×844: `document.documentElement.scrollWidth === 390`; every
visible button measured at least 44 px high. Compare is single-column and
full-screen; it has no hover-only action.
