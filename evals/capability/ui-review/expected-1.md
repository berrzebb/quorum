# UI Review Expected Output Quality Standards

## 1. UI-1 through UI-8 Checklist Coverage

The review MUST address all 8 verification items:

- **UI-1: Page Load** — Verifies the page loads without JavaScript console errors
- **UI-2: DOM Elements** — Confirms all expected elements exist (form, email input, password input, submit button, forgot password link)
- **UI-3: Interactivity** — Validates form submission, input state changes, error display
- **UI-4: Accessibility** — Uses `a11y_scan` tool; checks labels, ARIA attributes, keyboard navigation
- **UI-5: Responsive Layout** — Checks layout at different viewport sizes
- **UI-6: Error States** — Verifies error message display, validation feedback
- **UI-7: Navigation** — Confirms routing works (login → dashboard, forgot password link)
- **UI-8: Cross-browser** — Notes any browser-specific concerns

Each item is marked PASS or FAIL with justification.

## 2. Page Load Verification

- Confirms the component renders without throwing
- Checks for missing imports or undefined references
- Identifies potential runtime errors (e.g., `localStorage` not available in SSR)

## 3. DOM Element Verification

The review MUST verify these specific elements exist and are correctly configured:

- `<form>` with `onSubmit` handler
- `<input type="email">` with value binding and onChange
- `<input type="password">` with value binding and onChange
- `<button type="submit">` with label text
- Error display `<div>` conditionally rendered
- `<a href="/forgot-password">` navigation link

## 4. Accessibility Validation

- Invokes `a11y_scan` on `src/pages/Login.tsx`
- Identifies missing `<label>` elements for inputs (using placeholder instead of label is an a11y violation)
- Checks for missing `aria-label` or `aria-describedby` on error messages
- Reports WCAG level (A/AA) compliance status
- Notes keyboard navigation: Tab order through form fields, Enter to submit

## 5. File:Line References

Every finding MUST include precise location:

- Format: `src/pages/Login.tsx:25` (file path + line number)
- References point to the actual problematic code, not approximate locations
- Multiple findings on the same file are listed with individual line numbers

## 6. Structured Report Format

The output MUST be a structured report:

- Summary verdict (PASS / CONDITIONAL_PASS / FAIL)
- Table or checklist with UI-1 through UI-8 status
- Findings section with severity, file:line, description, and remediation
- Total finding count and breakdown by severity
