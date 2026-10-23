import { z } from 'zod/v4'

export const AUTO_PULL_INTERVAL_MS = 5 * 60 * 1000

export const PullRequestSchema = z.object({
  repo: z.string().default(''),
  expectedBranch: z.string().min(1).optional(),
  originBranch: z.string().min(1).optional().describe('Confirm switching to this existing local branch and pulling its same-named origin ref.'),
  manual: z.boolean().default(false).describe('Explicit Pull now bypasses the automatic interval deduplication.'),
})

export const FetchRequestSchema = PullRequestSchema.pick({ repo: true, manual: true })

export const PullResultSchema = z.object({
  state: z.enum(['updated', 'up-to-date', 'skipped', 'error']),
  code: z.string(),
  message: z.string(),
  branch: z.string().nullable(),
  fetched: z.boolean(),
  checkedAt: z.string(),
})
export type PullResult = z.infer<typeof PullResultSchema>
