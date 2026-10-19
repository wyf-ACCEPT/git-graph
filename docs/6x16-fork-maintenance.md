# Fork maintenance

This fork is maintained at <https://github.com/wyf-ACCEPT/git-graph> and began
from upstream commit `f9440df8ebe31c0df67e1311b6142146a9f20b9e` in
<https://github.com/binaryplease/git-graph>. The original MIT license and credits
are retained. The fork evolves according to its owner's workflow; upstream
updates are optional.

## Custom behavior

- The current graph repository can pull automatically every five minutes, with a
  persistent per-repository switch and manual retry. It only fast-forwards a clean
  checked-out branch with a remote upstream. See `6x19-auto-pull.md`.

- Graph and detail timestamps show local time to the second. The current local
  year is omitted; other years remain visible. Tooltips retain the Git ISO value.
- Double-clicking a non-current local branch switches directly after a fresh
  server-side check. Staged, unstaged, and untracked changes require confirmation.
  Git's normal conflict protection remains; there is no forced switch or stash.
- An origin-only branch with no same-named local branch opens a creation
  confirmation on double-click, also available through the context menu.
  Confirmation creates, switches to, and tracks the origin branch. Symbolic
  origin/HEAD is excluded; the server rechecks local names and remote refs.
- Only HEAD is a hollow node, radius 6; all other commits, including merges, are
  filled nodes. Selection uses the row background. Detached HEAD is supported.
- Changed-file rows offer a separate complete read-only preview beside diff and
  copy controls. Commit previews pin the selected version; deleted files show
  the old source. Comparison and working-tree lists use their own contexts.
  The view uses escaped text and existing diff APIs. It is a browser preview,
  not a native Codex editor integration.
- History enumerates branches, remotes, tags, and HEAD instead of `--all`, so Git
  notes such as git-ai metadata do not appear as project commits. An unborn HEAD
  produces an empty graph.

## Development and validation

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
git diff --check
```

The initial customization passed 366 tests across 29 files, type checking, a
production build, and browser checks for the main interactions. The dependency
lock was not upgraded as part of the fork setup. Personal audit evidence and
machine-specific records are kept outside the public source tree.

The tracked `gg` launcher defaults to the caller's current directory and strict
loopback port 3107. It uses `GIT_GRAPH_BUN`, a pinned local runtime, a sibling
legacy runtime, or Bun on PATH. External command wrappers should execute this
script. `install.sh` restores the pinned runtime and builds without relying on
a separately installed bunx command.

## Git remotes

Use `origin` for this fork and `upstream` for the original project. Set the
preferred push remote explicitly:

```sh
git config remote.pushDefault origin
git config push.default simple
```

Do not automatically replace local code with upstream. To evaluate an update,
fetch upstream, inspect the commits and file overlap, merge or cherry-pick the
chosen changes, run validation, and then push to this fork. Keep full Git history
available. Secrets, dependencies, runtime files, build output, logs, and private
`.codex/` notes must stay out of commits.
