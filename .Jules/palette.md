## 2025-05-18 - Icon-Only Buttons Lacking ARIA Labels and Focus Visuals
**Learning:** Collapsible layout elements (like Sidebar navigation at smaller breakpoints) and inline action buttons (kebab menus, chat send, modal closes) often hide text spans visually or rely purely on SVG icons without providing `aria-label` or `title` attributes. This renders them invisible to screen readers and difficult for keyboard navigation.
**Action:** Always provide explicit `aria-label` and `title` on icon-only buttons or buttons with responsive hidden text labels, along with `focus-visible` ring styles.

## 2025-05-19 - Code Snippet Copy Actions with Screen Reader Feedback
**Learning:** Code snippet components (like `SqlBlock`) without copy-to-clipboard functionality require manual text selection. When adding copy buttons to code blocks, updating `aria-label` dynamically (e.g. "Copied SQL query to clipboard") alongside temporary visual feedback ensures screen reader users receive immediate confirmation.
**Action:** Always pair visual copy confirmation state with dynamic `aria-label` updates and `focus-visible` ring indicators on code snippet blocks.
