// parquet-viz 主控制器
import { asyncBufferFromFile, asyncBufferFromBuffer, openParquet, openParquetUrl, loadColumn } from './parquet-loader.js'
import { extractSlice, sampleAxisExtent, arrayStats, logDimensionlessJerk, validShape, parseShapeInput, shapeProduct } from './ndim.js'
import { renderChart, exportPng, exportCsv } from './plot.js?v=joint-names-1'
import { readJointNames, jointNamesForShape } from './joint-names.js'

const $ = id => document.getElementById(id)
const MAX_SERIES = 24
const MAX_NAMED_SERIES = 64

const state = {
  pq: null,
  cache: new Map(),
  mode: 'field',
  checked: new Set(),
  xColumn: '',
  nd: { column: '', shape: [], xAxis: 0, fixed: [], seriesAxis: -1 },
  uirev: 0,
  watch: { handle: null, timer: null, lastModified: 0, size: 0 },
  lastSeries: [],
  lastXLabel: 'x',
  smoothnessInput: 'position',
  jointNames: new Map(),
  renderSeq: 0,
}

// ---------- 通用 UI ----------
let toastTimer = null
function toast(msg, isError = false) {
  const el = $('toast')
  el.textContent = msg
  el.className = 'show' + (isError ? ' error' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.className = '' }, isError ? 6000 : 3000)
}

function setLoading(on, text = '加载中…') {
  $('loading').style.display = on ? 'flex' : 'none'
  $('loading-text').textContent = text
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

function fmtNum(v) {
  if (!Number.isFinite(v)) return '–'
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(4)
  return String(Number(v.toPrecision(7)))
}

// ---------- 文件打开 ----------
async function openSource(asyncBuffer, name, preserve = false) {
  const prev = preserve && state.pq ? {
    mode: state.mode,
    checked: [...state.checked],
    xColumn: state.xColumn,
    ndColumn: state.nd.column,
    ndShape: [...state.nd.shape],
    ndXAxis: state.nd.xAxis,
  } : null

  setLoading(true, `解析 ${name} …`)
  try {
    const pq = await openParquet(asyncBuffer, name)
    state.pq = pq
    state.cache.clear()
    state.uirev++

    $('fi-name').textContent = pq.name
    $('fi-name').title = pq.name
    $('fi-size').textContent = fmtSize(asyncBuffer.byteLength)
    $('fi-rows').textContent = pq.numRows.toLocaleString()
    $('fi-groups').textContent = String(pq.rowGroups)
    $('file-info').classList.remove('hidden')
    $('empty-hint').classList.add('hidden')

    buildColumnList()
    populateXSelect()
    populateNdSelect()

    const numeric = pq.columns.filter(c => c.kind === 'numeric')
    if (prev) {
      const names = new Set(pq.columns.map(c => c.name))
      state.mode = prev.mode
      state.checked = new Set(prev.checked.filter(n => names.has(n)))
      state.xColumn = names.has(prev.xColumn) ? prev.xColumn : ''
      if (prev.ndColumn && names.has(prev.ndColumn)) {
        await selectNdColumn(prev.ndColumn, { shape: prev.ndShape, xAxis: prev.ndXAxis })
      }
    } else {
      state.mode = 'field'
      state.checked = new Set(numeric.slice(0, 2).map(c => c.name))
      state.xColumn = ''
      state.nd = { column: '', shape: [], xAxis: 0, fixed: [], seriesAxis: -1 }
    }
    setMode(state.mode)
    syncColumnChecks()
    $('x-select').value = state.xColumn
    await renderNow()
  } catch (err) {
    console.error(err)
    toast(`打开失败：${err.message}`, true)
  } finally {
    setLoading(false)
  }
}

async function openFile(file) {
  stopWatch(false)
  await openSource(asyncBufferFromFile(file), file.name)
}

async function openDemo() {
  stopWatch(false)
  setLoading(true, '下载示例数据…')
  try {
    const res = await fetch('sample/demo.parquet')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    await openSource(asyncBufferFromBuffer(buf), 'demo.parquet')
  } catch (err) {
    setLoading(false)
    toast(`示例加载失败：${err.message}`, true)
  }
}

async function openUrl(url) {
  if (!url) return
  stopWatch(false)
  setLoading(true, '连接远程文件…')
  try {
    const pq = await openParquetUrl(url)
    await openSource(pq.asyncBuffer, pq.name)
  } catch (err) {
    setLoading(false)
    toast(`URL 加载失败（可能是 CORS 限制）：${err.message}`, true)
  }
}

// ---------- 字段列表 ----------
function buildColumnList() {
  const ul = $('column-list')
  ul.innerHTML = ''
  for (const col of state.pq.columns) {
    const li = document.createElement('li')
    li.dataset.name = col.name
    li.className = 'col-item' + (col.kind === 'other' ? ' disabled' : '')

    if (col.kind === 'numeric') {
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.addEventListener('change', () => {
        if (cb.checked) state.checked.add(col.name)
        else state.checked.delete(col.name)
        scheduleRender()
      })
      li.appendChild(cb)
    } else {
      const dot = document.createElement('span')
      dot.className = 'kind-dot ' + col.kind
      li.appendChild(dot)
    }

    const name = document.createElement('span')
    name.className = 'col-name'
    name.textContent = col.name
    name.title = col.kind === 'list' ? 'LIST 列：点击进入多维切片模式' : col.name
    li.appendChild(name)

    const badge = document.createElement('span')
    badge.className = 'type-badge ' + col.kind
    badge.textContent = col.kind === 'list' ? `LIST×${col.listDepth} · ${col.type}` : col.type
    li.appendChild(badge)

    li.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT' || col.kind === 'other') return
      if (state.mode === 'ndim' || col.kind === 'list') {
        if (col.kind === 'other') return
        setMode('ndim')
        selectNdColumn(col.name)
      } else {
        const cb = li.querySelector('input')
        cb.checked = !cb.checked
        cb.dispatchEvent(new Event('change'))
      }
    })
    ul.appendChild(li)
  }
}

function syncColumnChecks() {
  for (const li of $('column-list').children) {
    const cb = li.querySelector('input')
    if (cb) cb.checked = state.checked.has(li.dataset.name)
    li.classList.toggle('active-nd', state.mode === 'ndim' && li.dataset.name === state.nd.column)
  }
}

function populateXSelect() {
  const sel = $('x-select')
  sel.innerHTML = '<option value="">行号 (0…n-1)</option>'
  for (const col of state.pq.columns.filter(c => c.kind === 'numeric')) {
    const opt = document.createElement('option')
    opt.value = col.name
    opt.textContent = col.name
    sel.appendChild(opt)
  }
}

function populateNdSelect() {
  const sel = $('nd-column')
  sel.innerHTML = ''
  const candidates = state.pq.columns.filter(c => c.kind !== 'other')
  if (candidates.length === 0) {
    sel.innerHTML = '<option value="">（无可用数值列）</option>'
    return
  }
  for (const col of candidates) {
    const opt = document.createElement('option')
    opt.value = col.name
    opt.textContent = `${col.name}${col.kind === 'list' ? ' (LIST)' : ''}`
    sel.appendChild(opt)
  }
}

// ---------- 列数据缓存 ----------
async function ensureColumn(name) {
  if (state.cache.has(name)) return state.cache.get(name)
  const col = state.pq.columns.find(c => c.name === name)
  if (!col) throw new Error(`列不存在: ${name}`)
  setLoading(true, `读取列 ${name} …`)
  try {
    const data = await loadColumn(state.pq, col)
    state.cache.set(name, data)
    return data
  } finally {
    setLoading(false)
  }
}

// ---------- 模式切换 ----------
function setMode(mode) {
  state.mode = mode
  $('mode-field').classList.toggle('active', mode === 'field')
  $('mode-ndim').classList.toggle('active', mode === 'ndim')
  $('controls-field').classList.toggle('hidden', mode !== 'field')
  $('controls-ndim').classList.toggle('hidden', mode !== 'ndim')
  if (mode === 'field') $('sliders').innerHTML = ''
  syncColumnChecks()
  if (mode === 'ndim' && !state.nd.column) {
    const first = state.pq?.columns.find(c => c.kind === 'list') ?? state.pq?.columns.find(c => c.kind === 'numeric')
    if (first) selectNdColumn(first.name)
  } else {
    scheduleRender()
  }
}

// ---------- 多维切片 ----------
function currentJointNames(column = state.nd.column, shape = state.nd.shape) {
  return jointNamesForShape(state.jointNames, column, shape)
}

function seriesIndices(nd) {
  const cap = currentJointNames() && nd.seriesAxis === 1 ? MAX_NAMED_SERIES : MAX_SERIES
  return sampleAxisExtent(nd.shape[nd.seriesAxis], cap)
}

async function importJointNames(file) {
  try {
    const names = readJointNames(JSON.parse(await file.text()))
    if (!names.size) throw new Error('未找到有效的一维 features.*.names，名称数量需与 shape 一致')
    state.jointNames = names
    $('joint-info-status').textContent = `名称配置：${file.name}（${names.size} 列）`
    $('joint-info-status').title = [...names].map(([column, labels]) => `${column}：${labels.length} 个名称`).join('\n')
    if (state.nd.column) {
      // 读取名称后默认沿帧轴展示关节轨迹。
      if (currentJointNames() && state.nd.xAxis === 1) rotateTo(0)
      else buildNdControls()
    }
    scheduleRender()
    toast('关节名称已加载；在多维切片中选择 action 或 observation.state')
  } catch (err) {
    toast(`名称配置加载失败：${err.message}`, true)
  }
}

async function selectNdColumn(name, restore = null) {
  if (!state.pq || !name) return
  const seq = ++state.renderSeq
  try {
    const data = await ensureColumn(name)
    if (seq !== state.renderSeq) return
    const total = data.flat.length
    let shape
    const hint = state.pq.shapeHints[name]
    if (restore && validShape(restore.shape, total)) shape = restore.shape
    else if (hint && validShape(hint, total)) shape = hint
    else shape = data.shape

    const xAxis = restore && restore.xAxis < shape.length ? restore.xAxis
      : currentJointNames(name, shape) ? 0 : shape.length - 1
    state.nd = {
      column: name,
      shape: [...shape],
      xAxis,
      fixed: shape.map((_, d) => (d === xAxis ? -1 : 0)),
      seriesAxis: -1,
    }
    $('nd-column').value = name
    state.uirev++
    buildNdControls()
    syncColumnChecks()
    await renderNow()
  } catch (err) {
    console.error(err)
    toast(`读取列失败：${err.message}`, true)
  }
}

function buildNdControls() {
  const { shape, xAxis, seriesAxis, fixed, column } = state.nd
  const jointNames = currentJointNames()
  $('shape-input').value = shape.join(', ')
  const total = state.cache.get(column)?.flat.length ?? shapeProduct(shape)
  $('shape-info').textContent = `共 ${total.toLocaleString()} 个元素 · ${shape.length} 维`

  // X 轴选择
  const xSel = $('xaxis-select')
  xSel.innerHTML = ''
  shape.forEach((ext, d) => {
    const opt = document.createElement('option')
    opt.value = String(d)
    opt.textContent = `${jointNames ? (d === 0 ? '帧' : '关节') + ' · ' : ''}维度 ${d}（长度 ${ext}）`
    xSel.appendChild(opt)
  })
  xSel.value = String(xAxis)

  // 对比维度（叠加多条曲线）
  const sSel = $('series-select')
  sSel.innerHTML = '<option value="-1">无（单曲线）</option>'
  shape.forEach((ext, d) => {
    if (d === xAxis) return
    const opt = document.createElement('option')
    opt.value = String(d)
    const cap = jointNames && d === 1 ? MAX_NAMED_SERIES : MAX_SERIES
    opt.textContent = `${jointNames && d === 1 ? '关节 · ' : ''}维度 ${d}（叠加 ${Math.min(ext, cap)} 条）`
    sSel.appendChild(opt)
  })
  sSel.value = String(seriesAxis)

  // 其余维度滑块
  const box = $('sliders')
  box.innerHTML = ''
  shape.forEach((ext, d) => {
    if (d === xAxis || d === seriesAxis) return
    const row = document.createElement('div')
    row.className = 'slider-row'

    const label = document.createElement('label')
    label.textContent = `维度 ${d}`
    const range = document.createElement('input')
    range.type = 'range'
    range.min = '0'
    range.max = String(ext - 1)
    range.value = String(Math.min(fixed[d] ?? 0, ext - 1))
    range.step = '1'
    const num = document.createElement('input')
    num.type = 'number'
    num.min = '0'
    num.max = String(ext - 1)
    num.value = range.value
    const extSpan = document.createElement('span')
    extSpan.className = 'slider-ext'
    extSpan.textContent = `/ ${ext - 1}`

    let jointSelect = null
    if (jointNames && d === 1) {
      label.textContent = '关节'
      jointSelect = document.createElement('select')
      jointSelect.className = 'joint-select'
      jointSelect.setAttribute('aria-label', '选择关节')
      jointNames.forEach((name, i) => {
        const option = document.createElement('option')
        option.value = String(i)
        option.textContent = `${i} · ${name}`
        jointSelect.appendChild(option)
      })
      jointSelect.value = range.value
      jointSelect.title = jointNames[Number(range.value)]
    }

    const onInput = v => {
      let i = Math.max(0, Math.min(ext - 1, Math.round(Number(v) || 0)))
      range.value = String(i)
      num.value = String(i)
      state.nd.fixed[d] = i
      if (jointSelect) {
        jointSelect.value = String(i)
        jointSelect.title = jointNames[i]
      }
      scheduleRender()
    }
    range.addEventListener('input', () => onInput(range.value))
    num.addEventListener('change', () => onInput(num.value))
    num.addEventListener('keydown', e => { if (e.key === 'Enter') onInput(num.value) })
    jointSelect?.addEventListener('change', () => onInput(jointSelect.value))

    row.append(label, range, num, extSpan)
    if (jointSelect) row.appendChild(jointSelect)
    box.appendChild(row)
  })

  // 维度旋转按钮：交换 X 轴与其他维度
  const rot = $('rotate-buttons')
  rot.innerHTML = ''
  shape.forEach((_, d) => {
    if (d === xAxis) return
    const btn = document.createElement('button')
    btn.className = 'mini-btn'
    btn.textContent = `X ⇄ 维度${d}`
    btn.title = `把维度 ${d} 旋转为 X 轴`
    btn.addEventListener('click', () => rotateTo(d))
    rot.appendChild(btn)
  })
}

function rotateTo(d) {
  const nd = state.nd
  const oldX = nd.xAxis
  nd.xAxis = d
  nd.fixed[oldX] = nd.fixed[oldX] >= 0 ? nd.fixed[oldX] : 0
  nd.fixed[d] = -1
  if (nd.seriesAxis === d) nd.seriesAxis = -1
  state.uirev++
  buildNdControls()
  scheduleRender()
}

function applyShape() {
  const nd = state.nd
  const data = state.cache.get(nd.column)
  if (!data) return
  const shape = parseShapeInput($('shape-input').value)
  if (!shape || !validShape(shape, data.flat.length)) {
    toast(`形状无效：各维度乘积必须等于元素总数 ${data.flat.length.toLocaleString()}`, true)
    return
  }
  nd.shape = shape
  nd.xAxis = shape.length - 1
  nd.fixed = shape.map((_, d) => (d === nd.xAxis ? -1 : 0))
  nd.seriesAxis = -1
  state.uirev++
  buildNdControls()
  scheduleRender()
  toast(`已重塑为 [${shape.join(', ')}]`)
}

// ---------- 渲染 ----------
let rafPending = false
function scheduleRender() {
  if (rafPending) return
  rafPending = true
  const kick = () => {
    rafPending = false
    renderNow()
  }
  // 后台标签页 rAF 会被浏览器暂停，回退到定时器保证监视刷新等场景仍更新
  if (document.hidden) setTimeout(kick, 0)
  else requestAnimationFrame(kick)
}

function sliceLabel(nd, extraFixed = null) {
  const fixed = extraFixed ?? nd.fixed
  const parts = nd.shape.map((_, d) => (d === nd.xAxis ? ':' : String(fixed[d])))
  const names = currentJointNames(nd.column, nd.shape)
  const joint = names && nd.xAxis !== 1 ? names[fixed[1]] : null
  return `${joint ? joint + ' · ' : ''}${nd.column}[${parts.join(', ')}]`
}

async function renderNow() {
  if (!state.pq) return
  const seq = ++state.renderSeq
  try {
    let series = []
    let xLabel = '行号'
    let yLabel = '值'
    let xType = '-'

    if (state.mode === 'field') {
      const names = state.pq.columns.filter(c => state.checked.has(c.name)).map(c => c.name)
      let xData = null
      if (state.xColumn) {
        xData = await ensureColumn(state.xColumn)
        xLabel = state.xColumn
        if (xData.isTimestamp) xType = 'date'
      }
      for (const name of names) {
        const data = await ensureColumn(name)
        series.push({ name, x: xData ? xData.flat : null, y: data.flat })
      }
      yLabel = names.length === 1 ? names[0] : '值'
    } else {
      const nd = state.nd
      if (!nd.column) { updateStats([]); return }
      const data = await ensureColumn(nd.column)
      if (seq !== state.renderSeq) return
      yLabel = nd.column
      xLabel = currentJointNames() && nd.xAxis === 0 ? '帧（索引）' : `维度 ${nd.xAxis}（索引）`
      if (nd.seriesAxis >= 0) {
        const indices = seriesIndices(nd)
        for (const s of indices) {
          const fixed = [...nd.fixed]
          fixed[nd.seriesAxis] = s
          const y = extractSlice(data.flat, nd.shape, nd.xAxis, fixed)
          series.push({ name: sliceLabel(nd, fixed), x: null, y })
        }
      } else {
        const y = extractSlice(data.flat, nd.shape, nd.xAxis, nd.fixed)
        series.push({ name: sliceLabel(nd), x: null, y })
      }
    }

    if (seq !== state.renderSeq) return
    state.lastSeries = series
    state.lastXLabel = xLabel
    renderChart($('chart'), series, {
      xLabel, yLabel, xType, uirevision: String(state.uirev),
      namedSeries: state.mode === 'ndim' && Boolean(currentJointNames()) && series.length > 1,
    })
    updateStats(series)
  } catch (err) {
    console.error(err)
    toast(`渲染失败：${err.message}`, true)
  }
}

function updateStats(series) {
  const bar = $('stats-bar')
  bar.replaceChildren()
  if (series.length === 0) {
    bar.textContent = '勾选左侧字段开始可视化；LIST 列可点击切换维度'
    return
  }
  const s = arrayStats(series[0].y)
  const smooth = logDimensionlessJerk(series[0].y, series[0].x, state.smoothnessInput)
  const extra = series.length > 1 ? ` · 共 ${series.length} 条曲线（统计为首条）` : ''
  const summary = document.createElement('div')
  summary.textContent = `点数 ${s.count.toLocaleString()} · 最小 ${fmtNum(s.min)} · 最大 ${fmtNum(s.max)} · 均值 ${fmtNum(s.mean)} · 标准差 ${fmtNum(s.std)}${extra}`
  const detail = document.createElement('div')
  detail.className = 'smoothness-stats'
  const value = smooth.value === Infinity ? '+∞' : fmtNum(smooth.value)
  detail.textContent = `平滑度 LDLj ${value}（无量纲，越大越平滑）${smooth.reason ? ` · ${smooth.reason}` : ''}`
  detail.title = 'LDLj = −ln(T³ / v峰值² × ∫ jerk² dt)。位置／关节角先求速度，再求 jerk；使用自然对数与峰值速度归一化。'
  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = `统计曲线：${series[0].name} · ${state.smoothnessInput === 'position' ? '位置／关节角' : '速度'}输入 · 完整原始数据，等间隔采样，未滤波；缩放不改变统计。`
  bar.append(summary, detail, hint)
}

// ---------- 文件监视（实时刷新） ----------
async function pickAndWatch() {
  if (!window.showOpenFilePicker) {
    toast('当前浏览器不支持文件监视（需要 Chrome / Edge）。可用普通打开方式。', true)
    return
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Parquet 文件', accept: { 'application/octet-stream': ['.parquet', '.pq'] } }],
      multiple: false,
    })
    const file = await handle.getFile()
    await openSource(asyncBufferFromFile(file), file.name)
    startWatch(handle, file)
  } catch (err) {
    if (err.name !== 'AbortError') toast(`无法打开文件：${err.message}`, true)
  }
}

function startWatch(handle, file) {
  stopWatch(false)
  state.watch = { handle, timer: null, lastModified: file.lastModified, size: file.size }
  state.watch.timer = setInterval(async () => {
    try {
      const f = await handle.getFile()
      if (f.lastModified !== state.watch.lastModified || f.size !== state.watch.size) {
        state.watch.lastModified = f.lastModified
        state.watch.size = f.size
        await openSource(asyncBufferFromFile(f), f.name, true)
        toast('检测到文件更新，已刷新')
      }
    } catch (err) {
      console.warn('watch poll failed', err)
    }
  }, 1000)
  $('watch-badge').classList.remove('hidden')
  $('watch-name').textContent = file.name
}

function stopWatch(clearBadge = true) {
  if (state.watch.timer) clearInterval(state.watch.timer)
  state.watch = { handle: null, timer: null, lastModified: 0, size: 0 }
  if (clearBadge) $('watch-badge').classList.add('hidden')
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('btn-joint-info').addEventListener('click', () => $('joint-info-input').click())
  $('joint-info-input').addEventListener('change', e => {
    if (e.target.files[0]) importJointNames(e.target.files[0])
    e.target.value = ''
  })
  $('smoothness-input').addEventListener('change', () => {
    state.smoothnessInput = $('smoothness-input').value
    updateStats(state.lastSeries)
  })
  $('btn-open').addEventListener('click', () => $('file-input').click())
  $('file-input').addEventListener('change', e => {
    if (e.target.files[0]) openFile(e.target.files[0])
    e.target.value = ''
  })
  $('btn-watch').addEventListener('click', pickAndWatch)
  $('btn-stop-watch').addEventListener('click', () => stopWatch())
  $('btn-demo').addEventListener('click', openDemo)
  $('btn-demo-big').addEventListener('click', openDemo)
  $('btn-url').addEventListener('click', () => openUrl($('url-input').value.trim()))
  $('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') openUrl($('url-input').value.trim()) })

  $('mode-field').addEventListener('click', () => setMode('field'))
  $('mode-ndim').addEventListener('click', () => setMode('ndim'))
  $('x-select').addEventListener('change', () => {
    state.xColumn = $('x-select').value
    state.uirev++
    scheduleRender()
  })

  $('nd-column').addEventListener('change', () => selectNdColumn($('nd-column').value))
  $('btn-reshape').addEventListener('click', applyShape)
  $('shape-input').addEventListener('keydown', e => { if (e.key === 'Enter') applyShape() })
  $('xaxis-select').addEventListener('change', () => rotateTo(Number($('xaxis-select').value)))
  $('series-select').addEventListener('change', () => {
    const nd = state.nd
    nd.seriesAxis = Number($('series-select').value)
    nd.fixed = nd.shape.map((_, d) => (d === nd.xAxis || d === nd.seriesAxis ? -1 : Math.max(0, nd.fixed[d] ?? 0)))
    state.uirev++
    buildNdControls()
    scheduleRender()
  })

  $('btn-png').addEventListener('click', () => exportPng($('chart')))
  $('btn-csv').addEventListener('click', () => exportCsv(state.lastSeries, state.lastXLabel))
  $('btn-reset-zoom').addEventListener('click', () => {
    window.Plotly?.relayout($('chart'), { 'xaxis.autorange': true, 'yaxis.autorange': true })
  })

  $('btn-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'))
  $('btn-close-help').addEventListener('click', () => $('help-modal').classList.add('hidden'))
  $('help-modal').addEventListener('click', e => { if (e.target === $('help-modal')) $('help-modal').classList.add('hidden') })

  // 拖拽打开
  let dragDepth = 0
  document.addEventListener('dragenter', e => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    dragDepth++
    $('drop-overlay').classList.remove('hidden')
  })
  document.addEventListener('dragleave', e => {
    e.preventDefault()
    if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').classList.add('hidden') }
  })
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => {
    e.preventDefault()
    dragDepth = 0
    $('drop-overlay').classList.add('hidden')
    const file = e.dataTransfer.files?.[0]
    if (file) openFile(file)
  })
}

// ---------- 启动 ----------
bindEvents()
if (!window.showOpenFilePicker) $('btn-watch').classList.add('hidden')
const params = new URLSearchParams(location.search)
if (params.get('url')) {
  $('url-input').value = params.get('url')
  openUrl(params.get('url'))
} else if (params.has('demo')) {
  openDemo()
}
