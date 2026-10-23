// Shared geometry for commit rows and the working-tree row.
export const ROW_HEIGHT = 28
export const GRAPH_LANE_GAP = 16
export const GRAPH_NODE_COLUMN_X = 16

/** Width of the graph gutter, including its horizontal margins. */
export function graphColumnWidth(laneCount: number): number {
  return GRAPH_NODE_COLUMN_X * 2 + Math.max(0, laneCount - 1) * GRAPH_LANE_GAP
}

/** Left inset shared by real commit subjects and the working-tree label. */
export function graphContentLeft(laneCount: number): number {
  return graphColumnWidth(laneCount) + 8
}
