# Git Graph UI

This is a compact English desktop Git viewer. Preserve the existing graph and
utility toolbar, with shared tokens owned by `src/theme.css`. Tailwind's palette
names (`fg`, `dim`, `faint`, `accent`, `line`, `raised`, `rowhover`) map to that
runtime theme; both light and dark modes use the same components. Typography is
the existing sans UI with bundled Fira Code for Git data. Use Tabler icons.

The canonical toolbar owner is `AutoPullControl`; branch actions use 28px icon
buttons with tooltips, visible focus and grey disabled states. The refresh button fetches all branches from every remote, as does the five-minute
Auto pull switch; neither changes local branches or files. Down/pull updates only
the current branch, and up/push uploads only that branch to its upstream. Counts come from the complete
Git refs, not the loaded graph window. Divergence disables both directions.

`ConfirmActionDialog` owns confirmations, and the App status strip owns manual
Git outcomes. Existing checkout and origin-create flows remain the sibling
reference. Keep pending, error, retry and cancel states in the same frame.
Repository selection uses the existing native select; its OS popup is accepted.
No new colors, fonts or layout system are introduced by branch sync.

Repository actions extend the existing context menu and confirmation frame.
Options use the established native select (OS popup accepted), labeled inputs
and textareas; final review names both source and destination. Long menus and
dialogs scroll within the viewport. Shared focus, pending and refusal states live
in ConfirmActionDialog. Operation recovery stays visible above the graph.
Scrollbar tokens in `src/index.css` derive from the runtime canvas/faint/dim/fg
palette and apply to every scrollable app surface, including forced-colors mode.

Commit menu order follows frequency: Create branch, Create tag, Checkout, Open
commit, Cherry-pick, then Copy commit hash. Short-hash copying is not offered.
Menu/action option labels use plain text without trailing ellipses, including
actions that open a dialog; review and confirmation behavior stays explicit.

Uncommitted changes are a gray synthetic node above the real history, connected
to the actual visible HEAD by a solid gray segment. The working label remains
a real diff link/handler row. A clean tree shows its existing check/label without
a synthetic node. CommitGraph owns the connected SVG and row geometry; commit
identities, context menus and counts still contain real commits only. When HEAD
is below other branch tips, reserve its lane until it arrives rather than draw
a working edge through unrelated nodes. Inline details move the connector with
its destination. Missing/stale HEAD snapshots do not get an invented connection.
