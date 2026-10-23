# Automatic remote synchronization

Updated 2026-10-23 after the owner clarified the intended button scopes. The
**Auto pull · 5m** switch and circular-arrow button both fetch all branches from
all configured remotes of the current repository. They do not integrate into
any local branch. The down arrow separately pulls only the current branch;
the up arrow separately pushes only it. See [branch actions](6x23-branch-sync.md).

## Lifecycle and ownership

- `useAutoPull` retains its repository-scoped stored preference and five-minute
  timer. The first fetch waits five minutes; opening or switching repositories
  never triggers an immediate fetch. Manual refresh bypasses the interval and
  works with the switch off. Closing the graph stops scheduling.
- Actions and confirmations pause the timer. Overlap and stale responses are
  isolated per repository; repository-change broadcasts refresh other tabs.
- `AutoPullControl` owns the switch, circular-arrow fetch, current-branch arrows,
  tooltips, busy state and persistent success/partial-failure/error status.
- `POST /api/git/fetch` accepts only a served repository identifier and the manual
  flag. It uses the Host/Origin/action-header guards and the shared writer lock.
  Automatic syncs share a five-minute server deduplication window across tabs.

## Git operations

1. List every configured remote using Git. No request supplies a URL or refspec.
2. Fetch each remote with an explicit heads-to-remote-tracking mapping, including
   branches not configured in a single-branch clone. Ignore configured fetch
   destinations to avoid writing local heads. Explicit iteration includes remotes
   marked skipFetchAll.
3. Prune deleted remote branch refs, but never local branches or tags. Fetch also
   downloads reachable tags under Git's normal behavior. No submodule recursion
   or FETCH_HEAD rewrite. Each remote has a noninteractive 30-second deadline.
4. Continue if one remote fails, report partial success, and refresh graph data
   even if the overall result is an error. An explicit retry bypasses deduplication.

Dirty/untracked files, detached HEAD and an absent upstream do not prevent fetch.
HEAD, local branch tips, the index and working files are left unchanged. No
checkout, merge, reset, stash or push runs in this path. A bare list with no
remotes returns a visible skip reason. The app lock covers this server's writers,
not independent Git processes, editors or configured hooks.

The older fetch-plus-fast-forward service remains available through
`POST /api/git/pull` for explicit current-branch and confirmed origin-branch pull.
It still rechecks branch/HEAD/upstream/worktree, skips dirty/divergent states,
and disables autostash, squash and ignored-file overwrite. Network timeouts
never terminate the working-tree integration phase.

For already-open older tabs, `/api/git/pull` requests without `expectedBranch`
or `originBranch` are routed to fetch-all as well. Old timers and circular
refresh buttons therefore cannot keep integrating local branches after the
service update. Reload to receive the new tooltips and five-minute status text.
