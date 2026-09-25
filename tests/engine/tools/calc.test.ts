import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

function calculate(expr: string) {
  const { figma } = setupToolTest()
  return getTool('calc').execute(figma, { expr })
}

describe('calc', () => {
  test.each([
    ['844 - 56 - 96 - 82', 610],
    ['(952 - 16) / 2', 468],
    ['floor(390 * 0.6)', 234],
    ['min(5, 2) + max(3, 7)', 9],
    ['ceil(1.2) + round(2.8) + abs(-4)', 9],
    ['sqrt(16) + pow(2, 3)', 12],
    ['2 ^ 3 + 10 % 3', 9]
  ])('evaluates %s', (expr, result) => {
    expect(calculate(expr)).toEqual({ expr, result })
  })

  test('returns independent results for a batch', () => {
    expect(calculate('["1440 * 8 / 12", "1 / 0", "sqrt(9)"]')).toEqual({
      results: [
        { expr: '1440 * 8 / 12', result: 960 },
        { expr: '1 / 0', error: 'Produced Infinity' },
        { expr: 'sqrt(9)', result: 3 }
      ]
    })
  })

  test.each(['1 +', 'sqrt(-1)', 'missing', 'min.constructor', 'min.__proto__'])(
    'rejects invalid or unsafe expressions: %s',
    (expr) => {
      expect(calculate(expr)).toEqual({ expr, error: expect.any(String) })
    }
  )
})
