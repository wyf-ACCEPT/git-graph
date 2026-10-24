# Git action interaction contract

The product is an English local desktop Git tool. Existing runtime tokens in
`src/theme.css` and the shared graph/menu/confirmation components are canonical.
The owner explicitly requested create/rename/delete branch, merge, cherry-pick
and tag management on 2026-10-23. `shared/repositoryActions.ts` is the action/API
contract; `server/services/actions.ts` owns validation and state transitions.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native select in repository picker and RepositoryActionDialog | DESIGN.md; existing repository selector | OS-owned popup for remote, merge mode, mainline and tag type | Browser open popup and keyboard; dialog component tests |
| Form | RepositoryActionDialog inside ConfirmActionDialog | shared/repositoryActions.ts | Configure then review then execute; shared error/retry frame | RepositoryActionDialog.test.tsx |
| Scrollbar | src/index.css | Existing runtime color tokens | Global baseline; bounded menu and dialog geometry | Browser scroll and computed style |
| Toast | App notice strip and operation recovery banner | Existing checkout feedback; ActionResult schema | Success, persistent refusal/conflict; full text in tooltip | Browser success/conflict and service regressions |
| CRUD | Membership-resolved preview/execute service | server/services/actions.ts | Create/rename/delete local refs; guarded remote writes; merge/pick recovery | actions.test.ts; server/index.test.ts |

A menu selection opens options, then a server-backed review names the repository,
source/destination and effects. Confirming uses the reviewed state token; changed
HEAD, refs, index or operation state require another review. Cancel and Escape
never write. Pending submissions prevent duplicates and keep the dialog geometry
stable. Destructive final reviews initially focus Cancel. Dialogs isolate the
background, trap focus across fields/buttons, and restore focus on close.

Local branch deletion uses Git's non-force merged-branch check and refuses a
checked-out branch (including one checked out in another worktree). Remote
deletions require exact expected-object leases; they preserve local branches or
tags. Tag push sends one tag without forcing or following other tags. Existing
checkout/pull/fetch/push guards and per-repository writer lock are reused.

Explicit merge may create a merge commit; the automatic fetch and safe branch
pull contract is unchanged. Merge/cherry-pick require a clean working tree and
protect ignored files. A stopped operation shows conflicts and recovery controls.
Resolve/stage in the editor or terminal, then Continue; cherry-pick also supports
Skip. Abort explicitly warns that resolution work may be discarded. A merge
commit cherry-pick requires the user to choose its mainline parent.

Source references: current user request; AGENTS.md UX conventions; shared action
schemas; service validation; existing GitActionMenu and ConfirmActionDialog.

`gg` starts or reuses an independent loopback server for each canonical root.
Opening another root leaves existing tabs and servers intact. The URL's `root`
assertion is retained by graph/diff/preview navigation and all API calls. A
server mismatch fails before Git access, including writes, and asks the user to
run gg in the intended directory. It never changes the server's filesystem
allowlist. Existing legacy daemon commands keep their singleton semantics;
`gg --status/--stop/--logs/--restart` address only the selected workspace.

Legacy graph URLs without root automatically discover the current server root,
add it to the URL and load repositories without a confirmation. A valid selected
repo is preserved; otherwise prefer the root repo, then the first discovered
child. An empty workspace shows its normal empty state. URLs already specifying
a different root retain their mismatch refusal.
