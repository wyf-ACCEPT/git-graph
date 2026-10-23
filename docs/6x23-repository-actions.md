# Reviewed branch, merge, cherry-pick and tag actions

The owner requested five frequent action groups on 2026-10-23: branch creation
at any commit, branch rename/delete, merge, cherry-pick and tag management.
The graph context menu is the entry point; existing checkout/copy keyboard order
is retained. Shared `gitActions` descriptors own menus and unavailable reasons.

## API and validation

`POST /api/git/action-preview` validates `{repo, action}` and returns a description,
operation state and review token. `POST /api/git/action` accepts that action plus
the token. Both use the same Host/Origin/JSON/action-header protections as other
writes. Repository identifiers must belong to the served set. The execute path
shares checkout/pull/push/fetch's writer lock.

Tokens fingerprint the exact requested action, repository, HEAD, local/remote/tag
refs, staged index, status and active operation markers. Execution revalidates
under the lock. Changed state requires a new review; no stale target is silently
substituted. Existing refs come from exact Git listings; commits must be verified
reachable commits. New names pass Git ref validation. Git is invoked as argv,
never through a shell. A token is a stale-state guard, not an authentication token.
Independent CLI/editor Git writers are outside the app lock, as before.

## Behavior

- Create branch: at a verified commit; optionally switch with ignored-file
  overwrite disabled. No replacing an existing name.
- Rename branch: keep Git's upstream configuration. No remote rename. Refuse an
  existing target or a branch checked out in a different linked worktree.
- Delete local branch: use `git branch -d`, never force. Refuse checked-out refs
  (including other worktrees); Git refuses an unmerged branch.
- Delete remote branch: explicit remote/ref from tracked branch membership;
  exact expected-object lease protects concurrent remote updates. Local branch
  remains. Symbolic remote HEAD and ambiguous remote ownership are refused.
- Merge: default no-ff; normal fast-forward-when-possible and ff-only options.
  Pin the reviewed source commit; generate a readable branch merge message.
  Clean-worktree check, no autostash/squash or ignored-file overwrite.
- Cherry-pick: a new commit with `-x` provenance. Merge commits need a selected
  mainline parent. Refuse ignored-file/directory overlaps before invoking Git.
- Tags: annotated or lightweight creation; duplicate names refused. Local delete,
  one-tag push without force/mirror/follow-tags/submodule push, and exact-object
  leased remote deletion (local tag retained). Annotated messages stay explicit.

## Conflicts and errors

`GET /api/git/operation` reports branch, HEAD, remotes, dirty state, active merge/
cherry-pick/other operation and unmerged paths. The graph shows a persistent
recovery banner. Resolve and stage in the editor or terminal, refresh status,
then review Continue. Continue refuses unresolved conflicts. Abort warns about
losing conflict-resolution work. Cherry-pick also supports Skip (including an
empty patch). Other Git sequencer operations must be managed externally.

Failures retain actionable Git output. Remote commands are noninteractive and
bounded; timeout states that remote acceptance is unknown and must be checked.
No automatic rollback hides a conflict or invents success. New actions pause
automatic fetch during dialogs, writes and interrupted operations.

The existing theme, menu and ConfirmActionDialog remain canonical. Native selects
use OS popup behavior. Long menus/dialogs are viewport-bounded, focus is trapped,
background is inert, errors are live, destructive final reviews focus Cancel,
and pending submissions cannot dispatch twice. See UX-CONTRACT.md and DESIGN.md.
