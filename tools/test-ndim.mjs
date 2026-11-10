// ndim.js 单元测试：node tools/test-ndim.mjs
import assert from 'node:assert'
import {
  columnToFlat, inferShape, stridesFor, validShape, parseShapeInput,
  extractSlice, sampleAxisExtent, arrayStats, decimateIndices, toNum,
} from '../js/ndim.js'

// toNum
assert.equal(toNum(null), NaN)
assert.equal(toNum(3n), 3)
assert.equal(toNum(true), 1)
assert.equal(toNum(new Date(1000)), 1000)

// inferShape
assert.deepEqual(inferShape([[1, 2, 3], [4, 5, 6]]), [2, 3])
assert.deepEqual(inferShape([[[1], [2]], [[3], [4]]]), [2, 2, 1])

// columnToFlat 标量
{
  const { flat, shape, kind } = columnToFlat([1, 2, null, 4])
  assert.equal(kind, 'scalar')
  assert.deepEqual(shape, [4])
  assert.ok(Number.isNaN(flat[2]))
  assert.equal(flat[3], 4)
}

// columnToFlat LIST
{
  const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
  const { flat, shape, kind } = columnToFlat(rows)
  assert.equal(kind, 'list')
  assert.deepEqual(shape, [3, 3])
  assert.deepEqual(Array.from(flat), [1, 2, 3, 4, 5, 6, 7, 8, 9])
}

// columnToFlat 嵌套 LIST
{
  const rows = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]
  const { flat, shape } = columnToFlat(rows)
  assert.deepEqual(shape, [2, 2, 2])
  assert.deepEqual(Array.from(flat), [1, 2, 3, 4, 5, 6, 7, 8])
}

// columnToFlat ragged
{
  const { shape, kind } = columnToFlat([[1, 2], [3]])
  assert.equal(kind, 'list-ragged')
  assert.deepEqual(shape, [4]) // 退化为总元素数（含 NaN 占位）
}

// strides / slice
{
  const shape = [2, 3, 4]
  assert.deepEqual(stridesFor(shape), [12, 4, 1])
  const flat = Float64Array.from({ length: 24 }, (_, i) => i)
  // X=2 (最后一维), 固定 [1, 2, :] → 起始 1*12+2*4=20 → [20,21,22,23]
  assert.deepEqual(Array.from(extractSlice(flat, shape, 2, [1, 2, -1])), [20, 21, 22, 23])
  // X=0, 固定 [:, 1, 2] → base=1*4+2=6, step=12 → [6, 18]
  assert.deepEqual(Array.from(extractSlice(flat, shape, 0, [-1, 1, 2])), [6, 18])
  // X=1, 固定 [1, :, 0] → base=12, step=4 → [12,16,20]
  assert.deepEqual(Array.from(extractSlice(flat, shape, 1, [1, -1, 0])), [12, 16, 20])
}

// validShape / parseShapeInput
assert.ok(validShape([10, 24, 10], 2400))
assert.ok(!validShape([10, 24], 2400))
assert.ok(!validShape([0, 2400], 2400))
assert.deepEqual(parseShapeInput('10, 24, 10'), [10, 24, 10])
assert.deepEqual(parseShapeInput('[10,24,10]'), [10, 24, 10])
assert.deepEqual(parseShapeInput('10x24x10'), [10, 24, 10])
assert.deepEqual(parseShapeInput('10 24 10'), [10, 24, 10])
assert.equal(parseShapeInput('abc'), null)

// sampleAxisExtent
assert.deepEqual(sampleAxisExtent(5, 24), [0, 1, 2, 3, 4])
assert.deepEqual(sampleAxisExtent(100, 3), [0, 50, 99])

// arrayStats
{
  const s = arrayStats(Float64Array.from([1, 2, 3, NaN, 5]))
  assert.equal(s.count, 4)
  assert.equal(s.min, 1)
  assert.equal(s.max, 5)
  assert.equal(s.mean, 2.75)
}

// decimateIndices
{
  const y = Float64Array.from({ length: 100000 }, (_, i) => Math.sin(i / 1000))
  const idx = decimateIndices(y, 6000)
  assert.ok(idx.length <= 6100)
  assert.ok(idx.length >= 3000)
  assert.equal(idx[0], 0)
  assert.equal(idx[idx.length - 1], 99999)
  // 严格递增
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1])
  // 小数据不降采样
  assert.equal(decimateIndices(Float64Array.from([1, 2, 3]), 6000), null)
}

console.log('ndim tests: all passed ✓')