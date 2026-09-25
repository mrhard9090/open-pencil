import { expect, test } from 'bun:test'

import { exportFigFile, initCodec, SceneGraph } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { setInstanceOverride } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

// Figma resolves every override and derived-geometry path segment through the target
// record's override key: in gold-preview.fig all 10,341 override and 12,838 derived
// segments resolve that way and none resolve to a node GUID. A component authored here
// has no imported key, so the writer allocates one; addressing such a component's
// descendants by GUID made Figma silently drop their geometry claims.
test('a component authored here addresses its descendants by override key', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const panel = graph.createNode('COMPONENT', page.id, { name: 'Panel', width: 240, height: 120 })
  const row = graph.createNode('FRAME', panel.id, { name: 'row', width: 200, height: 32 })
  const instance = expectDefined(graph.createInstance(panel.id, page.id), 'instance')
  const instanceRow = expectDefined(graph.getChildren(instance.id)[0], 'instance row')
  graph.updateNode(instanceRow.id, { width: 180, height: 40 })
  setInstanceOverride(instance.instanceOverrides, instance.id, instanceRow.id, 'width', 180)
  setInstanceOverride(instance.instanceOverrides, instance.id, instanceRow.id, 'height', 40)

  const bytes = await exportFigFile(graph)
  const { nodeChanges } = parseFigBuffer(bytes.slice().buffer as ArrayBuffer)
  const rowRecord = expectDefined(
    nodeChanges.find((node) => node.type === 'FRAME' && node.name === 'row'),
    'row record'
  )
  const rowKey = guidToString(expectDefined(rowRecord.overrideKey, 'row override key'))
  expect(rowKey).not.toBe(guidToString(expectDefined(rowRecord.guid, 'row guid')))

  const exported = expectDefined(
    nodeChanges.find((node) => node.type === 'INSTANCE' && node.name === 'Panel'),
    'exported instance'
  )
  const claim = expectDefined(
    exported.symbolData?.symbolOverrides?.find((override) => override.size),
    'size claim'
  )
  expect((claim.guidPath?.guids ?? []).map(guidToString)).toEqual([rowKey])
  expect(claim.size).toEqual({ x: 180, y: 40 })

  const derived = expectDefined(
    exported.derivedSymbolData?.find(
      (entry) => (entry.guidPath?.guids ?? []).map(guidToString).join('/') === rowKey
    ),
    'derived geometry at the same address'
  )
  expect(derived.size).toEqual({ x: 180, y: 40 })

  // Every path the writer emits must name a record that carries that key.
  const keys = new Set(
    nodeChanges.flatMap((node) => (node.overrideKey ? [guidToString(node.overrideKey)] : []))
  )
  const segments = nodeChanges.flatMap((node) => [
    ...(node.symbolData?.symbolOverrides ?? []),
    ...(node.derivedSymbolData ?? [])
  ])
  expect(segments.length).toBeGreaterThan(0)
  for (const entry of segments)
    for (const segment of entry.guidPath?.guids ?? [])
      expect(keys.has(guidToString(segment))).toBe(true)

  expect(row.width).toBe(200)
})
