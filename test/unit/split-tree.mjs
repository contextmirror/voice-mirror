import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLeaf,
  splitLeaf,
  removeLeaf,
  findLeaf,
  getAllInstanceIds,
  getDepth,
  serialize,
  deserialize,
  MAX_DEPTH,
} from '../../src/lib/split-tree.js';

describe('split-tree', () => {
  describe('createLeaf', () => {
    it('creates a leaf node', () => {
      const leaf = createLeaf('inst-1');
      assert.deepStrictEqual(leaf, { type: 'leaf', instanceId: 'inst-1' });
    });
  });

  describe('splitLeaf', () => {
    it('splits a single leaf horizontally', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'horizontal');
      assert.equal(result.type, 'split');
      assert.equal(result.direction, 'horizontal');
      assert.equal(result.ratio, 0.5);
      assert.deepStrictEqual(result.children[0], { type: 'leaf', instanceId: 'a' });
      assert.deepStrictEqual(result.children[1], { type: 'leaf', instanceId: 'b' });
    });

    it('splits a single leaf vertically', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'vertical');
      assert.equal(result.direction, 'vertical');
    });

    it('splits a nested leaf', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      assert.equal(tree.children[1].type, 'split');
      assert.equal(tree.children[1].direction, 'vertical');
      assert.deepStrictEqual(tree.children[1].children[0], { type: 'leaf', instanceId: 'b' });
      assert.deepStrictEqual(tree.children[1].children[1], { type: 'leaf', instanceId: 'c' });
    });

    it('returns null if target leaf not found', () => {
      const tree = createLeaf('a');
      const result = splitLeaf(tree, 'nonexistent', 'b', 'horizontal');
      assert.equal(result, null);
    });

    it('rejects split beyond MAX_DEPTH', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');  // depth 1
      tree = splitLeaf(tree, 'b', 'c', 'vertical');     // depth 2
      tree = splitLeaf(tree, 'c', 'd', 'horizontal');   // depth 3 = MAX_DEPTH
      const result = splitLeaf(tree, 'd', 'e', 'vertical'); // depth 4 = rejected
      assert.equal(result, null);
    });
  });

  describe('removeLeaf', () => {
    it('returns null when removing the only leaf', () => {
      const tree = createLeaf('a');
      const result = removeLeaf(tree, 'a');
      assert.equal(result, null);
    });

    it('promotes sibling when removing from 2-node split', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      const result = removeLeaf(tree, 'b');
      assert.deepStrictEqual(result, { type: 'leaf', instanceId: 'a' });
    });

    it('promotes the other sibling when removing first child', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      const result = removeLeaf(tree, 'a');
      assert.deepStrictEqual(result, { type: 'leaf', instanceId: 'b' });
    });

    it('removes from nested tree correctly', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      const result = removeLeaf(tree, 'c');
      assert.equal(result.type, 'split');
      assert.deepStrictEqual(result.children[0], { type: 'leaf', instanceId: 'a' });
      assert.deepStrictEqual(result.children[1], { type: 'leaf', instanceId: 'b' });
    });

    it('returns tree unchanged if target not found', () => {
      const tree = createLeaf('a');
      const result = removeLeaf(tree, 'nonexistent');
      assert.deepStrictEqual(result, tree);
    });
  });

  describe('findLeaf', () => {
    it('finds a leaf in a single-node tree', () => {
      const tree = createLeaf('a');
      assert.deepStrictEqual(findLeaf(tree, 'a'), tree);
    });

    it('finds a leaf in a nested tree', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      const found = findLeaf(tree, 'c');
      assert.deepStrictEqual(found, { type: 'leaf', instanceId: 'c' });
    });

    it('returns null when not found', () => {
      const tree = createLeaf('a');
      assert.equal(findLeaf(tree, 'z'), null);
    });
  });

  describe('getAllInstanceIds', () => {
    it('returns single ID for leaf', () => {
      assert.deepStrictEqual(getAllInstanceIds(createLeaf('a')), ['a']);
    });

    it('returns all IDs in tree order (left-to-right, depth-first)', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      assert.deepStrictEqual(getAllInstanceIds(tree), ['a', 'b', 'c']);
    });
  });

  describe('getDepth', () => {
    it('returns 0 for a leaf', () => {
      assert.equal(getDepth(createLeaf('a')), 0);
    });

    it('returns 1 for a single split', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      assert.equal(getDepth(tree), 1);
    });

    it('returns correct depth for nested splits', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      tree = splitLeaf(tree, 'c', 'd', 'horizontal');
      assert.equal(getDepth(tree), 3);
    });
  });

  describe('MAX_DEPTH', () => {
    it('is 3', () => {
      assert.equal(MAX_DEPTH, 3);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips a leaf', () => {
      const tree = createLeaf('a');
      const json = serialize(tree);
      const restored = deserialize(json);
      assert.deepStrictEqual(restored, tree);
    });

    it('round-trips a complex tree', () => {
      let tree = createLeaf('a');
      tree = splitLeaf(tree, 'a', 'b', 'horizontal');
      tree = splitLeaf(tree, 'b', 'c', 'vertical');
      const json = serialize(tree);
      const parsed = JSON.parse(JSON.stringify(json));
      const restored = deserialize(parsed);
      assert.deepStrictEqual(getAllInstanceIds(restored), ['a', 'b', 'c']);
      assert.equal(restored.direction, 'horizontal');
      assert.equal(restored.children[1].direction, 'vertical');
    });

    it('deserialize returns null for invalid data', () => {
      assert.equal(deserialize(null), null);
      assert.equal(deserialize(undefined), null);
      assert.equal(deserialize({}), null);
    });
  });
});
