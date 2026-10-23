import { z } from 'zod/v4'

export const BranchSyncQuerySchema = z.object({ repo: z.string().default(''), originBranch: z.string().min(1).optional() })
export const BranchSyncSchema = z.object({
  revision: z.string().optional().describe('Fingerprint of local refs and HEAD for graph invalidation after external Git actions.'),
  branch: z.string().nullable(), upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(),
  canPull: z.boolean(), canPush: z.boolean(), reason: z.string(),
})
export const PushRequestSchema = z.object({ repo: z.string().default(''), expectedBranch: z.string().min(1) })
export const PushResultSchema = z.object({ success: z.boolean(), message: z.string() })
export type BranchSync = z.infer<typeof BranchSyncSchema>
