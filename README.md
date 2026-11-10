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
- 关节名称：点击「加载关节名称」选择同一数据集的 `meta/info.json`，读取 `features.<列名>.names`；在原始 `[帧, 关节]` 形状下显示关节下拉框、曲线图例、悬停提示、统计栏名称与 CSV 表头。已命名的关节最多叠加 64 条，其他维度最多 24 条。名称配置可跨文件使用，刷新页面后需重载，切换数据集时应加载对应配置。
- min-max 降采样保尖峰、统计栏、PNG / CSV 导出
- 无量纲平滑度 LDLj（越大越平滑）：默认位置／关节角输入，可切换速度；完整原始数据计算，多曲线时统计首条并显示名称

LDLj 采用峰值速度归一化与自然对数：`−ln(T³ / vPeak² × ∫ jerk² dt)`。位置输入先求一阶差分速度，再求二阶差分 jerk（位置至少 4 点，速度至少 3 点）。角度应先展开以去除周期跳变。

等间隔离散实现沿用 [smoothness 的速度实现](https://github.com/siva82kb/smoothness/blob/master/python/smoothness.py)：`LDLj = −ln(m³ × Σ(Δ²(v/vPeak))²)`，m 为速度序列长度；位置输入 m=N−1，速度输入 m=N。采用 T=mΔt 和矩形积分，采样间隔在无量纲化后消去，无需输入采样率。支持 X 轴等间隔检查（相对容差 0.01%，另考虑浮点精度），无显式 X 时默认等间隔。均匀缩放时间或幅值不改变结果；采样密度、噪声仍影响结果，数据不自动滤波。

缺失值、非递增或不等间隔 X 会显示原因；零峰值速度时未定义，非零峰值速度但离散 jerk 为 0 时显示 `+∞`。缩放图表不改变统计范围。

## Usage / 使用

Open the live demo and drop a file, or click "示例数据 / Demo" for sample data.
To run locally, serve this folder with any static server, e.g. `python3 -m http.server`, then open `http://localhost:8000`.

打开在线演示拖入文件即可，或点「示例数据」体验；本地运行只需任意静态服务器托管本目录。

## Stack

[hyparquet](https://github.com/hyparam/hyparquet) for Parquet parsing + [Plotly.js](https://plotly.com/javascript/) for charts. No build step.
