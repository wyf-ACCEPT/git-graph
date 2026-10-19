# Safe automatic pull

The owner requested automatic pull of the currently viewed repository, restricted
to clean worktrees and fast-forward updates. The graph defaults to a five-minute
timer and a per-repository persistent switch. The first scheduled attempt is five
minutes after opening/selecting/enabling, rather than an immediate file update.
Closing the graph stops scheduling; browser throttling can delay background tabs.
The manual refresh icon explicitly requests the same pull immediately.

## Behavior and canonical owners

- `shared/pull.ts`: response contract and one five-minute interval constant.
- `useAutoPull`: repository-scoped preference, timer cleanup, pause during Git
  confirmations/actions, overlap prevention, stale-response isolation, and retry.
- `AutoPullControl`: header switch/manual action and persistent success/skip/error
  status. It uses the existing theme tokens and native buttons; no new select,
  dialog, toast system or visual token is introduced.
- The existing repository-change broadcast refreshes other graph/working tabs.
- `POST /api/git/pull`: JSON/action-header/Origin/Host guarded and membership
  resolved. No request can supply a remote URL, branch revision, or shell command.
- The server serializes pulls and checkouts for each served repository. Automatic
  attempts across tabs share a five-minute deduplication window; manual retries
  bypass the window but never the writer lock or worktree checks.

## Git operations

1. Read HEAD, branch, upstream, worktree/index status and active-operation markers.
2. Skip dirty, detached, unborn, untracked, local-only upstream and active Git states.
3. Fetch the configured remote without recursion or overwriting FETCH_HEAD.
   Terminal credential prompts are disabled; downloads have a 30-second deadline.
4. Recheck branch/HEAD/upstream/worktree. Resolve the fetched upstream commit.
5. If already current/ahead, leave the branch alone. If divergent, skip it.
6. Recheck once more and fast-forward to the captured commit with autostash,
   squash and ignored-file overwrite disabled. No merge commit is created.

This is the fetch-plus-integration behavior of pull with extra safety checks,
not a blind shell `git pull`. The network deadline applies only to fetch, so it
cannot interrupt a worktree update midway. Existing Git configuration/hooks are
still trusted code. The app lock covers this server's writers; independent CLI
commands/editors do not participate in that lock. Avoid concurrent manual Git
operations while an update is in progress. No claim of cross-process transaction
isolation is made.

References: [Git pull](https://git-scm.com/docs/git-pull) and
[Git merge options](https://git-scm.com/docs/git-merge), including ff-only,
no-autostash and no-overwrite-ignore. Dependencies and the lockfile are unchanged.
