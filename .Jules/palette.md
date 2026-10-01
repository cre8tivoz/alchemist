## 2025-05-18 - Icon-Only Buttons Lacking ARIA Labels and Focus Visuals
**Learning:** Collapsible layout elements (like Sidebar navigation at smaller breakpoints) and inline action buttons (kebab menus, chat send, modal closes) often hide text spans visually or rely purely on SVG icons without providing `aria-label` or `title` attributes. This renders them invisible to screen readers and difficult for keyboard navigation.
**Action:** Always provide explicit `aria-label` and `title` on icon-only buttons or buttons with responsive hidden text labels, along with `focus-visible` ring styles.
