import assert from 'node:assert/strict'
import { readJointNames, jointNamesForShape } from '../js/joint-names.js'

const labels = readJointNames({ features: {
  action: { shape: [2], names: ['left_joint.pos', 'right_joint.pos'] },
  'observation.state': { shape: [2], names: ['follower_left.pos', 'follower_right.pos'] },
  image: { shape: [720, 1280, 3], names: ['height', 'width', 'channels'] },
  missing: { shape: [1], names: null },
  mismatched: { shape: [3], names: ['a', 'b'] },
  invalid: { shape: [2], names: ['', 3] },
  nullFeature: null,
} })
assert.equal(labels.size, 2)
assert.deepEqual(jointNamesForShape(labels, 'action', [1495, 2]), ['left_joint.pos', 'right_joint.pos'])
assert.deepEqual(jointNamesForShape(labels, 'observation.state', [1495, 2]), ['follower_left.pos', 'follower_right.pos'])
for (const shape of [[2, 1495], [1, 1495, 2], [1495, 3], [2990]]) {
  assert.equal(jointNamesForShape(labels, 'action', shape), null)
}
assert.equal(jointNamesForShape(labels, 'other', [1495, 2]), null)
assert.equal(readJointNames(null).size, 0)
console.log('joint name tests: all passed ✓')
