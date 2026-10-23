# Manual branch synchronization

Double-clicking an origin-only ref with a same-named local branch now checks
that branch's ahead/behind counts and offers a Switch and pull confirmation
when origin has new commits. Creation confirmation remains unchanged when the
local branch is missing. Existing synced pills keep the local checkout shortcut.

Auto pull and the circular refresh icon fetch every branch from every remote
of the current repository. They never integrate into local branches. The down
arrow separately pulls only the current branch; the up arrow pushes only it. Down is enabled for behind-only; up for ahead-only. Both are disabled
for synced, detached, missing-upstream and diverged states. Tooltips explain the
counts or unavailable state. Status refreshes after actions, on window focus,
and every 15 seconds using local remote-tracking refs. The separate five-minute
automatic remote fetch also refreshes the graph and counts.

`GET /api/git/branch-sync` returns counts for the current branch or an explicitly
named existing origin counterpart. `POST /api/git/pull` accepts `expectedBranch`
for current-branch requests, or `originBranch` for the confirmed switch/pull
flow. An origin pull explicitly uses origin without rewriting branch upstream
configuration. It requires a clean worktree and preserves ignored files.

`POST /api/git/push` requires `expectedBranch`, uses the checkout/pull writer
lock and the existing Host/Origin/action-header guards. It fetches the upstream
remote, rechecks branch/commit/upstream, then sends one pinned commit to the
exact upstream branch, with no force, mirror, follow-tags or submodule push.
Network commands are noninteractive and bounded to 30 seconds. A push timeout
reports uncertain remote acceptance and requires a refresh before retrying.

Pull still only fast-forwards. No rebase, stash, reset or merge commit is used.
A confirmed origin pull may leave the selected branch checked out after a
network/integration failure; the confirmation states this. The writer lock
serializes this server's actions, not independent Git processes or hooks.

## External Git updates

The branch-status response includes a revision fingerprint of all local/remote
branch refs, tags and HEAD. `useBranchSync` checks it every 15 seconds and on
window focus. A changed revision refreshes the graph, branch list, working tree
and open details as well as button availability. Unchanged polls do not reload
the graph. Stale/out-of-order responses and prior repositories are ignored.
This keeps CLI/editor commits and pushes from leaving an old graph beside
current push/pull availability; no remote fetch or Git write runs in this poll.
