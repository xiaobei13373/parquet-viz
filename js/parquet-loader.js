// Parquet 加载：文件/URL → AsyncBuffer → 元数据 → 按需读取列。
import {
  parquetMetadataAsync,
  parquetReadObjects,
  asyncBufferFromUrl,
} from '../vendor/hyparquet.esm.js'
import { columnToFlat } from './ndim.js'

/** 浏览器 File 对象 → hyparquet AsyncBuffer（按需分片读取，不必一次性载入内存） */
export function asyncBufferFromFile(file) {
  return {
    byteLength: file.size,
    slice: (start, end) => file.slice(start, end).arrayBuffer(),
  }
}

/** ArrayBuffer → AsyncBuffer */
export function asyncBufferFromBuffer(buf) {
  return {
    byteLength: buf.byteLength,
    slice: (start, end) => buf.slice(start, end ?? buf.byteLength),
  }
}

const NUMERIC_TYPES = new Set(['BOOLEAN', 'INT32', 'INT64', 'FLOAT', 'DOUBLE'])

function isNumericSchema(el) {
  if (NUMERIC_TYPES.has(el.type)) return true
  const ct = el.converted_type
  return typeof ct === 'string' && /^(U?INT_(8|16|32|64))$/.test(ct)
}

function displayType(el) {
  if (el.converted_type && el.converted_type !== 'UTF8') return `${el.type}·${el.converted_type}`
  if (el.logical_type?.type) return `${el.type}·${el.logical_type.type}`
  if (el.converted_type === 'UTF8') return 'STRING'
  return el.type ?? 'GROUP'
}

/**
 * 解析 thrift 扁平 schema 为顶层列描述。
 * 支持顶层标量列与 LIST 列（含嵌套 LIST）；struct 列标记为 other。
 */
export function parseColumns(flatSchema) {
  let i = 0
  function walk() {
    const el = flatSchema[i++]
    const node = { ...el, children: [] }
    const n = el.num_children ?? 0
    for (let k = 0; k < n; k++) node.children.push(walk())
    return node
  }
  const root = walk()

  const columns = []
  for (const child of root.children) {
    // 沿第一个子节点下钻到叶子，统计 LIST 包裹层数，识别 struct
    let node = child
    let listDepth = 0
    let isStruct = false
    // 兼容旧式 2-level LIST：叶子本身 REPEATED
    if (node.children.length === 0 && node.repetition_type === 'REPEATED') listDepth = 1
    while (node.children.length > 0) {
      const isListAnnot = node.converted_type === 'LIST' || node.logical_type?.type === 'LIST'
      if (isListAnnot) listDepth++
      if (!isListAnnot && node.repetition_type !== 'REPEATED' && node.children.length > 1) {
        isStruct = true
        break
      }
      node = node.children[0]
    }
    const isJson = node.converted_type === 'JSON' || node.logical_type?.type === 'JSON'
    const kind = isStruct ? 'other'
      : isJson ? 'list' // JSON 列常被 hyparquet 解析为数组，按多维候选处理
      : (listDepth > 0 ? (isNumericSchema(node) ? 'list' : 'other') : (isNumericSchema(node) ? 'numeric' : 'other'))
    columns.push({
      name: child.name,
      kind, // numeric | list | other
      listDepth: isJson && listDepth === 0 ? 1 : listDepth,
      type: displayType(node),
      rawType: node.type,
      convertedType: node.converted_type ?? null,
      logicalType: node.logical_type?.type ?? null,
    })
  }
  return columns
}

/** 从文件 kv 元数据中读取形状提示（键 shapes / demo-shapes / dims） */
export function readShapeHints(kvMetadata) {
  const hints = {}
  for (const { key, value } of kvMetadata ?? []) {
    if (!['shapes', 'demo-shapes', 'ndim-shapes', 'dims'].includes(key)) continue
    try {
      const obj = JSON.parse(value)
      for (const [col, shape] of Object.entries(obj)) {
        if (Array.isArray(shape) && shape.every(d => Number.isInteger(d) && d > 0)) hints[col] = shape
      }
    } catch { /* 忽略非法提示 */ }
  }
  return hints
}

/** 打开 parquet：只读 footer 元数据，快速返回 schema 概览 */
export async function openParquet(asyncBuffer, name) {
  const metadata = await parquetMetadataAsync(asyncBuffer)
  const numRows = Number(metadata.num_rows)
  if (!Number.isFinite(numRows) || numRows <= 0) throw new Error('文件没有数据行')
  const columns = parseColumns(metadata.schema)
  if (columns.length === 0) throw new Error('文件中没有可识别的列')
  const shapeHints = readShapeHints(metadata.key_value_metadata)
  return {
    name,
    asyncBuffer,
    metadata,
    numRows,
    rowGroups: metadata.row_groups.length,
    columns,
    shapeHints,
  }
}

/** 通过 URL 打开（需要目标服务器允许 CORS） */
export async function openParquetUrl(url) {
  const asyncBuffer = await asyncBufferFromUrl({ url })
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'remote.parquet')
  return openParquet(asyncBuffer, name)
}

/** 读取整列并扁平化。col 为 parseColumns 返回的列描述。 */
export async function loadColumn(pq, col, onProgress) {
  const rows = await parquetReadObjects({
    file: pq.asyncBuffer,
    metadata: pq.metadata,
    columns: [col.name],
    onProgress,
  })
  const values = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) values[i] = rows[i][col.name]
  const result = columnToFlat(values)
  result.columnType = col.type
  result.isTimestamp = /TIMESTAMP|DATE/.test(col.convertedType ?? '') || /TIMESTAMP|DATE/.test(col.logicalType ?? '')
  return result
}