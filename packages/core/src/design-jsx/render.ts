import { transform } from 'sucrase'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { DESIGN_JSX_SUPPORTED_PROPERTIES } from '#core/design-jsx/schema'
import type { RenderOptions as RenderJSXOptions } from '#core/design-jsx/types'

import {
  backgroundBlur,
  BLUR_EFFECT_OPTIONS,
  dropShadow,
  foregroundBlur,
  innerShadow,
  layerBlur,
  SHADOW_EFFECT_OPTIONS,
  unknownEffectOptions,
  type BlurEffectOptions,
  type ShadowEffectOptions
} from './effects'
import * as React from './mini-react'
import {
  angularGradient,
  diamondGradient,
  gradient,
  linearGradient,
  radialGradient,
  solid
} from './paints'
import { renderTree, type RenderResult } from './renderer'
import { isTreeNode, resolveToTree, type TreeNode } from './tree'

/**
 * Build a component function from a JSX string using sucrase.
 * Works in both Node/Bun and the browser (no native bindings).
 */
const SUPPORTED_PROPS = DESIGN_JSX_SUPPORTED_PROPERTIES

function stripHTMLComments(jsxString: string): string {
  return jsxString.replace(/<!--[\s\S]*?-->/g, '')
}

function unsupportedPropWarnings(tree: TreeNode): string[] {
  const warnings: string[] = []
  collectUnsupportedPropWarnings(tree, warnings)
  return warnings
}

const SVG_ROOT_PROPS = new Set([...SUPPORTED_PROPS, 'viewBox', 'body'])

function collectUnsupportedPropWarnings(tree: TreeNode, warnings: string[]): void {
  const supportedProps = tree.type === 'svg' ? SVG_ROOT_PROPS : SUPPORTED_PROPS
  for (const key of Object.keys(tree.props)) {
    if (!supportedProps.has(key)) {
      warnings.push(`Unsupported prop "${key}" on <${tree.type}> is ignored.`)
    }
  }

  // SVG descendants are parsed as markup by renderSvgNode, not as Design JSX nodes.
  if (tree.type === 'svg') return

  for (const child of tree.children) {
    if (isTreeNode(child)) collectUnsupportedPropWarnings(child, warnings)
  }
}

/** Effect helpers that report options they ignore, so a misspelled option is not silent. */
function checkedEffectHelpers(warnings: string[]) {
  const check = (helper: string, options: unknown, known: readonly string[]) => {
    for (const key of unknownEffectOptions(options, known)) {
      const warning = `Unsupported option "${key}" in ${helper}() is ignored. Supported options: ${known.join(', ')}.`
      if (!warnings.includes(warning)) warnings.push(warning)
    }
  }
  const shadow = (helper: string, build: typeof dropShadow) => (options?: ShadowEffectOptions) => {
    check(helper, options, SHADOW_EFFECT_OPTIONS)
    return build(options)
  }
  const blur =
    (helper: string, build: typeof layerBlur) => (radiusOrOptions?: number | BlurEffectOptions) => {
      check(helper, radiusOrOptions, BLUR_EFFECT_OPTIONS)
      return build(radiusOrOptions)
    }
  return {
    dropShadow: shadow('dropShadow', dropShadow),
    innerShadow: shadow('innerShadow', innerShadow),
    layerBlur: blur('layerBlur', layerBlur),
    backgroundBlur: blur('backgroundBlur', backgroundBlur),
    foregroundBlur: blur('foregroundBlur', foregroundBlur)
  }
}

export function buildComponent(jsxString: string, warnings: string[] = []): React.ComponentType {
  const trimmed = stripHTMLComments(jsxString).trim()

  const aliases = `
    const __h = React.createElement
    const __frag = ''
    const Frame = 'frame', Text = 'text', Rectangle = 'rectangle', Ellipse = 'ellipse'
    const Line = 'line', Star = 'star', Polygon = 'polygon', Vector = 'vector'
    const Group = 'group', Section = 'section', View = 'frame', Rect = 'rectangle'
    const Component = 'component', ComponentSet = 'component-set', Instance = 'instance'
    const Icon = 'icon'
    const svg = 'svg'
    const dropShadow = __helpers.dropShadow
    const innerShadow = __helpers.innerShadow
    const layerBlur = __helpers.layerBlur
    const backgroundBlur = __helpers.backgroundBlur
    const foregroundBlur = __helpers.foregroundBlur
    const solid = __helpers.solid
    const gradient = __helpers.gradient
    const linearGradient = __helpers.linearGradient
    const radialGradient = __helpers.radialGradient
    const angularGradient = __helpers.angularGradient
    const diamondGradient = __helpers.diamondGradient
    const __varSymbol = Symbol.for('open-pencil.variable')
    const designVar = (def, value) => typeof def === 'string'
      ? ({ [__varSymbol]: true, id: def, name: def, value })
      : ({ [__varSymbol]: true, id: def.id, name: def.name ?? def.id ?? '', value: def.value })
    const defineVars = (vars) => Object.fromEntries(
      Object.entries(vars).map(([key, def]) => [key, designVar(def)])
    )
  `
  const opts = {
    transforms: ['typescript', 'jsx'] as Array<'typescript' | 'jsx'>,
    jsxPragma: '__h',
    jsxFragmentPragma: '__frag',
    production: true
  }

  let code: string
  try {
    code = transform(`${aliases}\nreturn function __render() { return ${trimmed} }`, opts).code
  } catch {
    code = transform(`${aliases}\nreturn function __render() { return <>${trimmed}</> }`, opts).code
  }

  // eslint-disable-next-line typescript-eslint/no-implied-eval -- sucrase output must be evaluated at runtime
  return new Function('React', '__helpers', code)(React, {
    ...checkedEffectHelpers(warnings),
    angularGradient,
    diamondGradient,
    gradient,
    linearGradient,
    radialGradient,
    solid
  }) as React.ComponentType
}

/**
 * Render a JSX string into the scene graph.
 * Works in both Node/Bun and the browser.
 */
export async function renderJSX(
  graph: SceneGraph,
  jsxString: string,
  options?: RenderJSXOptions
): Promise<RenderResult[]> {
  const helperWarnings: string[] = []
  const Component = buildComponent(jsxString, helperWarnings)
  const element = React.createElement(Component, null)
  const tree = resolveToTree(element)

  if (!tree) {
    throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  }

  const warnings = [...unsupportedPropWarnings(tree), ...helperWarnings]

  if (tree.type === '' && tree.children.length > 0) {
    const results: RenderResult[] = []
    for (const child of tree.children) {
      if (typeof child === 'string') continue
      results.push(await renderTree(graph, child, options))
    }
    if (results.length === 0) {
      throw new Error('JSX must return a Figma element (Frame, Text, etc)')
    }
    if (warnings.length > 0) results[0].warnings = warnings
    return results
  }

  const result = await renderTree(graph, tree, options)
  if (warnings.length > 0) result.warnings = warnings
  return [result]
}

export { renderTree as renderTreeNode }
