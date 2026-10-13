# AIsaac Dashboard — motion and loading UX

Status: complete
Scope: `aisaac_dashboard` frontend

## Goal

Use Motion to make navigation, health-state changes, expanding details, and
initial data loading easier to follow without making the operational dashboard
feel busy.

## Constraints and non-goals

- Preserve the existing information architecture, API behavior, focus handling,
  and reduced-motion support.
- Keep existing data visible during explicit refreshes; skeletons are for empty
  initial states only.
- Do not add parallax, looping status pulses, decorative background animation,
  or broad visual redesigns.
- Do not change backend code or deployment configuration.

## Approach

1. Add shared motion timings plus reusable loading/reveal and refresh-overlay
   primitives.
2. Animate command-center card reordering, status changes, incidents, runbooks,
   and skeleton-to-content transitions.
3. Add shared active indicators for application tabs and primary navigation;
   animate route changes, the mobile drawer, and sidebar collapse.
4. Replace blank loading branches in major pages and application tabs with
   shaped loading states while keeping real empty and error states distinct.
5. Add focused tests, run frontend tests/lint/build, manually smoke-test the
   affected UI when possible, and request an independent agent review.

## Verification

- Automated: focused primitive/layout tests plus the complete frontend test,
  lint, and production-build commands.
- Manual: command-center refresh/status transitions, application tabs, sidebar,
  mobile drawer, initial skeleton reveal, and reduced-motion behavior.

## Result

- Added shared Motion timing, route/tab/sidebar/drawer transitions, status and
  incident reveals, card layout animation, and restrained press/hover feedback.
- Added shaped skeletons for initial loads and non-blocking refresh indicators
  that preserve already-loaded content.
- Preserved real empty/error states, added accessible loading labels and busy
  regions, and retained user reduced-motion preferences.
- Verified with 136 passing tests, ESLint, a production build, a local browser
  smoke test with no client console errors, and independent review. The local
  preview's API returned HTTP 502 because its backend services were not running;
  the frontend rendered the expected error state.

## Risks / decisions

- Layout animation and CSS transforms can conflict. Card layout movement will
  live on Motion wrappers and the old CSS entrance transform will be removed.
- Exit animation must not delay focus management or keyboard dismissal in the
  mobile drawer.
- Large tables and the knowledge graph will not animate every row/node; their
  loading containers will transition as a unit.
