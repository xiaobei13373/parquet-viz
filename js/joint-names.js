// LeRobot info.json 的一维特征名称。仅在原始 [帧, 关节] 形状下使用，避免重塑后误标。
export function readJointNames(info) {
  const labels = new Map()
  for (const [column, feature] of Object.entries(info?.features ?? {})) {
    const { shape, names } = feature ?? {}
    if (!Array.isArray(shape) || shape.length !== 1 || !Number.isInteger(shape[0]) || shape[0] < 1) continue
    if (!Array.isArray(names) || names.length !== shape[0] || !names.every(n => typeof n === 'string' && n.trim())) continue
    labels.set(column, names.map(n => n.trim()))
  }
  return labels
}

export function jointNamesForShape(labels, column, shape) {
  const names = labels.get(column)
  return names && shape.length === 2 && shape[1] === names.length ? names : null
}
