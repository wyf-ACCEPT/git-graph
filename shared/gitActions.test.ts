import { describe, expect, test } from 'bun:test'
import type { GitCommit } from './git.schema'
import {
  buildGitMenuSections,
  checkoutTargetForEntry,
  describeCheckout,
  findHeadState,
  type GitMenuSection,
  type HeadState,
} from './gitActions'
import { groupRefDecorations } from './refGroup'

// The menu descriptor is the one place that decides which entries a row or a
// pill offers and why one cannot apply. Pinned here: no entry is ever *missing*
// (ADR-0025 — an entry that cannot apply is present with a reason), and the
// reasons follow the repository state rather than the menu's own guesses.

const FULL_HASH = 'abc1234'.padEnd(40, '0')

const commit = (overrides: Partial<GitCommit> = {}): GitCommit => ({
  hash: 'abc1234',
  fullHash: FULL_HASH,
  parents: [],
  refs: [],
  author: 'Ada',
  date: '2026-09-22',
  subject: 'a commit',
  ...overrides,
})

const entriesOf = (sections: GitMenuSection[]) =>
  sections.flatMap((section) => section.entries.map((entry) => [section.heading, entry.action, entry.unavailableReason]))

const onMain: HeadState = { hash: 'fff0000', branch: 'main' }

describe('findHeadState', () => {
  test('HEAD on a branch names the branch and its commit', () => {
    const commits = [commit({ hash: 'aaa', refs: ['origin/main'] }), commit({ hash: 'bbb', refs: ['HEAD -> topic'] })]
    expect(findHeadState(commits, ['origin'])).toEqual({ hash: 'bbb', branch: 'topic' })
  })

  test('a detached HEAD names the commit and no branch', () => {
    expect(findHeadState([commit({ hash: 'aaa', refs: ['HEAD', 'main'] })], [])).toEqual({ hash: 'aaa', branch: null })
  })

  test('HEAD outside the loaded window is unknown, not guessed', () => {
    expect(findHeadState([commit({ refs: ['main'] })], [])).toEqual({ hash: null, branch: null })
  })
})

describe('buildGitMenuSections', () => {
  test('a row lists the commit first, then every ref on it — so branch and tag checkout are keyboard-reachable', () => {
    const target = commit({ refs: ['feature', 'tag: v1.0'] })
    const sections = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: onMain,
      defaultBranch: 'main',
    })
    expect(entriesOf(sections)).toEqual([
      ['commit abc1234', 'create-branch', null],
      ['commit abc1234', 'create-tag', null],
      ['commit abc1234', 'checkout-commit', null],
      ['commit abc1234', 'open-commit', null],
      ['commit abc1234', 'cherry-pick', null],
      ['commit abc1234', 'copy-commit-hash', null],
      ['branch feature', 'checkout-branch', null],
      ['branch feature', 'compare-branch', null],
      ['branch feature', 'rename-branch', null],
      ['branch feature', 'delete-branch', null],
      ['branch feature', 'merge-branch', null],
      ['tag v1.0', 'checkout-tag', null],
      ['tag v1.0', 'delete-tag', null],
      ['tag v1.0', 'push-tag', null],
      ['tag v1.0', 'delete-remote-tag', null],
    ])
  })

  test('a pill leads with its own ref, then the commit', () => {
    const target = commit({ refs: ['feature', 'tag: v1.0'] })
    const refGroups = groupRefDecorations(target.refs, [])
    const sections = buildGitMenuSections({
      commit: target,
      refGroups,
      focusedGroup: refGroups[1]!,
      head: onMain,
      defaultBranch: 'main',
    })
    expect(sections.map((section) => section.heading)).toEqual(['tag v1.0', 'commit abc1234'])
  })

  test('the checked-out branch keeps "Checkout branch", disabled with the reason', () => {
    const target = commit({ refs: ['HEAD -> main', 'origin/main'] })
    const refGroups = groupRefDecorations(target.refs, ['origin'])
    const [branchSection] = buildGitMenuSections({
      commit: target,
      refGroups,
      focusedGroup: refGroups[0]!,
      head: { hash: 'abc1234', branch: 'main' },
      defaultBranch: 'main',
    })
    expect(branchSection!.entries.map((entry) => [entry.action, entry.unavailableReason])).toEqual([
      ['checkout-branch', 'main is already checked out'],
      ['compare-branch', 'main is the default branch — comparing it against itself shows nothing'],
      ['rename-branch', null],
      ['delete-branch', 'Check out another branch before deleting this branch.'],
      ['merge-branch', 'This is already the current branch.'],
      ['delete-remote-branch', null],
    ])
  })

  test('a remote-only origin ref offers tracking checkout when the local listing is known', () => {
    const target = commit({ refs: ['origin/published'] })
    const refGroups = groupRefDecorations(target.refs, ['origin'])
    const [remoteSection] = buildGitMenuSections({
      commit: target,
      refGroups,
      focusedGroup: refGroups[0]!,
      head: onMain,
      defaultBranch: 'main',
      localBranchNames: ['main'],
    })
    expect(remoteSection!.heading).toBe('remote branch origin/published')
    expect(remoteSection!.entries.map((entry) => entry.action)).toEqual(['checkout-remote-branch', 'compare-branch', 'merge-branch', 'delete-remote-branch'])
    expect(remoteSection!.entries[0]!.unavailableReason).toBeNull()
    expect(remoteSection!.entries[1]!.unavailableReason).toContain('origin/published has no local branch')
    expect(checkoutTargetForEntry(remoteSection!.entries[0]!, target)).toEqual({ kind: 'remote-branch', remote: 'origin', name: 'published' })
  })

  test('with HEAD already detached here, the detaching checkouts say so instead of vanishing', () => {
    const target = commit({ refs: ['HEAD', 'tag: v1.0'] })
    const sections = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: { hash: 'abc1234', branch: null },
      defaultBranch: 'main',
    })
    // The detached HEAD's own pill contributes no section of its own.
    expect(sections.map((section) => section.heading)).toEqual(['commit abc1234', 'tag v1.0'])
    const reasons = entriesOf(sections).filter(([, action]) => action === 'checkout-commit' || action === 'checkout-tag')
    expect(reasons.map(([, , reason]) => reason)).toEqual([
      'HEAD is already detached at abc1234',
      'HEAD is already detached at abc1234',
    ])
  })

  test('HEAD on a branch at this commit still allows detaching here', () => {
    const target = commit({ refs: ['HEAD -> main'] })
    const [commitEntries] = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: { hash: 'abc1234', branch: 'main' },
      defaultBranch: 'main',
    })
    expect(commitEntries!.entries.find(entry => entry.action === 'checkout-commit')).toMatchObject({ action: 'checkout-commit', unavailableReason: null })
  })

  test('an unknown default branch and a missing full hash disable their entries with a reason', () => {
    const target = commit({ fullHash: '', refs: ['feature'] })
    const sections = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: onMain,
      defaultBranch: null,
    })
    const reasonFor = (action: string) => entriesOf(sections).find(([, candidate]) => candidate === action)![2]
    expect(reasonFor('copy-commit-hash')).toContain('full hash')
    expect(reasonFor('compare-branch')).toBe('no default branch is known for this repository')
  })

  test('all write actions are marked as mutating and read-only actions are not', () => {
    const target = commit({ refs: ['feature', 'tag: v1'] })
    const sections = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: onMain,
      defaultBranch: 'main',
    })
    const mutating = sections.flatMap((section) => section.entries.filter((entry) => entry.mutates))
    expect(mutating.map((entry) => entry.action)).toEqual(['create-branch', 'create-tag', 'checkout-commit', 'cherry-pick', 'checkout-branch', 'rename-branch', 'delete-branch', 'merge-branch', 'checkout-tag', 'delete-tag', 'push-tag', 'delete-remote-tag'])
  })
})

test('tracking checkout confirmation names the local branch, origin ref, and tracking relationship', () => {
  const description = describeCheckout({ kind: 'remote-branch', remote: 'origin', name: 'release/topic' }, {
    repositoryName: 'example', hasUncommittedChanges: true,
  })
  expect(description.title).toBe('Create and check out branch release/topic?')
  expect(description.summary).toContain('origin/release/topic')
  expect(description.summary).toContain('track')
  expect(description.confirmLabel).toBe('Create and check out')
  expect(description.warnings.join(' ')).toContain('uncommitted changes')
  expect(description.warnings.join(' ')).not.toContain('detaches HEAD')
})

describe('checkoutTargetForEntry', () => {
  test('maps each checkout entry to its request, naming a commit by its full hash', () => {
    const target = commit({ refs: ['feature', 'tag: v1'] })
    const sections = buildGitMenuSections({
      commit: target,
      refGroups: groupRefDecorations(target.refs, []),
      focusedGroup: null,
      head: onMain,
      defaultBranch: 'main',
    })
    const targets = sections
      .flatMap((section) => section.entries)
      .map((entry) => checkoutTargetForEntry(entry, target))
      .filter((checkoutTarget) => checkoutTarget !== null)
    expect(targets).toEqual([
      { kind: 'commit', hash: FULL_HASH },
      { kind: 'branch', name: 'feature' },
      { kind: 'tag', name: 'v1' },
    ])
  })

  test('falls back to the abbreviated hash when the full one was not loaded', () => {
    const entry = { action: 'checkout-commit', label: '', subject: 'abc1234', unavailableReason: null, mutates: true } as const
    expect(checkoutTargetForEntry(entry, commit({ fullHash: '' }))).toEqual({ kind: 'commit', hash: 'abc1234' })
  })
})

describe('describeCheckout', () => {
  test('a branch checkout names the command and the repository, with no detach warning', () => {
    const description = describeCheckout({ kind: 'branch', name: 'feature' }, {
      repositoryName: 'git-graph',
      hasUncommittedChanges: false,
    })
    expect(description.summary).toContain('git switch feature')
    expect(description.summary).toContain('git-graph')
    expect(description.warnings).toEqual([])
  })

  test('a commit or tag checkout always carries the detached-HEAD warning', () => {
    for (const target of [
      { kind: 'commit', hash: FULL_HASH },
      { kind: 'tag', name: 'v1' },
    ] as const) {
      const description = describeCheckout(target, { repositoryName: 'git-graph', hasUncommittedChanges: false })
      expect(description.summary).toContain('git switch --detach')
      expect(description.warnings.join(' ')).toContain('detaches HEAD')
    }
  })

  test('uncommitted changes add git’s rule about them', () => {
    const description = describeCheckout({ kind: 'branch', name: 'feature' }, {
      repositoryName: 'git-graph',
      hasUncommittedChanges: true,
    })
    expect(description.warnings).toHaveLength(1)
    expect(description.warnings[0]).toContain('uncommitted changes')
  })
})
