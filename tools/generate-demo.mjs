// 生成示例 parquet 文件，用于演示网页的各项功能。
// 用法: npm install hyparquet-writer && node tools/generate-demo.mjs
import { parquetWriteFile } from 'hyparquet-writer'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const N = 2400 // 行数 = 40 x 60 = 10 x 24 x 10，方便演示二维/三维重塑

// 可复现的伪随机数
let seed = 42
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

const time = []
const signalA = []
const signalB = []
const temperature = []
const spectra = []
const cube = []

let temp = 20
for (let i = 0; i < N; i++) {
  const t = i * 0.01
  time.push(t)
  signalA.push(Math.sin(2 * Math.PI * 0.5 * t) + 0.4 * Math.sin(2 * Math.PI * 3 * t) + (rand() - 0.5) * 0.15)
  signalB.push(Math.exp(-t / 15) * Math.sin(2 * Math.PI * (0.2 + t * 0.02) * t))
  temp += (rand() - 0.5) * 0.3
  temperature.push(temp)

  // 每行 64 个通道的光谱数据（LIST 列，自动推断为 [2400, 64] 二维）
  const row = new Array(64)
  const center = 20 + 15 * Math.sin(i / 180)
  for (let c = 0; c < 64; c++) {
    row[c] = Math.exp(-((c - center) ** 2) / 40) + 0.3 * Math.exp(-((c - 45) ** 2) / 18) + (rand() - 0.5) * 0.04
  }
  spectra.push(row)
}

// 10 x 24 x 10 的三维标量场，按行优先展平存储
for (let x = 0; x < 10; x++) {
  for (let y = 0; y < 24; y++) {
    for (let z = 0; z < 10; z++) {
      cube.push(Math.sin(x / 2) * Math.cos(y / 4) * Math.exp(-z / 6) + 0.1 * (rand() - 0.5) + 0.05 * z)
    }
  }
}

const filename = path.join(path.dirname(fileURLToPath(import.meta.url)), '../sample/demo.parquet')
parquetWriteFile({
  filename,
  columnData: [
    { name: 'time', data: time },
    { name: 'signal_a', data: signalA },
    { name: 'signal_b', data: signalB },
    { name: 'temperature', data: temperature },
    { name: 'spectra', data: spectra },
    { name: 'cube_flat', data: cube },
  ],
  // 显式 schema：spectra 为原生 3-level LIST<DOUBLE>
  schema: [
    { name: 'root', num_children: 6 },
    { name: 'time', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    { name: 'signal_a', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    { name: 'signal_b', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    { name: 'temperature', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    { name: 'spectra', converted_type: 'LIST', repetition_type: 'OPTIONAL', num_children: 1 },
    { name: 'list', repetition_type: 'REPEATED', num_children: 1 },
    { name: 'element', type: 'DOUBLE', repetition_type: 'OPTIONAL' },
    { name: 'cube_flat', type: 'DOUBLE', repetition_type: 'REQUIRED' },
  ],
  kvMetadata: [
    { key: 'shapes', value: JSON.stringify({ cube_flat: [10, 24, 10], spectra: [2400, 64] }) },
    { key: 'description', value: 'parquet-viz demo: 1D signals, 2D spectra list, 3D flattened field' },
  ],
})
console.log('written:', filename)