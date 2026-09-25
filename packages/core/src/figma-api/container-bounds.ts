import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeAbsoluteBounds } from '@open-pencil/scene-graph/geometry'
import type { Rect } from '@open-pencil/scene-graph/primitives'

/**
 * Box, in `parentId`'s coordinates, that holds `nodeIds` — where a group or boolean
 * operation made from them sits, as when the editor wraps a selection.
 */
export function containerRectInParent(
  graph: SceneGraph,
  nodeIds: readonly string[],
  parentId: string
): Rect {
  const nodes = nodeIds.map((id) => {
    const node = graph.getNode(id)
    if (!node) throw new Error(`Node ${id} not found`)
    return node
  })
  const bounds = computeAbsoluteBounds(nodes, (id) => graph.getAbsolutePosition(id))
  const parent = graph.getNode(parentId)
  const origin =
    !parent || parentId === graph.rootId || parent.type === 'CANVAS'
      ? { x: 0, y: 0 }
      : graph.getAbsolutePosition(parentId)
  return {
    x: bounds.x - origin.x,
    y: bounds.y - origin.y,
    width: bounds.width,
    height: bounds.height
  }
}
