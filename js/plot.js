// Plotly 曲线渲染：暗色主题、缩放保持、min-max 降采样。
import { decimateIndices, gather } from './ndim.js'

const MAX_POINTS = 6000 // 每条曲线最多渲染的点数（降采样保尖峰）

const COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae', '#ff8a65', '#aed581']

const LAYOUT_BASE = {
  paper_bgcolor: '#101624',
  plot_bgcolor: '#0c1220',
  font: { color: '#cfd8e6', family: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', size: 12 },
  margin: { l: 60, r: 20, t: 30, b: 46 },
  hovermode: 'x unified',
  dragmode: 'zoom',
  showlegend: true,
  legend: { orientation: 'h', y: 1.08, x: 0, bgcolor: 'rgba(0,0,0,0)' },
  xaxis: { gridcolor: '#1e2a40', zerolinecolor: '#2a3a58', linecolor: '#2a3a58' },
  yaxis: { gridcolor: '#1e2a40', zerolinecolor: '#2a3a58', linecolor: '#2a3a58' },
  modebar: { bgcolor: 'rgba(0,0,0,0)', color: '#5a6b8c', activecolor: '#4fc3f7' },
}

const CONFIG = {
  responsive: true,
  scrollZoom: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  toImageButtonOptions: { format: 'png', filename: 'parquet-viz', scale: 2 },
  locale: 'zh-CN',
}

/**
 * 渲染一组曲线。
 * series: [{ name, x: ArrayLike|null, y: ArrayLike }]  x 为 null 时用下标
 * opts: { xLabel, yLabel, xType, uirevision }
 */
export function renderChart(div, series, opts = {}) {
  const traces = series.map((s, i) => {
    const y = s.y
    const idx = decimateIndices(y, MAX_POINTS)
    const yy = idx ? gather(y, idx) : Array.from(y)
    const xx = idx ? gather(s.x, idx) : (s.x ? Array.from(s.x) : Array.from({ length: y.length }, (_, k) => k))
    return {
      type: 'scatter',
      mode: 'lines',
      name: s.name,
      x: xx,
      y: yy,
      line: { width: 1.4, color: COLORS[i % COLORS.length] },
      connectgaps: false,
      hovertemplate: '%{y:.6g}<extra>%{fullData.name}</extra>',
    }
  })

  const layout = {
    ...LAYOUT_BASE,
    ...(opts.namedSeries ? {
      margin: { ...LAYOUT_BASE.margin, r: 300 },
      legend: { ...LAYOUT_BASE.legend, orientation: 'v', x: 1.02, y: 1, font: { size: 10 } },
    } : {}),
    uirevision: opts.uirevision ?? 'keep',
    xaxis: { ...LAYOUT_BASE.xaxis, title: { text: opts.xLabel ?? '' }, type: opts.xType ?? '-' },
    yaxis: { ...LAYOUT_BASE.yaxis, title: { text: opts.yLabel ?? '' } },
    annotations: series.length === 0 ? [{
      text: '没有可显示的数据',
      showarrow: false,
      font: { size: 16, color: '#5a6b8c' },
      xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
    }] : [],
  }

  if (!div.data) {
    window.Plotly.newPlot(div, traces, layout, CONFIG)
  } else {
    window.Plotly.react(div, traces, layout, CONFIG)
  }
}

export function exportPng(div) {
  window.Plotly.downloadImage(div, { format: 'png', filename: 'parquet-viz', width: 1600, height: 900, scale: 2 })
}

/** 当前曲线导出 CSV（完整数据，未降采样） */
export function exportCsv(series, xLabel) {
  if (series.length === 0) return
  const header = [xLabel || 'x', ...series.map(s => s.name)]
  const n = Math.max(...series.map(s => s.y.length))
  const lines = [header.map(csvEscape).join(',')]
  const CAP = 500000
  const limit = Math.min(n, CAP)
  for (let i = 0; i < limit; i++) {
    const x = series[0].x ? series[0].x[i] : i
    const row = [fmt(x), ...series.map(s => fmt(s.y[i]))]
    lines.push(row.join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'parquet-viz-export.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

function fmt(v) {
  return v == null || Number.isNaN(v) ? '' : String(v)
}

function csvEscape(s) {
  s = String(s)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
