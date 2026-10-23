# git-graph

Maintained fork: [wyf-ACCEPT/git-graph](https://github.com/wyf-ACCEPT/git-graph),
based on [binaryplease/git-graph](https://github.com/binaryplease/git-graph).
This fork adds local-time timestamps, direct branch double-click switching,
HEAD-only hollow nodes, full-file previews, and Git-notes filtering.
See [fork maintenance](docs/6x16-fork-maintenance.md) for details.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png">
  <img alt="git-graph serving its own repository" src="docs/screenshot-dark.png" width="1600">
</picture>

*The app served on this repository (`bgg` in the project root): the commit graph
with `HEAD` / branch / remote ref pills, the working-tree row above `HEAD`, and a
selected commit's detail panel — here docked as a sidebar. The shot follows your
GitHub theme; both are the same view, [light](docs/screenshot-light.png) and
[dark](docs/screenshot-dark.png).*

A **local git commit-graph viewer** — a web app that renders the commit DAG of
your repositories the way the proven desktop tools do (mhutchie/vscode-git-graph,
GitLens, GitKraken), as a standalone local-machine service.

Point it at a folder of projects, pick a repository, and read its history in a
browser: lanes, merges, ref pills, diffs, and uncommitted changes — and check out
a branch, tag, or commit straight from the graph.

## Quick start

With [Nix](https://nixos.org/download) — nothing to install:

```sh
nix run github:wyf-ACCEPT/git-graph            # serve the repos under the cwd
nix run github:wyf-ACCEPT/git-graph -- ~/src   # serve a specific projects folder
```

From source, with [Bun](https://bun.sh):

```sh
git clone https://github.com/wyf-ACCEPT/git-graph
cd git-graph
bun install
bun run build
bun run cli -- ~/src
```

Either way a browser opens on the graph. `nix profile install
github:wyf-ACCEPT/git-graph` puts `bgg` (and a spelled-out
`git-graph` alias) on your `PATH` for good.

## Local `gg` shortcut

After building, `./gg [ROOT] [--repo NAME] [--port PORT]` starts the loopback daemon
on port 3107 and prints/copies its URL. ROOT defaults to the current directory.
Use `./gg --help`, `--status`, `--logs`, or `--stop` for management. Open the URL
in a browser or the current Codex conversation's browser panel.

`./install.sh` can recreate a pinned local Bun runtime and build the application;
it requires Node.js/npm and network access. Dependencies and runtime files are
ignored by Git. A regular Bun installation also works with the normal commands
above. The launcher accepts `GIT_GRAPH_BUN` for an explicit Bun executable.

## Using it

`bgg` serves the git repositories under a **served root**: the directory itself,
if it is one, plus its direct children. The root is the path you pass, or the
current directory if you pass none.

```
bgg [path]                                   serve, open a browser, stay in the foreground
bgg serve [path]                             same, spelled out
bgg daemon {start|stop|restart|status|logs}  run one in the background
bgg status                                   is an instance running, and where
bgg version · bgg help
```

Every instance auto-assigns a free port and announces it, so any number can run
at once without colliding. `--port <n>` pins one exactly and **fails loudly** on
a conflict rather than quietly moving — a pinned port that silently relocates is
worse than one that stops.

Running the server directly works too: `bun server/index.ts ~/projects`, or set
`GIT_GRAPH_ROOT`.

To serve an exact set of repositories instead — wherever they live on disk — set
`GIT_GRAPH_REPOSITORIES_FILE` to a file listing their absolute paths, one per
line (`#` comments and blank lines are ignored). The root is then not scanned at
all, the repository identifier (`repo=`) becomes the absolute path, and the file
is re-read on every request, so editing it changes what is served without a
restart. A named path that is not a git repository is left out; a relative path,
or a file that cannot be read, is a fatal startup error.

## What it shows

- An SVG **commit graph** with per-lane colours, a compact hollow node only at
  HEAD, and curved elbow edges. The lane assignment handles octopus merges, root commits,
  disconnected histories, and truncated windows.
- **Commit timestamps** to the second in local time, omitting the year for the
  current year and retaining the original ISO timestamp in the tooltip.
- **Full-file previews** from changed-file rows, separate from diff and copy-path
  controls, for commits, comparisons, and working-tree files.
- **Ref pills** — `HEAD`, local branches, remote-tracking branches, tags. A
  branch and the remotes pointing at the same commit read as one segmented pill
  (`main │ origin`, the remotes appended inside the branch's own chip); when they
  have drifted apart, each keeps its own. The checked-out branch is marked by a
  ring on its pill and a small lane-coloured ring on its row, not by git's
  `HEAD -> ` plumbing text.
- **Fuzzy search** over subject / hash / author, with the matched characters
  highlighted, and a commits / lanes / matches readout.
- A **commit detail panel** — full message, changed files, copy-hash, clickable
  parents — opening inline beneath the row by default, or docked as a sidebar.
  Each changed file expands to a whole-file-tokenized diff.
- **Uncommitted changes** as a gray graph node connected above `HEAD`, with a
  working-tree row for tracked *and* untracked files opening the same diff view.
  Clean working trees keep the status row without a pending node.
- **Standalone diff tabs** for a single file, a whole commit, a branch (compared
  three-dot against the default branch), or the working tree.
- A **context menu** on every commit row and ref pill — right-click, or
  `Shift+F10` / the context-menu key on a focused row: check out a branch, a tag,
  or a commit (detached `HEAD`, with a warning saying so), copy the full
  hash, open the commit in a diff tab, or compare a branch against the default
  branch. Entries that cannot apply stay in the menu, disabled, and say why.
- A **repository picker**, deep-linkable via `?repo=`.
- Light / dark / system theme, persisted.

## What it changes

**Checkout, branch/tag management, merge, cherry-pick and remote synchronization are available from the graph.** Every new branch/tag/merge action has an explicit review before execution. Context-menu
checkouts state the command and repository before confirmation; detached
checkouts explain their consequence. Double-clicking a non-current local branch
switches directly after a fresh server-side clean-worktree check. Uncommitted
changes open the confirmation dialog instead. It is `git switch` underneath,
so git's own safety stays in charge: a switch that would
overwrite uncommitted changes is refused, and git's message is shown to you
verbatim. After a checkout the graph, the working-tree row, and any open
`/working` tab refresh.

Double-click an `origin` branch that has no same-named local branch to confirm
creating and checking out a local tracking branch. The context menu offers the
same action for keyboard users. `origin/HEAD` is excluded. Confirmation uses the
current local remote-tracking ref without fetching, refuses an existing local
branch, and retains Git's protection against overwriting uncommitted work.

## Remote synchronization and branch pull/push

The graph refreshes **all branches from every remote of the currently viewed
repository** every five minutes. The **Auto pull · 5m** switch remembers the
choice for each repository. This is a fetch: it updates the graph's remote
branches and commits, including newly created branches, and prunes deleted
remote branches. Local branches, HEAD and working files are unchanged, so
uncommitted files and detached HEAD do not prevent remote synchronization.

The three toolbar buttons have separate scopes:

- **Refresh** fetches all branches from every configured remote immediately.
- **Down** pulls only the current branch from its upstream, and is enabled only
  when the branch is behind without local commits ahead.
- **Up** pushes only the current branch to its upstream, and is enabled only
  when the branch is ahead without remote commits behind.

Pull requires a clean worktree and fast-forwards only. Push never forces.
Divergence disables both arrows with a visible reason. Double-clicking an
origin ref whose local branch already exists offers confirmation to switch
and pull when the remote branch is ahead.

Automatic sync waits five minutes after opening/selecting/enabling, pauses
while another Git action or confirmation is active, and stops with the graph.
Background browser throttling can delay it. Manual refresh works with the
switch off. Shared writer locking prevents overlapping service actions, and
automatic fetch attempts are deduplicated across tabs. Downloads are
noninteractive with a 30-second deadline per remote. One remote failing does
not stop the others; partial success is reported and the graph is refreshed.
See [synchronization details](docs/6x19-auto-pull.md) and
[branch action details](docs/6x23-branch-sync.md).

## Branch, merge, cherry-pick and tag actions

Right-click a **commit** to create a branch or tag there, or cherry-pick that
commit onto the current branch. Branch creation optionally checks out the new
branch. Tags can be annotated (with a message) or lightweight.

Right-click a **local branch** to rename it, delete it using Git's non-force
merged-branch check, or merge it into the current branch. Merge options are
create a merge commit, fast-forward when possible, or fast-forward only. Remote
branch labels offer merge and guarded remote deletion. Checked-out branches
cannot be deleted, and branches used by other worktrees cannot be renamed here.

Right-click a **tag** to delete it locally, push just that tag to a chosen remote,
or delete the matching remote tag while keeping the local tag. Different remote
tags are never overwritten. Remote deletions refuse a changed remote tip.

All these actions show options and a final review naming the repository, target
and effects. A changed repository requires another review. Merge/cherry-pick
require a clean worktree. When they stop in conflict, the graph shows a recovery
banner: resolve and stage in your editor or terminal, then Continue; Abort is
available, and cherry-pick also offers Skip. Cherry-picking a merge commit
requires an explicit mainline parent choice. See [action details](docs/6x23-repository-actions.md).

## Security model — loopback by default

git-graph is an **unauthenticated** API: anything that can reach the port can
read every repository under the served root — commit history, diffs, and
working-tree contents. So the server binds `127.0.0.1`, and **that loopback bind
is the access control.**

Binding a non-loopback address (`HOST=…`) is a fatal startup error unless you
name the served host(s) in `GIT_GRAPH_ALLOWED_HOSTS`. Setting that variable is
an acknowledgement that an authenticating reverse proxy fronts the service and
the port is not directly reachable. There is no silent way to publish it.

Whatever the bind address, the server also answers only for the host names it is
reachable under: `localhost`, `127.0.0.1` (the whole `127.0.0.0/8` block),
`[::1]`, and the names in `GIT_GRAPH_ALLOWED_HOSTS`. A request whose `Host`
header names anything else gets `421`, and one with no `Host` header at all
gets `400`. This is what stops DNS rebinding, where a page you visit points its
own domain at `127.0.0.1` so that your browser treats the service as that page's
own server. A reverse proxy that passes its public host name through in `Host`
(Caddy does by default) therefore needs that name in `GIT_GRAPH_ALLOWED_HOSTS`
even when git-graph itself binds loopback.

Only repositories the server itself discovered — or that the operator's
repositories file names — are ever passed to git. Every
untrusted input is re-validated by membership against git's own listings —
repository ids against the repo listing, file paths against a commit's own file
list, refs against `git for-each-ref` — and nothing is interpolated into a
shell. A checkout holds the same line: the branch or tag must come out of
`git for-each-ref`, the commit out of the history the graph shows.

The checkout route also refuses requests that did not come from the git-graph
page itself. Loopback keeps other machines out, but not other web pages open in
your browser, which can send requests to `127.0.0.1` too. So a checkout must
carry a custom header and a JSON body, which a foreign page cannot send without a
CORS preflight the server never answers. A browser request marked
`Sec-Fetch-Site: cross-site`, or whose `Origin` names a host the server does not
answer for, is refused outright. A DNS-rebound page never gets this far: the
Host check above refuses it first.

**Embedding hosts** are the one deliberate exception, and they are off by
default. `GIT_GRAPH_ALLOWED_ORIGINS` names the exact origins
(`http://127.0.0.1:3115` — scheme, host, port, as a browser writes `Origin`) of
pages that mount the graph and talk to this server across origins. Those origins,
and only those, get CORS headers (so their browser lets them read responses and
grants the checkout's preflight) and may send the checkout as `same-site` or
`cross-site`. Nothing else is relaxed: the custom header, the JSON body, the Host
check, and the membership checks all still apply, and an unlisted origin is
refused exactly as before. A malformed entry is a fatal startup error. The
contract a host follows is in [`docs/embedding-host.md`](docs/embedding-host.md).

See [`SECURITY.md`](SECURITY.md) for the full threat model and how to report a
vulnerability.

## Running it as a service

The flake exposes a hardened **NixOS module** (`nixosModules.default`,
`services.git-graph`) that runs the server as a loopback-bound systemd
service. Front it with an authenticating reverse proxy and set `allowedHosts`
to the name it serves before exposing it — the service answers for no other
name, loopback aside. See the security model above.

## Embedding the graph

The render layer is importable by subpath, so another React app can mount the
graph without forking it:

| Subpath | Contents |
|---|---|
| `git-graph/components` | The fetch-free React components — graph, detail panel, diffs, working-tree row, the git-action context menu and its confirmation dialog |
| `git-graph/shared` | The git schema, the layout algorithm, the fuzzy matcher, the context-menu descriptor |
| `git-graph/theme.css` | The palette and lane colour tokens |

Every component takes its data as props and does no fetching of its own; the
host owns the requests. The package is not published to npm — consume it by
source alias (Vite `resolve.alias`) or a git dependency.

A host can also use git-graph's own server as its backend instead of
re-implementing the git layer: launch it with `GIT_GRAPH_REPOSITORIES_FILE` (the
repositories the host knows) and `GIT_GRAPH_ALLOWED_ORIGINS` (the host page's
origins), and fetch the API cross-origin — reads and checkout alike. See
[`docs/embedding-host.md`](docs/embedding-host.md).

## Development

```sh
bun install
bun run dev        # resolves free ports, then starts server + client
bun run dev:ports  # report the resolved ports without starting anything
bun test           # 287 tests
bun run typecheck
bun run build      # dist/client + dist/server (server and the bgg CLI)
```

[mise](https://mise.jdx.dev) pins the toolchain (`mise install`) and exposes the
same commands as tasks (`mise run dev`, `mise run test`, …). Nix users can get a
shell with everything via `nix develop`.

[`AGENTS.md`](AGENTS.md) is the architecture manual — the layering, the
conventions, and why they are what they are. Read it before a non-trivial
change, and see [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to get a change
merged.

## Provenance

The lane-assignment algorithm is **pvigier's active-lane sweep**, described in
[Commit graph drawing
algorithms](https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html)
— the same approach mhutchie/vscode-git-graph, GitLens and GitKraken take. It is
implemented from that description and pinned by a regression fixture, so its
output cannot drift unnoticed.

Built with [Bun](https://bun.sh), [Elysia](https://elysiajs.com), React 19,
[Tailwind CSS](https://tailwindcss.com) v4 and [Vite](https://vite.dev). Diffs
are rendered by [`@git-diff-view`](https://github.com/MrWangJustToDo/git-diff-view)
with [Shiki](https://shiki.style) tokenization; icons are
[Tabler](https://tabler.io/icons).

## Status

Pre-1.0. The context menu ships with checkout as its first git action. The
rest of [#2](https://github.com/binaryplease/git-graph/issues/2) will follow as
their own slices, one action at a time: create a branch or tag, revert,
cherry-pick, reset, merge, rebase, delete, push/pull/fetch, and rename.

## License

See [`LICENSE`](LICENSE).
