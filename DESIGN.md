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
