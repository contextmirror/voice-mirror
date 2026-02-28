/**
 * split-tree.js -- Pure-JS recursive split tree for terminal pane layout.
 *
 * Data model:
 *   SplitNode = { type: 'leaf', instanceId: string }
 *             | { type: 'split', direction: 'horizontal'|'vertical', ratio: number, children: [SplitNode, SplitNode] }
 *
 * All functions are pure (no mutations). Trees are rebuilt on change.
 */

/** Maximum nesting depth for splits. Depth 3 allows up to ~8 panes. */
export const MAX_DEPTH = 3;

/**
 * Create a leaf node.
 * @param {string} instanceId
 * @returns {{ type: 'leaf', instanceId: string }}
 */
export function createLeaf(instanceId) {
  return { type: 'leaf', instanceId };
}

/**
 * Split a leaf into two. Returns null if target not found or depth exceeded.
 * @param {object} tree
 * @param {string} targetInstanceId - the leaf to split
 * @param {string} newInstanceId - the new instance to add
 * @param {'horizontal'|'vertical'} direction
 * @returns {object|null}
 */
export function splitLeaf(tree, targetInstanceId, newInstanceId, direction) {
  // Check if adding another level at the target leaf would exceed max depth
  const targetDepth = getLeafDepth(tree, targetInstanceId, 0);
  if (targetDepth === null) return null; // target not found
  if (targetDepth >= MAX_DEPTH) return null; // would exceed max depth

  const result = splitLeafInner(tree, targetInstanceId, newInstanceId, direction);
  // If the inner function returned the same tree reference, target wasn't found
  if (result === tree) return null;
  return result;
}

function getLeafDepth(tree, instanceId, currentDepth) {
  if (tree.type === 'leaf') {
    return tree.instanceId === instanceId ? currentDepth : null;
  }
  if (tree.type === 'split') {
    const left = getLeafDepth(tree.children[0], instanceId, currentDepth + 1);
    if (left !== null) return left;
    return getLeafDepth(tree.children[1], instanceId, currentDepth + 1);
  }
  return null;
}

function splitLeafInner(tree, targetInstanceId, newInstanceId, direction) {
  if (tree.type === 'leaf') {
    if (tree.instanceId === targetInstanceId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'leaf', instanceId: targetInstanceId },
          { type: 'leaf', instanceId: newInstanceId },
        ],
      };
    }
    return tree; // not the target
  }

  if (tree.type === 'split') {
    const newLeft = splitLeafInner(tree.children[0], targetInstanceId, newInstanceId, direction);
    if (newLeft !== tree.children[0]) {
      return { ...tree, children: [newLeft, tree.children[1]] };
    }
    const newRight = splitLeafInner(tree.children[1], targetInstanceId, newInstanceId, direction);
    if (newRight !== tree.children[1]) {
      return { ...tree, children: [tree.children[0], newRight] };
    }
  }

  return tree; // target not found, return unchanged
}

/**
 * Remove a leaf from the tree. Promotes sibling if removing from 2-node split.
 * Returns null if removing the only leaf. Returns tree unchanged if target not found.
 * @param {object} tree
 * @param {string} instanceId
 * @returns {object|null}
 */
export function removeLeaf(tree, instanceId) {
  if (tree.type === 'leaf') {
    return tree.instanceId === instanceId ? null : tree;
  }

  if (tree.type === 'split') {
    const leftResult = removeLeaf(tree.children[0], instanceId);
    if (leftResult === null) {
      // Left child was the target — promote right
      return tree.children[1];
    }
    if (leftResult !== tree.children[0]) {
      return { ...tree, children: [leftResult, tree.children[1]] };
    }

    const rightResult = removeLeaf(tree.children[1], instanceId);
    if (rightResult === null) {
      // Right child was the target — promote left
      return tree.children[0];
    }
    if (rightResult !== tree.children[1]) {
      return { ...tree, children: [tree.children[0], rightResult] };
    }
  }

  return tree; // not found
}

/**
 * Find a leaf by instanceId.
 * @param {object} tree
 * @param {string} instanceId
 * @returns {object|null}
 */
export function findLeaf(tree, instanceId) {
  if (tree.type === 'leaf') {
    return tree.instanceId === instanceId ? tree : null;
  }
  if (tree.type === 'split') {
    return findLeaf(tree.children[0], instanceId) || findLeaf(tree.children[1], instanceId);
  }
  return null;
}

/**
 * Get all instance IDs in tree order (left-to-right, depth-first).
 * @param {object} tree
 * @returns {string[]}
 */
export function getAllInstanceIds(tree) {
  if (tree.type === 'leaf') return [tree.instanceId];
  if (tree.type === 'split') {
    return [...getAllInstanceIds(tree.children[0]), ...getAllInstanceIds(tree.children[1])];
  }
  return [];
}

/**
 * Get the maximum depth of the tree. Leaf = 0, single split = 1.
 * @param {object} tree
 * @returns {number}
 */
export function getDepth(tree) {
  if (tree.type === 'leaf') return 0;
  if (tree.type === 'split') {
    return 1 + Math.max(getDepth(tree.children[0]), getDepth(tree.children[1]));
  }
  return 0;
}

/**
 * Serialize a tree to a JSON-safe plain object.
 * @param {object} tree
 * @returns {object}
 */
export function serialize(tree) {
  if (tree.type === 'leaf') {
    return { type: 'leaf', instanceId: tree.instanceId };
  }
  if (tree.type === 'split') {
    return {
      type: 'split',
      direction: tree.direction,
      ratio: tree.ratio,
      children: [serialize(tree.children[0]), serialize(tree.children[1])],
    };
  }
  return tree;
}

/**
 * Deserialize a JSON object to a SplitNode. Returns null for invalid data.
 * @param {*} data
 * @returns {object|null}
 */
export function deserialize(data) {
  if (!data || typeof data !== 'object' || !data.type) return null;
  if (data.type === 'leaf') {
    if (typeof data.instanceId !== 'string') return null;
    return { type: 'leaf', instanceId: data.instanceId };
  }
  if (data.type === 'split') {
    if (!Array.isArray(data.children) || data.children.length !== 2) return null;
    const left = deserialize(data.children[0]);
    const right = deserialize(data.children[1]);
    if (!left || !right) return null;
    return {
      type: 'split',
      direction: data.direction || 'horizontal',
      ratio: typeof data.ratio === 'number' ? data.ratio : 0.5,
      children: [left, right],
    };
  }
  return null;
}
