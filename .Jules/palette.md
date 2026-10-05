## 2025-05-18 - Icon-Only Buttons Lacking ARIA Labels and Focus Visuals
**Learning:** Collapsible layout elements (like Sidebar navigation at smaller breakpoints) and inline action buttons (kebab menus, chat send, modal closes) often hide text spans visually or rely purely on SVG icons without providing `aria-label` or `title` attributes. This renders them invisible to screen readers and difficult for keyboard navigation.
**Action:** Always provide explicit `aria-label` and `title` on icon-only buttons or buttons with responsive hidden text labels, along with `focus-visible` ring styles.

## 2025-05-19 - Code Snippet Copy Actions with Screen Reader Feedback
**Learning:** Code snippet components (like `SqlBlock`) without copy-to-clipboard functionality require manual text selection. When adding copy buttons to code blocks, updating `aria-label` dynamically (e.g. "Copied SQL query to clipboard") alongside temporary visual feedback ensures screen reader users receive immediate confirmation.
**Action:** Always pair visual copy confirmation state with dynamic `aria-label` updates and `focus-visible` ring indicators on code snippet blocks.

## 2025-05-20 - Collapsible Tree View Expanders Accessibility
**Learning:** Hierarchical tree elements (such as schema panels with expandable tables, wings, or rooms) often use icon `<button>` toggles without `aria-expanded` attributes or `aria-label` describing the item being toggled. Screen readers cannot convey expansion state without `aria-expanded`.
**Action:** Always include `aria-expanded={boolean}` and explicit `aria-label={`Toggle ${item.name}`}` on tree view expander buttons, accompanied by `focus-visible` outline rings.

## 2025-05-21 - Sortable Data Table Headers Accessibility
**Learning:** Table column header cells (`<th>`) that support sorting often attach `onClick` handlers directly to `<th>` without inner `<button>` triggers, `aria-sort` attributes, or `focus-visible` ring indicators. This prevents keyboard users from focusing headers via Tab and prevents screen readers from announcing column sort states or actions.
**Action:** Always wrap sortable table header contents in a focusable `<button type="button">` with `aria-label` sort hints and `focus-visible` ring styling, and include `aria-sort="ascending" | "descending" | "none"` on the parent `<TableHead>` (`<th>`).
