import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaf, splitLeaf, serialize, deserialize } from '../../src/lib/split-tree.js';

describe('terminal persistence - layout serialization', () => {
  it('serializes a layout with one group, one instance', () => {
    const layout = {
      groups: [{
        id: 'g1',
        splitTree: serialize(createLeaf('i1')),
        instances: {
          'i1': { title: 'Terminal 1', color: null, icon: null, profileId: 'default' },
        },
      }],
      activeGroupId: 'g1',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 1);
    assert.equal(restored.groups[0].id, 'g1');
    assert.equal(restored.activeGroupId, 'g1');
  });

  it('serializes a layout with splits', () => {
    let tree = createLeaf('i1');
    tree = splitLeaf(tree, 'i1', 'i2', 'vertical');
    const layout = {
      groups: [{
        id: 'g1',
        splitTree: serialize(tree),
        instances: {
          'i1': { title: 'Terminal 1', color: null, icon: null, profileId: 'default' },
          'i2': { title: 'Terminal 2', color: 'red', icon: 'server', profileId: 'git-bash' },
        },
      }],
      activeGroupId: 'g1',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    const restoredTree = deserialize(restored.groups[0].splitTree);
    assert.equal(restoredTree.type, 'split');
    assert.equal(restoredTree.direction, 'vertical');
  });

  it('serializes multiple groups', () => {
    const layout = {
      groups: [
        { id: 'g1', splitTree: serialize(createLeaf('i1')), instances: { 'i1': { title: 'T1', color: null, icon: null, profileId: 'default' } } },
        { id: 'g2', splitTree: serialize(createLeaf('i2')), instances: { 'i2': { title: 'T2', color: 'blue', icon: 'node', profileId: 'powershell' } } },
      ],
      activeGroupId: 'g2',
    };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 2);
    assert.equal(restored.activeGroupId, 'g2');
  });

  it('handles empty layout gracefully', () => {
    const layout = { groups: [], activeGroupId: null };
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    assert.equal(restored.groups.length, 0);
    assert.equal(restored.activeGroupId, null);
  });

  it('preserves instance customizations', () => {
    const layout = {
      groups: [{
        id: 'g1',
        splitTree: serialize(createLeaf('i1')),
        instances: {
          'i1': { title: 'My Server', color: 'green', icon: 'server', profileId: 'git-bash' },
        },
      }],
      activeGroupId: 'g1',
    };
    const restored = JSON.parse(JSON.stringify(layout));
    const inst = restored.groups[0].instances['i1'];
    assert.equal(inst.title, 'My Server');
    assert.equal(inst.color, 'green');
    assert.equal(inst.icon, 'server');
    assert.equal(inst.profileId, 'git-bash');
  });

  it('round-trips split tree through serialize/deserialize', () => {
    let tree = createLeaf('a');
    tree = splitLeaf(tree, 'a', 'b', 'horizontal');
    tree = splitLeaf(tree, 'b', 'c', 'vertical');
    const serialized = serialize(tree);
    const deserialized = deserialize(serialized);
    assert.equal(deserialized.type, 'split');
    assert.equal(deserialized.children[0].type, 'leaf');
    assert.equal(deserialized.children[0].instanceId, 'a');
    assert.equal(deserialized.children[1].type, 'split');
    assert.equal(deserialized.children[1].direction, 'vertical');
  });

  it('deserialize returns null for invalid data', () => {
    assert.equal(deserialize(null), null);
    assert.equal(deserialize(undefined), null);
    assert.equal(deserialize({}), null);
    assert.equal(deserialize({ type: 'leaf' }), null); // missing instanceId
    assert.equal(deserialize({ type: 'split', children: [] }), null); // wrong children count
  });

  it('deserialize provides defaults for missing fields', () => {
    const tree = deserialize({ type: 'split', children: [
      { type: 'leaf', instanceId: 'a' },
      { type: 'leaf', instanceId: 'b' },
    ]});
    assert.equal(tree.direction, 'horizontal'); // default
    assert.equal(tree.ratio, 0.5); // default
  });
});
