import { parquetReadObjects, parquetMetadata, parquetMetadataAsync } from '../vendor/hyparquet.esm.js'
import { readFileSync } from 'node:fs'

const buf = readFileSync(new URL('../sample/demo.parquet', import.meta.url))
try {
  // AsyncBuffer 形式（浏览器 File 对象会用这种接口）
  const ab = { byteLength: buf.length, slice: (s, e) => Promise.resolve(buf.buffer.slice(buf.byteOffset + s, buf.byteOffset + e)) }
  const meta = await parquetMetadataAsync(ab)
  console.log('rows:', Number(meta.num_rows), 'rowgroups:', meta.row_groups.length)
  console.log('kv:', JSON.stringify(meta.key_value_metadata))
  const rows = await parquetReadObjects({ file: ab, metadata: meta, columns: ['time', 'signal_a', 'spectra', 'cube_flat'], rowStart: 0, rowEnd: 3 })
  console.log('read rows:', rows.length)
  console.log('row0:', { time: rows[0].time, signal_a: rows[0].signal_a, spectraLen: rows[0].spectra?.length, spectra0: rows[0].spectra?.[0], cube_flat: rows[0].cube_flat })
  const all = await parquetReadObjects({ file: ab, metadata: meta, columns: ['cube_flat'] })
  console.log('full column length:', all.length, 'last value:', all[all.length - 1].cube_flat)
  console.log('OK')
} catch (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
}