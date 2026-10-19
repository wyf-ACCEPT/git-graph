# Origin tracking branch checkout

Double-click an origin-only branch label in the graph or commit details to
confirm creating and checking out a same-named local branch. The current
English interface uses "Create and check out branch NAME?" and the action
"Create and check out". The shared context menu provides keyboard access.

The full local branch list decides whether creation is available, including
branches outside the displayed history. An unknown local listing, another
remote, or origin/HEAD never offers creation. When multiple remote decorations
are grouped together, origin is the explicit source.

The existing checkout endpoint accepts this target after confirmation:

```json
{"kind":"remote-branch","remote":"origin","name":"release/topic"}
```

The server resolves the source by membership against non-symbolic origin
tracking refs and validates the new branch name. It refuses an existing local
branch instead of resetting or reusing it. Git runs a normal transactional
`switch --create ... --track` with the full remote ref; a conflicting dirty
worktree leaves HEAD, the local branch set, and edited files unchanged.
Non-conflicting changes may carry over after the user confirms, as with the
existing confirmed local checkout. No fetch, force, reset, or stash is added.

The canonical UI owners remain `RefPill`/`CommitRefRow` for labels,
`ConfirmActionDialog` plus `describeCheckout` for confirmation, and App's
existing checkout state for pending, error, retry, success, and refresh. Theme
tokens remain in `src/theme.css`; this feature adds no new visual token or
independent dialog. Both inline and sidebar commit details share the same
behavior. The repository picker remains the existing native operating-system
select; this workflow adds no input/select primitive or locale system.
