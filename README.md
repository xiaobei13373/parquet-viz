# Parquet Viz

Browser-based Parquet curve visualizer with HDF5-style N-dimensional slicing and axis rotation.
Pure static site — files are parsed locally in your browser and never uploaded.

**Live demo / 在线演示**: <https://xiaobei13373.github.io/parquet-viz/>

## Features

- Open `.parquet` by drag & drop, file picker, or URL (target server must allow CORS)
- Plot numeric fields as interactive curves; X axis = row index or any numeric column
- N-d reshape + dimension rotation: choose the X dimension, slice the others with sliders, overlay up to 24 curves along a compare dimension
- LIST columns auto-infer their shape; a `shapes` key in file metadata is honored as a reshape hint
- Live file watch (Chrome/Edge): auto-refresh when the file changes on disk
- Min-max downsampling (keeps spikes), stats bar, PNG / CSV export

## 功能

- 拖拽 / 选择 / URL 打开 parquet 文件，纯浏览器本地解析，不上传服务器
- 数值字段实时曲线可视化，X 轴可选行号或任意数值列（如时间）
- N 维重塑与维度旋转：选定 X 轴维度，其余维度滑块切片，对比维度叠加最多 24 条曲线
- LIST 列自动推断形状；自动识别文件元数据中的 `shapes` 形状提示
- 文件监视：磁盘文件变化时自动刷新（Chrome/Edge）
- min-max 降采样保尖峰、统计栏、PNG / CSV 导出

## Usage / 使用

Open the live demo and drop a file, or click "示例数据 / Demo" for sample data.
To run locally, serve this folder with any static server, e.g. `python3 -m http.server`, then open `http://localhost:8000`.

打开在线演示拖入文件即可，或点「示例数据」体验；本地运行只需任意静态服务器托管本目录。

## Stack

[hyparquet](https://github.com/hyparam/hyparquet) for Parquet parsing + [Plotly.js](https://plotly.com/javascript/) for charts. No build step.