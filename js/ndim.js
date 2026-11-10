// N 维数组工具：列数据扁平化、形状推断、重塑、按轴切片、统计与降采样。
// 全部为纯函数，可在 Node 中单测。

/** 任意 parquet 标量值 → number（null → NaN，BigInt/Date/boolean 兼容） */
export function toNum(v) {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  return NaN
}

/** 推断嵌套数组的形状，如 [[1,2],[3,4]] → [2,2] */
export function inferShape(arr) {
  const shape = []
  let cur = arr
  while (Array.isArray(cur)) {
    shape.push(cur.length)
    cur = cur.find(x => x != null)
  }
  return shape
}

/** 按期望形状 shape 将嵌套数组写入 out（不足留 NaN，超出截断） */
function writeNested(arr, out, offset, shape) {
  if (shape.length === 0) {
    out[offset] = toNum(arr)
    return
  }
  const [len, ...rest] = shape
  const per = rest.reduce((a, b) => a * b, 1)
  const n = Array.isArray(arr) ? Math.min(arr.length, len) : 0
  for (let i = 0; i < n; i++) {
    const v = arr[i]
    const pos = offset + i * per
    if (rest.length === 0) out[pos] = toNum(v)
    else if (Array.isArray(v)) writeNested(v, out, pos, rest)
  }
}

/**
 * 将一列的原始行值转换为扁平 Float64Array 与推断形状。
 * - 标量列 → shape [行数]
 * - 定长 LIST 列 → shape [行数, ...每行形状]
 * - 变长（ragged）LIST → 退化为 shape [总元素数]
 */
export function columnToFlat(values) {
  const n = values.length
  if (n === 0) return { flat: new Float64Array(0), shape: [0], kind: 'empty' }
  const first = values.find(v => v != null)
  if (first === undefined) return { flat: new Float64Array(n).fill(NaN), shape: [n], kind: 'scalar' }

  if (Array.isArray(first)) {
    const rowShape = inferShape(first)
    const perRow = rowShape.reduce((a, b) => a * b, 1)
    if (perRow === 0) return { flat: new Float64Array(0), shape: [0], kind: 'empty' }
    const flat = new Float64Array(n * perRow).fill(NaN)
    let ragged = false
    for (let i = 0; i < n; i++) {
      const v = values[i]
      if (v == null) continue // 保持 NaN
      const s = inferShape(v)
      if (s.length !== rowShape.length || s.some((x, k) => x !== rowShape[k])) ragged = true
      writeNested(v, flat, i * perRow, rowShape)
    }
    if (ragged) return { flat, shape: [flat.length], kind: 'list-ragged' }
    return { flat, shape: [n, ...rowShape], kind: 'list' }
  }

  const flat = new Float64Array(n)
  for (let i = 0; i < n; i++) flat[i] = toNum(values[i])
  return { flat, shape: [n], kind: 'scalar' }
}

/** 行优先（C order）步长 */
export function stridesFor(shape) {
  const strides = new Array(shape.length)
  let acc = 1
  for (let d = shape.length - 1; d >= 0; d--) {
    strides[d] = acc
    acc *= shape[d]
  }
  return strides
}

export function shapeProduct(shape) {
  return shape.reduce((a, b) => a * b, 1)
}

/** 校验重塑形状：正整数且乘积等于元素总数 */
export function validShape(shape, total) {
  return Array.isArray(shape) && shape.length > 0 &&
    shape.every(d => Number.isInteger(d) && d > 0) &&
    shapeProduct(shape) === total
}

/** 解析 "10,24,10" / "10 24 10" / "[10,24,10]" 形式的形状输入 */
export function parseShapeInput(text) {
  const cleaned = String(text).trim().replace(/[\[\]()]/g, '')
  if (!cleaned) return null
  const parts = cleaned.split(/[,，\s*xX×]+/).filter(Boolean)
  const dims = parts.map(Number)
  if (dims.some(d => !Number.isInteger(d) || d <= 0)) return null
  return dims
}

/**
 * 沿 xAxis 抽取一条曲线。
 * fixed[d] 为各维固定索引；xAxis 对应位置忽略（传 -1 即可）。
 */
export function extractSlice(flat, shape, xAxis, fixed) {
  const strides = stridesFor(shape)
  const n = shape[xAxis]
  let base = 0
  for (let d = 0; d < shape.length; d++) {
    if (d !== xAxis && fixed[d] >= 0) base += fixed[d] * strides[d]
  }
  const out = new Float64Array(n)
  const step = strides[xAxis]
  for (let i = 0, o = base; i < n; i++, o += step) out[i] = flat[o]
  return out
}

/** 在 seriesAxis 上均匀取样最多 maxSeries 个索引 */
export function sampleAxisExtent(extent, maxSeries) {
  if (extent <= maxSeries) return Array.from({ length: extent }, (_, i) => i)
  const out = []
  for (let k = 0; k < maxSeries; k++) out.push(Math.round(k * (extent - 1) / (maxSeries - 1)))
  return [...new Set(out)]
}

/** 有限值的统计（忽略 NaN） */
export function arrayStats(arr) {
  let count = 0, min = Infinity, max = -Infinity, sum = 0, sumSq = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (!Number.isFinite(v)) continue
    count++
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sumSq += v * v
  }
  if (count === 0) return { count: 0, min: NaN, max: NaN, mean: NaN, std: NaN }
  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return { count, min, max, mean, std: Math.sqrt(variance) }
}

/**
 * Log dimensionless jerk（峰值速度归一化），越大越平滑。
 * LDLj = -ln(T³ / vPeak² * ∫ jerk² dt)。位置输入先做一阶前向差分。
 * 使用等间隔有限差分和矩形积分，与 siva82kb/smoothness 的速度实现一致：
 * T = v.length * dt，因此 dt 在无量纲化后消去，DJ = m³ * Σ(Δ²(v/vPeak))²。
 * 不跨越缺失点，不重采样；X 为空时默认等间隔。
 */
export function logDimensionlessJerk(y, x = null, inputType = 'position') {
  const unavailable = reason => ({ value: NaN, reason })
  if (!['position', 'velocity'].includes(inputType)) return unavailable('未知的信号类型')
  const minPoints = inputType === 'position' ? 4 : 3
  if (y.length < minPoints) return unavailable(`至少需要 ${minPoints} 个点`)
  if (x && x.length !== y.length) return unavailable('X 与 Y 点数不一致')
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || (x && !Number.isFinite(x[i]))) {
      return unavailable('数据含缺失值或非有限值')
    }
  }
  if (x) {
    const dt = (x[x.length - 1] - x[0]) / (x.length - 1)
    if (!(dt > 0) || !Number.isFinite(dt)) return unavailable('X 轴必须严格递增')
    for (let i = 1; i < x.length; i++) {
      const step = x[i] - x[i - 1]
      // 相对容差加浮点数精度容差，兼容时间戳和小数采样时间。
      const tolerance = Math.max(dt * 1e-4, Number.EPSILON * Math.max(Math.abs(x[i]), Math.abs(x[i - 1])) * 4)
      if (!(step > 0)) return unavailable('X 轴必须严格递增')
      if (Math.abs(step - dt) > tolerance) return unavailable('X 轴需等间隔采样')
    }
  }
  const m = y.length - (inputType === 'position' ? 1 : 0)
  const velocityAt = i => inputType === 'position' ? y[i + 1] - y[i] : y[i]
  let peak = 0
  for (let i = 0; i < m; i++) peak = Math.max(peak, Math.abs(velocityAt(i)))
  if (!Number.isFinite(peak)) return unavailable('数值超出计算范围')
  if (peak === 0) return unavailable('峰值速度为 0，LDLj 未定义')
  let scale = 0, sumSquares = 0
  for (let i = 2; i < m; i++) {
    const diff = Math.abs((velocityAt(i) / peak - velocityAt(i - 1) / peak) -
      (velocityAt(i - 1) / peak - velocityAt(i - 2) / peak))
    if (diff > scale) {
      sumSquares = 1 + sumSquares * (scale / diff) ** 2
      scale = diff
    } else if (diff > 0) sumSquares += (diff / scale) ** 2
  }
  // 在对数域组合，避免 m³ 和极小 jerk 的平方溢出/下溢；不加任意 epsilon。
  if (scale === 0) return { value: Infinity, reason: '离散 jerk 为 0（+∞）' }
  return { value: -(3 * Math.log(m) + 2 * Math.log(scale) + Math.log(sumSquares)), reason: '' }
}

/**
 * min-max 降采样：返回保留的下标数组（保尖峰）。
 * 数据量不超过 maxPoints 时返回 null 表示全部保留。
 */
export function decimateIndices(y, maxPoints) {
  const n = y.length
  if (n <= maxPoints) return null
  const bucket = Math.ceil(n / Math.floor(maxPoints / 2))
  const keep = [0]
  for (let s = 0; s < n; s += bucket) {
    const e = Math.min(n, s + bucket)
    let iMin = -1, iMax = -1, vMin = Infinity, vMax = -Infinity
    for (let i = s; i < e; i++) {
      const v = y[i]
      if (!Number.isFinite(v)) continue
      if (v < vMin) { vMin = v; iMin = i }
      if (v > vMax) { vMax = v; iMax = i }
    }
    if (iMin === -1) { keep.push(s); continue }
    if (iMin === iMax) keep.push(iMin)
    else if (iMin < iMax) { keep.push(iMin, iMax) }
    else { keep.push(iMax, iMin) }
  }
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1)
  // 去掉相邻重复（首桶极值可能就是 0，末桶极值可能就是 n-1）
  return keep.filter((v, i) => i === 0 || v > keep[i - 1])
}

/** 按下标数组从源数组取值（源可为 null → 返回下标本身作为 x） */
export function gather(src, indices) {
  if (src == null) return indices
  const out = new Array(indices.length)
  for (let i = 0; i < indices.length; i++) out[i] = src[indices[i]]
  return out
}
