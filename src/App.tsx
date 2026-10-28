import { WorkingTreeDetailPanel } from './components/WorkingTreeDetailPanel'
import { initialRepository } from './lib/workspace'
import type { OperationState, ActionResult } from '../shared/repositoryActions'
import type { GitMenuEntry } from '../shared/gitActions'
import { RepositoryActionDialog, type ActionSeed } from './components/RepositoryActionDialog'
import { fetchOperationState } from './lib/api'
import type { BranchSync } from '../shared/branchSync'
import { fetchBranchSync, pullRepository, pushRepository } from './lib/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconCircleCheck, IconAlertCircle, IconGitMerge, IconSearch, IconX } from '@tabler/icons-react'
import { describeCheckout, findHeadState } from '../shared/gitActions'
import type {
  BranchList,
  CheckoutTarget,
  CommitDetail,
  CommitLog,
  FileDiff,
  GitCommit,
  RepositoryList,
  WorkingTree,
} from '../shared/git.schema'
import {
  checkout,
  GitRequestError,
  fetchBranches,
  fetchCommitDetail,
  fetchCommitLog,
  fetchFileDiff,
  fetchRepositories,
  fetchServerWorkspace,
  fetchWorkingTree,
  fetchWorkingFileDiff,
} from './lib/api'
import { commitDiffHref, compareHref, fileDiffHref, workingHref } from './lib/diffRoutes'
import { loadHighlighter } from './lib/highlighter'
import { useTheme } from './lib/theme'
import { filePreviewHref } from './lib/filePreview'
import { useDetailLayout } from './lib/detailLayout'
import { useAutoPull } from './lib/autoPull'
import { useBranchSync } from './lib/branchSync'
import { AutoPullControl } from './components/AutoPullControl'
import { announceRepositoryChange, useRepositoryChanges } from './lib/repositoryChanges'
import {
  CommitGraph,
  CommitDetailPanel,
  ConfirmActionDialog,
  GitActionMenu,
  UncommittedChangesRow,
  graphContentLeft,
  type CommitContextMenuRequest,
  type CommitGraphStats,
  type GitActionNotice,
} from './components'

// How long a success notice stays before it clears itself. Failures of a git
// write stay visible until dismissed, either in the confirmation dialog or
// as an error notice for the direct double-click shortcut.
const NOTICE_MILLISECONDS = 6000
import { ThemeToggle } from './components/ThemeToggle'
import { DetailLayoutToggle } from './components/DetailLayoutToggle'

const WORKING_TREE_SELECTION = 'working-tree'

export function App() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme()
  const { detailLayout, setDetailLayout } = useDetailLayout()
  const [repositoryList, setRepositoryList] = useState<RepositoryList | null>(null)
  // The selected repository's relativePath — '' is a valid value (the served
  // root itself is a repository), so "nothing selected" is null.
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null)
  const [commitLog, setCommitLog] = useState<CommitLog | null>(null)
  // Branches of the selected repository — the default one is the base a "compare
  // against main" affordance diffs against, and knowing it lets the panel hide
  // the affordance on the default branch itself.
  const [branchList, setBranchList] = useState<BranchList | null>(null)
  // The selected repository's uncommitted changes — drives the "Uncommitted
  // changes" node at the top of the graph. A failure here is not fatal to the
  // graph, so it only leaves the node absent rather than raising an error.
  const [workingTree, setWorkingTree] = useState<WorkingTree | null>(null)
  const [isLoadingLog, setIsLoadingLog] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [graphStats, setGraphStats] = useState<CommitGraphStats>({
    laneCount: 0,
    matchCount: null,
  })
  // The commit whose details are open. The hash is the selection; the detail is
  // fetched for it, so the panel can show the hash while the payload is in
  // flight and after a failure.
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  // The file whose diff is open in the panel, and the diff fetched for it —
  // same shape as the commit selection above, one level down.
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [isLoadingFileDiff, setIsLoadingFileDiff] = useState(false)
  const [fileDiffError, setFileDiffError] = useState<string | null>(null)
  // Bumped whenever the selected repository changes on disk (a checkout here or
  // in another tab), so every view of it refetches: log, branches, working tree,
  // and the open commit's refs.
  const [repositoryVersion, setRepositoryVersion] = useState(0)
  // The git-action context menu, the checkout waiting on its confirmation, and
  // the one-line outcome shown after an action.
  const [contextMenu, setContextMenu] = useState<CommitContextMenuRequest | null>(null)
  const [pendingCheckout, setPendingCheckout] = useState<CheckoutTarget | null>(null)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [notice, setNotice] = useState<GitActionNotice | null>(null)
  const [pendingCheckoutDirty, setPendingCheckoutDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<ActionSeed | null>(null)
  const [actionRunning, setActionRunning] = useState(false)
  const [operationState, setOperationState] = useState<OperationState | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [pendingPull, setPendingPull] = useState<BranchSync | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const syncInFlight = useRef(false)
  const checkoutInFlight = useRef(false)
  const currentRepository = useRef(selectedRepository)
  currentRepository.current = selectedRepository
  const refreshRepository = useCallback(() => setRepositoryVersion(version => version + 1), [])
  const sync = useBranchSync({ repository: selectedRepository, version: repositoryVersion, onRepositoryChange: refreshRepository })
  const autoPull = useAutoPull({
    repository: selectedRepository,
    repositoryKey: selectedRepository === null ? null : JSON.stringify([repositoryList?.rootPath, selectedRepository]),
    paused: pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || pendingCheckout !== null || contextMenu !== null,
    onRefresh: refreshRepository,
  })

  // Loading a syntax grammar the first time a diff is expanded costs about half
  // a second; warming the highlighter here spends it while nobody is waiting.
  useEffect(() => {
    loadHighlighter().catch(() => {
      // A failed warm-up is not an app-level error — FileDiff retries on expand
      // and reports the failure where the diff would have been.
    })
  }, [])

  useEffect(() => {
    const loadRepositories = async () => {
      if (!new URLSearchParams(location.search).has('root')) {
        const root = await fetchServerWorkspace()
        if (root !== null) {
          const url = new URL(location.href)
          url.searchParams.set('root', root)
          history.replaceState(null, '', `${url.pathname}${url.search}`)
        }
      }
      return fetchRepositories()
    }
    loadRepositories()
      .then((list) => {
        setRepositoryList(list)
        if (list.rootPath !== null) {
          const url = new URL(location.href)
          url.searchParams.set('root', list.rootPath)
          history.replaceState(null, '', `${url.pathname}${url.search}`)
        }
        const requested = new URLSearchParams(location.search).get('repo')
        setSelectedRepository(initialRepository(list.repositories, requested))
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(() => {
    if (selectedRepository === null) return
    let cancelled = false
    setIsLoadingLog(true)
    setLoadError(null)
    fetchCommitLog(selectedRepository)
      .then((log) => {
        if (!cancelled) setCommitLog(log)
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLog(false)
      })
    // The branch listing drives the compare affordances; a failure there is not
    // fatal to the graph, so it only leaves the list unset rather than raising an
    // error.
    fetchBranches(selectedRepository)
      .then((list) => {
        if (!cancelled) setBranchList(list)
      })
      .catch(() => {})
    // The working tree drives the "Uncommitted changes" node; like the branch
    // listing a failure there is not fatal to the graph, so it is swallowed.
    fetchWorkingTree(selectedRepository)
      .then((tree) => {
        if (!cancelled) setWorkingTree(tree)
      })
      .catch(() => {})
    // Deep-linkable selection with natural back-button-free history.
    const parameters = new URLSearchParams(location.search)
    parameters.set('repo', selectedRepository)
    history.replaceState(null, '', `?${parameters}`)
    return () => {
      cancelled = true
    }
  }, [selectedRepository, repositoryVersion])

  // Switching repositories invalidates any open commit — its hash belongs to
  // the previous history — and the branch listing and working tree, which are
  // cleared here rather than on every refetch so a refresh after a checkout does
  // not blank the working-tree row while it reloads. An open menu or a pending
  // checkout named the previous repository too.
  useEffect(() => {
    setSelectedCommitHash(null)
    setBranchList(null)
    setWorkingTree(null)
    setContextMenu(null)
    setPendingCheckout(null)
    setPendingPull(null)
    setPendingAction(null)
    setOperationState(null)
  }, [selectedRepository])

  useEffect(() => {
    if (selectedRepository === null) return
    let active = true; let generation = 0
    const refresh = () => {
      const requestId = ++generation
      void fetchOperationState(selectedRepository).then(value => {
        if (active && requestId === generation) { setOperationState(value); setOperationError(null) }
      }).catch(error => { if (active && requestId === generation) { setOperationState(null); setOperationError(error.message) } })
    }
    refresh()
    const timer = setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [selectedRepository, repositoryVersion])

  // A checkout in another tab changes what this one shows.
  useRepositoryChanges(
    selectedRepository,
    useCallback(() => setRepositoryVersion((version) => version + 1), []),
  )

  useEffect(() => {
    if (notice === null || notice.tone === 'error') return
    const timer = setTimeout(() => setNotice(null), NOTICE_MILLISECONDS)
    return () => clearTimeout(timer)
  }, [notice])

  // Fetch the details of whatever commit is selected.
  useEffect(() => {
    if (selectedRepository === null || selectedCommitHash === null || selectedCommitHash === WORKING_TREE_SELECTION) {
      setCommitDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setIsLoadingDetail(true)
    setDetailError(null)
    setCommitDetail(null)
    fetchCommitDetail(selectedRepository, selectedCommitHash)
      .then((detail) => {
        if (!cancelled) setCommitDetail(detail)
      })
      .catch((error: Error) => {
        if (!cancelled) setDetailError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepository, selectedCommitHash, repositoryVersion])

  // Selecting another commit invalidates the open file — its path belongs to
  // the previous commit's listing.
  useEffect(() => setExpandedFilePath(null), [selectedCommitHash])

  // Fetch the diff of whatever file is expanded.
  useEffect(() => {
    if (selectedRepository === null || selectedCommitHash === null || expandedFilePath === null) {
      setFileDiff(null)
      setFileDiffError(null)
      return
    }
    let cancelled = false
    setIsLoadingFileDiff(true)
    setFileDiffError(null)
    setFileDiff(null)
    const loadDiff = selectedCommitHash === WORKING_TREE_SELECTION
      ? fetchWorkingFileDiff(selectedRepository, expandedFilePath)
      : fetchFileDiff(selectedRepository, selectedCommitHash, expandedFilePath)
    loadDiff
      .then((diff) => {
        if (!cancelled) setFileDiff(diff)
      })
      .catch((error: Error) => {
        if (!cancelled) setFileDiffError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFileDiff(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepository, selectedCommitHash, expandedFilePath, repositoryVersion, workingTree])

  const handleToggleFile = useCallback(
    (filePath: string) => setExpandedFilePath((current) => (current === filePath ? null : filePath)),
    [],
  )

  const handleGraphStats = useCallback((stats: CommitGraphStats) => setGraphStats(stats), [])
  // Clicking a row toggles its detail: selecting a new commit opens it, clicking
  // the already-open one closes it (so the inline expansion collapses on a second
  // click of its own row). Parent navigation from the panel sets the hash
  // directly, so it never toggles itself shut.
  const handleSelectCommit = useCallback(
    (commit: GitCommit) =>
      setSelectedCommitHash((currentHash) => (currentHash === commit.hash ? null : commit.hash)),
    [],
  )

  // The app shell owns the route scheme (App.tsx does all fetching and routing);
  // the panel only turns these strings into links for the file it opens.
  const buildFileDiffHref = useCallback(
    (filePath: string) =>
      selectedRepository === null || selectedCommitHash === null
        ? null
        : fileDiffHref(selectedRepository, selectedCommitHash, filePath),
    [selectedRepository, selectedCommitHash],
  )

  const buildCommitDiffHref = useCallback(
    () =>
      selectedRepository === null || selectedCommitHash === null
        ? null
        : commitDiffHref(selectedRepository, selectedCommitHash),
    [selectedRepository, selectedCommitHash],
  )

  const defaultBranch = branchList?.defaultBranch ?? null
  const localBranchNames = branchList?.branches.map((branch) => branch.name)
  const buildCompareHref = useCallback(
    (branchName: string) => {
      // Nothing to compare a branch against without a repository, and comparing
      // the default branch against itself is always empty — skip both.
      if (selectedRepository === null || branchName === defaultBranch) return null
      return compareHref(selectedRepository, branchName)
    },
    [selectedRepository, defaultBranch],
  )

  const repositories = repositoryList?.repositories ?? []
  const commits = commitLog?.commits ?? []
  const hasCommits = commits.length > 0
  const remotes = commitLog?.remotes ?? []
  const headState = useMemo(() => findHeadState(commits, remotes), [commits, remotes])
  const repositoryName =
    repositories.find((repository) => repository.relativePath === selectedRepository)?.name ??
    commitLog?.repository ??
    ''

  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const buildMenuCommitHref = useCallback(
    (commit: GitCommit) => (selectedRepository === null ? null : commitDiffHref(selectedRepository, commit.hash)),
    [selectedRepository],
  )

  // Context-menu actions retain confirmation. Double-clicking a local branch
  // opts into the server's fresh clean-worktree check before direct execution.
  const requestCheckout = useCallback((target: CheckoutTarget) => {
    setCheckoutError(null)
    setPendingCheckoutDirty(false)
    setPendingCheckout(target)
  }, [])

  const cancelCheckout = useCallback(() => {
    setPendingCheckout(null)
    setPendingCheckoutDirty(false)
    setCheckoutError(null)
  }, [])

  async function runCheckout(target: CheckoutTarget, requireClean = false) {
    const repository = selectedRepository
    if (repository === null || checkoutInFlight.current || syncInFlight.current || autoPull.isRunning) return
    checkoutInFlight.current = true
    setIsCheckingOut(true)
    setCheckoutError(null)
    try {
      const result = await checkout(repository, target, { requireClean })
      announceRepositoryChange(repository)
      if (currentRepository.current !== repository) return
      setPendingCheckout(null)
      setPendingCheckoutDirty(false)
      setNotice({ tone: 'success', text: result.message || `HEAD is now at ${result.head}` })
      setRepositoryVersion((version) => version + 1)
    } catch (error) {
      if (currentRepository.current !== repository) return
      if (requireClean && error instanceof GitRequestError && error.code === 'worktree-dirty') {
        setPendingCheckoutDirty(true)
        setPendingCheckout(target)
        // Refresh the dirty badge too; the refusal itself is already authoritative.
        void fetchWorkingTree(repository).then((tree) => {
          if (currentRepository.current === repository) setWorkingTree(tree)
        }).catch(() => {})
      } else {
        const message = error instanceof Error ? error.message : 'the checkout failed'
        if (requireClean) setNotice({ tone: 'error', text: message })
        else setCheckoutError(message)
      }
    } finally {
      checkoutInFlight.current = false
      setIsCheckingOut(false)
    }
  }

  function confirmCheckout() {
    if (pendingCheckout !== null) void runCheckout(pendingCheckout)
  }

  function checkoutBranch(branchName: string) {
    if (pendingCheckout !== null || branchName === headState.branch) return
    setContextMenu(null)
    void runCheckout({ kind: 'branch', name: branchName }, true)
  }

  function checkoutRemoteBranch(branchName: string) {
    if (pendingCheckout !== null || pendingPull !== null || checkoutInFlight.current || syncInFlight.current || autoPull.isRunning) return
    setContextMenu(null)
    if (localBranchNames?.includes(branchName)) {
      const repository = selectedRepository
      if (repository === null) return
      syncInFlight.current = true
      setSyncRunning(true)
      void fetchBranchSync(repository, branchName).then(value => {
        if (currentRepository.current !== repository) return
        if (value.behind > 0) { setCheckoutError(null); setPendingPull(value) }
        else setNotice({ tone: 'success', text: `Local branch ${branchName} already exists. ${value.reason}` })
      }).catch(error => {
        if (currentRepository.current === repository) setNotice({ tone: 'error', text: error.message })
      }).finally(() => { syncInFlight.current = false; setSyncRunning(false) })
      return
    }
    requestCheckout({ kind: 'remote-branch', remote: 'origin', name: branchName })
  }

  async function runBranchSync(action: 'pull' | 'push', originBranch?: string) {
    const repository = selectedRepository
    const branch = originBranch ?? sync?.branch
    if (repository === null || !branch || syncInFlight.current || checkoutInFlight.current || autoPull.isRunning) return
    syncInFlight.current = true
    setSyncRunning(true)
    setCheckoutError(null)
    try {
      const result = action === 'push' ? await pushRepository(repository, branch) : await pullRepository(repository, true,
        originBranch ? { originBranch } : { expectedBranch: branch })
      if (currentRepository.current !== repository) return
      const success = 'success' in result ? result.success : result.state === 'updated' || result.state === 'up-to-date'
      if (!success && originBranch) setCheckoutError(result.message)
      else { setPendingPull(null); setNotice({ tone: success ? 'success' : 'error', text: result.message }) }
    } catch (error) {
      if (currentRepository.current !== repository) return
      const text = error instanceof Error ? error.message : 'Git action failed. Refresh and retry.'
      if (originBranch) setCheckoutError(text)
      else setNotice({ tone: 'error', text })
    } finally {
      announceRepositoryChange(repository)
      if (currentRepository.current === repository) setRepositoryVersion(v => v + 1)
      syncInFlight.current = false
      setSyncRunning(false)
    }
  }

  function requestRepositoryAction(entry: GitMenuEntry) {
    if (!contextMenu || !operationState || actionRunning || isCheckingOut || syncRunning || autoPull.isRunning || pendingAction) return
    const remote = operationState.remotes.includes('origin') ? 'origin' : operationState.remotes[0] ?? ''
    let seed: ActionSeed
    switch (entry.action) {
      case 'create-branch': seed = { action: { kind: 'create-branch', commit: entry.subject, name: '', checkout: false } }; break
      case 'rename-branch': seed = { action: { kind: 'rename-branch', name: entry.subject, newName: entry.subject } }; break
      case 'delete-branch': seed = { action: { kind: 'delete-branch', name: entry.subject } }; break
      case 'delete-remote-branch': {
        const owner = [...operationState.remotes].sort((a, b) => b.length - a.length).find(name => entry.subject.startsWith(name + '/'))
        if (!owner) return
        seed = { action: { kind: 'delete-remote-branch', remote: owner, name: entry.subject.slice(owner.length + 1) } }; break
      }
      case 'merge-branch': seed = { action: { kind: 'merge', source: entry.subject, mode: 'no-ff' } }; break
      case 'cherry-pick': seed = { action: { kind: 'cherry-pick', commit: entry.subject }, parentCount: contextMenu.commit.parents.length }; break
      case 'create-tag': seed = { action: { kind: 'create-tag', commit: entry.subject, name: '', annotated: true, message: '' } }; break
      case 'delete-tag': seed = { action: { kind: 'delete-tag', name: entry.subject } }; break
      case 'push-tag': seed = { action: { kind: 'push-tag', name: entry.subject, remote } }; break
      case 'delete-remote-tag': seed = { action: { kind: 'delete-remote-tag', name: entry.subject, remote } }; break
      default: return
    }
    setContextMenu(null); setPendingAction(seed)
  }
  function completedRepositoryAction(result: ActionResult) {
    setPendingAction(null); setOperationState(result.operation)
    setNotice({ tone: result.state === 'conflict' ? 'error' : 'success', text: result.message })
    if (selectedRepository !== null) announceRepositoryChange(selectedRepository)
    refreshRepository()
  }

  const loadedHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits])
  const isCommitLoaded = useCallback((commitHash: string) => loadedHashes.has(commitHash), [loadedHashes])

  // Esc closes the panel; ↑/↓ walk the graph while it is open, so a commit can
  // be read through without going back to the mouse. Typing in the search box
  // keeps its own arrow-key behaviour.
  const isOverlayOpen = pendingAction !== null || contextMenu !== null || pendingCheckout !== null || pendingPull !== null
  useEffect(() => {
    // An open menu or dialog owns the keyboard; ↑/↓ and Esc are theirs then.
    if (selectedCommitHash === null || isOverlayOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.isContentEditable) {
        if (event.key !== 'Escape') return
      }
      if (event.key === 'Escape') {
        setSelectedCommitHash(null)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const currentRow = commits.findIndex((commit) => commit.hash === selectedCommitHash)
      if (currentRow < 0 && selectedCommitHash !== WORKING_TREE_SELECTION) return
      const nextRow = currentRow + (event.key === 'ArrowDown' ? 1 : -1)
      if (nextRow === -1 && (workingTree?.files.length ?? 0) > 0) {
        event.preventDefault()
        setSelectedCommitHash(WORKING_TREE_SELECTION)
        return
      }
      const nextCommit = commits[nextRow]
      if (!nextCommit) return
      event.preventDefault()
      setSelectedCommitHash(nextCommit.hash)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commits, selectedCommitHash, isOverlayOpen, workingTree])

  const readout = [
    hasCommits &&
      `${commits.length}${commitLog?.truncated ? '+' : ''} commits · ${graphStats.laneCount} lane${graphStats.laneCount === 1 ? '' : 's'}`,
    graphStats.matchCount !== null &&
      hasCommits &&
      `${graphStats.matchCount} match${graphStats.matchCount === 1 ? '' : 'es'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // Built once so the sidebar and inline mounts render the identical panel — the
  // variant it carries decides its frame (ADR-0027: one component, the detail is
  // the invariant). The layout toggle is an app-wide display preference (persisted
  // like the theme, settable before any commit is open), so it lives in the app's
  // top bar beside the theme toggle rather than on the panel's own header.
  const workingSelected = selectedCommitHash === WORKING_TREE_SELECTION
  const toggleWorkingTree = () => setSelectedCommitHash((current) => current === WORKING_TREE_SELECTION ? null : WORKING_TREE_SELECTION)
  useEffect(() => {
    if (workingSelected && workingTree !== null && workingTree.files.length === 0) setSelectedCommitHash(null)
  }, [workingSelected, workingTree])
  const detailPanel =
    workingSelected ? (workingTree !== null && selectedRepository !== null ? <WorkingTreeDetailPanel
      working={workingTree} repository={selectedRepository} variant={detailLayout}
      expandedFilePath={expandedFilePath} onToggleFile={handleToggleFile} fileDiff={fileDiff}
      isLoadingFileDiff={isLoadingFileDiff} fileDiffError={fileDiffError} diffViewTheme={resolvedTheme}
      onClose={() => setSelectedCommitHash(null)} /> : null) : selectedCommitHash === null ? null : (
      <CommitDetailPanel
        laneColor={graphStats.selectedLaneColor}
        variant={detailLayout}
        detail={commitDetail}
        isLoading={isLoadingDetail}
        error={detailError}
        requestedHash={selectedCommitHash}
        onSelectCommit={setSelectedCommitHash}
        isCommitLoaded={isCommitLoaded}
        expandedFilePath={expandedFilePath}
        onToggleFile={handleToggleFile}
        buildFileDiffHref={buildFileDiffHref}
        buildFileHref={(path) => selectedRepository === null || selectedCommitHash === null ? null : filePreviewHref({
          kind: 'commit', repo: selectedRepository, hash: commitDetail?.fullHash || selectedCommitHash, path,
        })}
        buildCommitDiffHref={buildCommitDiffHref}
        buildCompareHref={buildCompareHref}
        onCheckoutBranch={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || autoPull.isRunning ? undefined : checkoutBranch}
        onCheckoutRemoteBranch={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || autoPull.isRunning ? undefined : checkoutRemoteBranch}
        localBranchNames={localBranchNames}
        fileDiff={fileDiff}
        isLoadingFileDiff={isLoadingFileDiff}
        fileDiffError={fileDiffError}
        diffViewTheme={resolvedTheme}
        onClose={() => setSelectedCommitHash(null)}
      />
    )

  return (
    // The standalone shell is capped at 1440×900 and centred: the graph is a
    // dense, fixed-width-ish reading surface, so letting it stretch across an
    // ultrawide display only pushes the readout away from the rows. Below the
    // cap it fills the viewport as before.
    <div className="flex h-screen w-screen items-center justify-center bg-backdrop">
      <div className="flex h-full max-h-[900px] w-full max-w-[1440px] flex-col overflow-hidden rounded-lg border border-line bg-canvas font-sans text-[13px] text-fg shadow-2xl shadow-black/60">
        <header className="flex flex-wrap items-center gap-3.5 border-b border-line bg-raised px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold">
            <IconGitMerge size={20} className="text-accent" aria-hidden />
            <span>
              Git Graph <small className="font-normal text-faint">git-graph</small>
            </span>
          </div>

          {repositoryList?.rootPath && (
            <div className="min-w-0 max-w-full truncate text-xs text-dim" title={repositoryList.rootPath} aria-label="Workspace directory">
              Workspace: <span className="font-mono">{repositoryList.rootPath}</span>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-1.5 text-dim">
              repository
              <select
                className="rounded-md border border-line bg-canvas px-2 py-1 text-fg focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                value={selectedRepository ?? ''}
                disabled={repositories.length === 0}
                // ADR-0025: disabled controls explain why, never vanish.
                title={
                  repositories.length === 0
                    ? 'no git repositories served — set GIT_GRAPH_ROOT or GIT_GRAPH_REPOSITORIES_FILE'
                    : undefined
                }
                onChange={(event) => setSelectedRepository(event.target.value)}
              >
                {repositories.length === 0 && <option value="">no repositories found</option>}
                {repositories.map((repository) => (
                  <option key={repository.relativePath} value={repository.relativePath}>
                    {repository.relativePath || repository.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="relative flex items-center">
              <IconSearch
                size={15}
                className="pointer-events-none absolute left-2 text-faint"
                aria-hidden
              />
              <input
                type="text"
                className="w-60 rounded-md border border-line bg-canvas py-1 pr-2 pl-7 text-fg placeholder:text-faint focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                placeholder={
                  hasCommits ? 'fuzzy search subject / hash / author' : 'load commits to search'
                }
                disabled={!hasCommits}
                title={hasCommits ? undefined : 'search enables once a repository with commits is loaded'}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <span className="text-faint tabular-nums">{readout}</span>
            <AutoPullControl enabled={autoPull.enabled} running={autoPull.isRunning || syncRunning || actionRunning}
              paused={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || pendingPull !== null || pendingCheckout !== null || contextMenu !== null}
              available={selectedRepository !== null} result={autoPull.result}
              busyLabel={syncRunning || actionRunning ? 'Running Git action…' : undefined} sync={sync} onBranchPull={() => { void runBranchSync('pull') }} onPush={() => { void runBranchSync('push') }}
              onToggle={autoPull.setEnabled} onPull={() => { void autoPull.pullNow() }} />

            <DetailLayoutToggle detailLayout={detailLayout} onSelectDetailLayout={setDetailLayout} />
            <ThemeToggle themeMode={themeMode} onSelectThemeMode={setThemeMode} />
          </div>
        </header>
        {operationError !== null && <div role="status" className="border-b border-line bg-raised px-4 py-2 text-[12px] text-dim">Git operation status unavailable: {operationError}</div>}
        {operationState?.operation && <section aria-label="Git operation recovery" className="border-b border-line bg-raised px-4 py-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{operationState.operation === 'other' ? 'Git operation in progress' : `${operationState.operation} in progress`}</strong>
            <span className="text-dim">Resolve and stage conflicts in your editor or terminal, then continue here.</span>
            <button type="button" onClick={refreshRepository} className="cursor-pointer rounded border border-line px-2 py-1 hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent">Refresh status</button>
            {operationState.operation !== 'other' && (['continue', ...(operationState.operation === 'cherry-pick' ? ['skip'] : []), 'abort'] as const).map(command => (
              <button key={command} type="button" disabled={actionRunning || pendingAction !== null || (command === 'continue' && operationState.conflicts.length > 0)}
                title={command === 'continue' && operationState.conflicts.length ? 'Resolve and stage all conflicted files first.' : `${command} the current ${operationState.operation}`}
                onClick={() => setPendingAction({ action: { kind: 'operation', operation: operationState.operation as 'merge' | 'cherry-pick', command: command as 'continue' | 'skip' | 'abort' } })}
                className="cursor-pointer rounded border border-line px-2 py-1 hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45">{command === 'continue' ? 'Continue' : command === 'skip' ? 'Skip commit' : 'Abort'}</button>
            ))}
          </div>
          {operationState.conflicts.length > 0 && <ul className="mt-2 max-h-32 overflow-auto font-mono text-[11.5px] text-dim">{operationState.conflicts.map(path => <li key={path}>{path}</li>)}</ul>}
        </section>}

        <main className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 overflow-auto">
          {/* While history is empty or loading, the standalone label still makes
              untracked files reachable. Loaded graphs own their working row
              and connected SVG node together. */}
          {loadError === null && !hasCommits && selectedRepository !== null && workingTree !== null && (
            <>
            <UncommittedChangesRow
              working={workingTree}
              href={workingHref(selectedRepository)} onOpen={toggleWorkingTree} selected={workingSelected}
              contentLeft={graphContentLeft(graphStats.laneCount)}
            />
            {detailLayout === 'inline' && workingSelected && detailPanel}
            </>
          )}
          {loadError !== null && (
            <p role="alert" className="px-4 py-6 text-[#ff7b72]">{loadError}</p>
          )}
          {loadError === null && repositoryList !== null && repositories.length === 0 && repositoryList.rootPath === null && (
            <p className="px-4 py-6 text-faint">
              None of the paths in the server's repositories file (
              <code className="font-mono text-dim">GIT_GRAPH_REPOSITORIES_FILE</code>) is a git repository.
            </p>
          )}
          {loadError === null && repositoryList !== null && repositories.length === 0 && repositoryList.rootPath !== null && (
            <p className="px-4 py-6 text-faint">
              No git repositories found under{' '}
              <code className="font-mono text-dim">{repositoryList.rootPath}</code>. Point the server
              at a projects folder: set <code className="font-mono text-dim">GIT_GRAPH_ROOT</code> or
              run <code className="font-mono text-dim">bun server/index.ts ~/projects</code>.
            </p>
          )}
          {loadError === null && selectedRepository !== null && !isLoadingLog && commitLog !== null && !hasCommits && (
            <p className="px-4 py-6 text-faint">This repository has no commits yet.</p>
          )}
          {loadError === null && isLoadingLog && commitLog === null && (
            <p className="px-4 py-6 text-faint">Loading commit history…</p>
          )}
          {loadError === null && hasCommits && (
            <CommitGraph
              commits={commits}
              remotes={remotes}
              workingTree={workingTree}
              workingHref={selectedRepository === null ? null : workingHref(selectedRepository)}
              onOpenWorkingTree={toggleWorkingTree} workingSelected={workingSelected}
              workingDetail={detailLayout === 'inline' && workingSelected ? detailPanel : null}
              searchQuery={searchQuery.trim()}
              onStats={handleGraphStats}
              selectedHash={workingSelected ? null : selectedCommitHash}
              onSelectCommit={handleSelectCommit}
              // Inline is the default: the detail expands in-flow beneath the
              // selected row. In sidebar mode the graph stays unbroken and the
              // panel docks to the right instead.
              selectedDetail={detailLayout === 'inline' && !workingSelected ? detailPanel : null}
              onContextMenu={setContextMenu}
              onCheckoutBranch={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || autoPull.isRunning ? undefined : checkoutBranch}
              onCheckoutRemoteBranch={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || autoPull.isRunning ? undefined : checkoutRemoteBranch}
              localBranchNames={localBranchNames}
            />
          )}
          </div>

          {detailLayout === 'sidebar' && detailPanel}
        </main>

        {/* The outcome of the last git action, beside the graph it changed. */}
        {notice !== null && (
          <div
            role="status"
            className={`flex items-center gap-2 border-t border-line bg-raised px-4 py-1.5 text-[12px] ${
              notice.tone === 'error' ? 'text-[#ff7b72]' : 'text-fg'
            }`}
          >
            {notice.tone === 'error' ? (
              <IconAlertCircle size={15} className="shrink-0" aria-hidden />
            ) : (
              <IconCircleCheck size={15} className="shrink-0 text-[#7ee787]" aria-hidden />
            )}
            <span title={notice.text} className="min-w-0 flex-1 truncate font-mono">{notice.text}</span>
            <button
              type="button"
              className="inline-flex cursor-pointer rounded p-0.5 text-faint hover:bg-rowhover hover:text-fg"
              onClick={() => setNotice(null)}
              title="dismiss"
              aria-label="dismiss"
            >
              <IconX size={14} aria-hidden />
            </button>
          </div>
        )}

        <footer className="flex flex-wrap gap-4 border-t border-line bg-raised px-4 py-1.5 text-[11.5px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-[9px] rounded-full bg-accent" /> commit
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[13px] w-[13px] rounded-full border-2 border-accent" /> HEAD (current commit)
          </span>
          <span>color = lane / branch column</span>
          {graphStats.matchCount === 0 && hasCommits && <span>no rows match your search</span>}
        </footer>
      </div>

      {contextMenu !== null && (
        <GitActionMenu
          input={{
            commit: contextMenu.commit,
            refGroups: contextMenu.refGroups,
            focusedGroup: contextMenu.focusedGroup,
            head: headState,
            defaultBranch,
            localBranchNames,
          }}
          anchor={contextMenu.anchor}
          onClose={closeContextMenu}
          onCheckout={pendingAction !== null || actionRunning || operationState?.operation != null || isCheckingOut || syncRunning || pendingPull !== null || autoPull.isRunning ? undefined : requestCheckout}
          onRepositoryAction={pendingAction || actionRunning || isCheckingOut || syncRunning || autoPull.isRunning || !operationState || operationState.operation ? undefined : requestRepositoryAction}
          buildCommitHref={buildMenuCommitHref}
          buildCompareHref={buildCompareHref}
          onNotice={setNotice}
        />
      )}
      {selectedRepository !== null && pendingAction !== null && (
        <RepositoryActionDialog key={selectedRepository + pendingAction.action.kind} repository={selectedRepository}
          seed={pendingAction} state={operationState} onBusy={setActionRunning}
          onCancel={() => setPendingAction(null)} onExecuted={completedRepositoryAction} />
      )}
      {pendingPull !== null && (
        <ConfirmActionDialog description={{
          title: `Pull existing branch ${pendingPull.branch}?`,
          summary: `Local branch ${pendingPull.branch} already exists in ${repositoryName} and is ${pendingPull.behind} commit(s) behind origin/${pendingPull.branch}. Switch to it and pull from origin?`,
          warnings: [pendingPull.ahead > 0 ? 'History has diverged. Fast-forward pull will be refused; resolve the divergence in your Git client.' : 'Requires a clean working tree. Updates are fast-forward only. If download or integration fails, the selected local branch remains checked out.'],
          confirmLabel: 'Switch and pull',
        }} isRunning={syncRunning} error={checkoutError}
          onConfirm={() => { void runBranchSync('pull', pendingPull.branch!) }}
          onCancel={() => { setPendingPull(null); setCheckoutError(null) }} />
      )}
      {pendingCheckout !== null && (
        <ConfirmActionDialog
          description={describeCheckout(pendingCheckout, {
            repositoryName,
            hasUncommittedChanges: pendingCheckoutDirty || (workingTree?.files.length ?? 0) > 0,
          })}
          isRunning={isCheckingOut}
          error={checkoutError}
          onConfirm={confirmCheckout}
          onCancel={cancelCheckout}
        />
      )}
    </div>
  )
}
