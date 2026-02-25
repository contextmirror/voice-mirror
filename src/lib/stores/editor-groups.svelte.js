/**
 * editor-groups.svelte.js -- Svelte 5 reactive store for editor group layout.
 *
 * Manages a binary tree of editor groups (splits) supporting arbitrary
 * horizontal/vertical nesting (VS Code-style grid layout).
 *
 * Grid node types:
 *   GridLeaf   = { type: 'leaf', groupId: number }
 *   GridBranch = { type: 'branch', direction: 'horizontal'|'vertical', ratio: number, children: [GridNode, GridNode] }
 */

// ============ Tree Utilities ============

/**
 * Find a leaf node by groupId.
 * @param {object} node - Grid node (leaf or branch)
 * @param {number} groupId
 * @returns {object|null} The leaf node, or null
 */
export function findLeaf(node, groupId) {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? node : null;
  }
  return findLeaf(node.children[0], groupId) || findLeaf(node.children[1], groupId);
}

/**
 * Return a new tree with the leaf matching groupId replaced by replacement.
 * Returns null if groupId not found (tree unchanged).
 * @param {object} node
 * @param {number} groupId
 * @param {object} replacement
 * @returns {object|null}
 */
export function replaceLeaf(node, groupId, replacement) {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? replacement : null;
  }
  const leftResult = replaceLeaf(node.children[0], groupId, replacement);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }
  const rightResult = replaceLeaf(node.children[1], groupId, replacement);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }
  return null;
}

/**
 * Find the parent branch containing the leaf with groupId.
 * @param {object} node
 * @param {number} groupId
 * @returns {object|null} The branch node, or null
 */
export function findParentBranch(node, groupId) {
  if (node.type === 'leaf') return null;
  for (const child of node.children) {
    if (child.type === 'leaf' && child.groupId === groupId) {
      return node;
    }
  }
  return findParentBranch(node.children[0], groupId) || findParentBranch(node.children[1], groupId);
}

/**
 * Collect all groupIds from leaf nodes in the tree.
 * @param {object} node
 * @returns {number[]}
 */
export function collectLeafIds(node) {
  if (node.type === 'leaf') return [node.groupId];
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];
}

/**
 * Count the number of leaf nodes in the tree.
 * @param {object} node
 * @returns {number}
 */
export function countLeaves(node) {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

/**
 * Recursively reset all branch ratios to 0.5.
 * @param {object} node
 */
function resetRatios(node) {
  if (node.type === 'branch') {
    node.ratio = 0.5;
    resetRatios(node.children[0]);
    resetRatios(node.children[1]);
  }
}

/**
 * Find the neighboring groupId in a given direction within the tree.
 * Uses the tree structure to determine spatial relationships:
 *   - horizontal branches: children[0] is left, children[1] is right
 *   - vertical branches: children[0] is top, children[1] is bottom
 *
 * @param {object} root - Grid root node
 * @param {number} groupId - Starting groupId
 * @param {'left'|'right'|'up'|'down'} direction
 * @returns {number|null}
 */
function findNeighborInTree(root, groupId, direction) {
  // Build path from root to the leaf
  const path = [];
  function buildPath(node, target) {
    if (node.type === 'leaf') return node.groupId === target;
    if (buildPath(node.children[0], target)) {
      path.push({ node, childIdx: 0 });
      return true;
    }
    if (buildPath(node.children[1], target)) {
      path.push({ node, childIdx: 1 });
      return true;
    }
    return false;
  }
  if (!buildPath(root, groupId)) return null;

  // Walk up the path to find an ancestor where we can cross over
  const isHorizontal = direction === 'left' || direction === 'right';
  const wantChild = (direction === 'right' || direction === 'down') ? 1 : 0;

  for (const { node, childIdx } of path) {
    const branchDir = node.direction;
    const matchesAxis = (isHorizontal && branchDir === 'horizontal') ||
                        (!isHorizontal && branchDir === 'vertical');
    if (matchesAxis && childIdx !== wantChild) {
      // Cross over to the other child and pick the nearest leaf
      const nearestSide = wantChild === 1 ? 0 : 1; // pick closest edge
      return getEdgeLeaf(node.children[wantChild], branchDir, nearestSide);
    }
  }
  return null;
}

/**
 * Get the leaf at an edge of a subtree.
 * @param {object} node
 * @param {'horizontal'|'vertical'} axis - The axis we're navigating along
 * @param {number} side - 0 for left/top edge, 1 for right/bottom edge
 * @returns {number}
 */
function getEdgeLeaf(node, axis, side) {
  if (node.type === 'leaf') return node.groupId;
  // If this branch is on the same axis, pick the edge child
  if (node.direction === axis) {
    return getEdgeLeaf(node.children[side], axis, side);
  }
  // Different axis — pick first child (arbitrary, both are equally "near")
  return getEdgeLeaf(node.children[0], axis, side);
}

// ============ Store ============

import { SvelteMap } from 'svelte/reactivity';

function createEditorGroupsStore() {
  let gridRoot = $state({ type: 'leaf', groupId: 1 });
  let groups = new SvelteMap([[1, { activeTabId: null }]]);
  let focusedGroupId = $state(1);
  let nextGroupId = $state(2);
  let maximizedGroupId = $state(null);

  return {
    get gridRoot() { return gridRoot; },
    get groups() { return groups; },
    get focusedGroupId() { return focusedGroupId; },
    get hasSplit() { return gridRoot.type === 'branch'; },
    get groupCount() { return countLeaves(gridRoot); },
    get focusedGroup() { return groups.get(focusedGroupId); },
    get allGroupIds() { return collectLeafIds(gridRoot); },

    /**
     * Split a group into two panes.
     * @param {number} groupId - The group to split
     * @param {'horizontal'|'vertical'} direction - Split direction
     * @param {'after'|'before'} position - Place new pane after (right/bottom) or before (left/top)
     * @returns {number} The new group's ID
     */
    splitGroup(groupId, direction = 'horizontal', position = 'after') {
      const newId = nextGroupId;
      nextGroupId += 1;

      const oldLeaf = { type: 'leaf', groupId };
      const newLeaf = { type: 'leaf', groupId: newId };
      const children = position === 'before'
        ? [newLeaf, oldLeaf]
        : [oldLeaf, newLeaf];
      const branch = {
        type: 'branch',
        direction,
        ratio: 0.5,
        children,
      };

      const newRoot = replaceLeaf(gridRoot, groupId, branch);
      if (newRoot) {
        gridRoot = newRoot;
      }

      groups.set(newId, { activeTabId: null });

      // Clear maximize so the new split is visible
      maximizedGroupId = null;

      return newId;
    },

    /**
     * Split at the ancestor level, wrapping a parent subtree in a new branch.
     * Used for full-width/height splits (e.g., dragging to bottom between two side-by-side panes).
     *
     * Walks up from the leaf and finds the first ancestor branch whose direction
     * differs from the requested split direction (or the root). Wraps that subtree
     * in a new branch, creating a full-spanning pane.
     *
     * @param {number} groupId - A leaf groupId to anchor the search
     * @param {'horizontal'|'vertical'} direction - Split direction
     * @param {'after'|'before'} position - Place new pane after (right/bottom) or before (left/top)
     * @returns {number} The new group's ID
     */
    splitAncestor(groupId, direction, position = 'after') {
      // If no split exists, just split the leaf
      if (gridRoot.type === 'leaf') {
        return this.splitGroup(groupId, direction, position);
      }

      const newId = nextGroupId;
      nextGroupId += 1;
      const newLeaf = { type: 'leaf', groupId: newId };

      // Wrap the entire root in a new branch
      const children = position === 'before'
        ? [newLeaf, gridRoot]
        : [gridRoot, newLeaf];

      gridRoot = {
        type: 'branch',
        direction,
        ratio: 0.5,
        children,
      };

      groups.set(newId, { activeTabId: null });
      maximizedGroupId = null;

      return newId;
    },

    /**
     * Close a group, collapsing its parent branch.
     * @param {number} groupId - The group to close
     * @returns {number|null} The sibling groupId that absorbed the closed group's space, or null
     */
    closeGroup(groupId) {
      // Cannot close the last group
      if (gridRoot.type === 'leaf') return null;

      const parent = findParentBranch(gridRoot, groupId);
      if (!parent) return null;

      // Determine sibling (the child that is NOT the one being closed)
      const siblingIdx = parent.children[0].type === 'leaf' && parent.children[0].groupId === groupId ? 1 : 0;
      const sibling = parent.children[siblingIdx];

      // Get sibling's first leaf groupId (for returning)
      const siblingGroupId = sibling.type === 'leaf' ? sibling.groupId : collectLeafIds(sibling)[0];

      // Replace parent branch with sibling in the tree
      if (gridRoot === parent) {
        // Parent is the root
        gridRoot = sibling;
      } else {
        // Parent is nested — find and replace it
        const newRoot = replaceParentWithSibling(gridRoot, groupId);
        if (newRoot) {
          gridRoot = newRoot;
        }
      }

      // Remove the closed group from the map
      groups.delete(groupId);

      // Update focused group if it was the closed one
      if (focusedGroupId === groupId) {
        focusedGroupId = siblingGroupId;
      }

      // Clear maximize if the maximized group was closed or only one group remains
      if (maximizedGroupId === groupId || gridRoot.type === 'leaf') {
        maximizedGroupId = null;
      }

      return siblingGroupId;
    },

    /**
     * Set the focused (active) editor group.
     * @param {number} groupId
     */
    setFocusedGroup(groupId) {
      if (groups.has(groupId)) {
        focusedGroupId = groupId;
      }
    },

    /**
     * Set the active tab for a specific group.
     * @param {number} groupId
     * @param {string|null} tabId
     */
    setActiveTabForGroup(groupId, tabId) {
      const group = groups.get(groupId);
      if (group) {
        // Must use Map.set() to trigger Svelte $state reactivity on Map entries
        groups.set(groupId, { ...group, activeTabId: tabId });
      }
    },

    /**
     * Get the active tab ID for a specific group.
     * @param {number} groupId
     * @returns {string|null}
     */
    getActiveTabForGroup(groupId) {
      const group = groups.get(groupId);
      return group ? group.activeTabId : null;
    },

    /**
     * Reset to a single editor group (no splits).
     */
    reset() {
      gridRoot = { type: 'leaf', groupId: 1 };
      groups = new SvelteMap([[1, { activeTabId: null }]]);
      focusedGroupId = 1;
      nextGroupId = 2;
      maximizedGroupId = null;
    },

    /**
     * Update the split ratio for the branch containing a group.
     * @param {number} groupId - A leaf groupId whose parent branch ratio to update
     * @param {number} ratio - New ratio (0.0-1.0)
     */
    setRatio(groupId, ratio) {
      const parent = findParentBranch(gridRoot, groupId);
      if (parent) {
        parent.ratio = Math.max(0.1, Math.min(0.9, ratio));
      }
    },

    /**
     * Swap the two children of the branch containing the given groupId.
     * Used for "split left" / "split top" where the new content should appear first.
     * @param {number} groupId - A groupId whose parent branch children should be swapped
     */
    swapChildren(groupId) {
      const parent = findParentBranch(gridRoot, groupId);
      if (parent && parent.children.length === 2) {
        const temp = parent.children[0];
        parent.children[0] = parent.children[1];
        parent.children[1] = temp;
      }
    },

    /**
     * Reset all branch ratios to 0.5 (even widths/heights).
     */
    evenSizes() {
      resetRatios(gridRoot);
    },

    /**
     * Find the neighboring group in a given direction relative to the focused group.
     * @param {number} groupId - The starting group
     * @param {'left'|'right'|'up'|'down'} direction - Direction to look
     * @returns {number|null} The neighbor groupId, or null if none
     */
    findNeighbor(groupId, direction) {
      return findNeighborInTree(gridRoot, groupId, direction);
    },

    /**
     * Focus the neighboring group in a given direction.
     * @param {'left'|'right'|'up'|'down'} direction
     * @returns {boolean} True if focus moved
     */
    focusDirection(direction) {
      const neighbor = findNeighborInTree(gridRoot, focusedGroupId, direction);
      if (neighbor !== null) {
        focusedGroupId = neighbor;
        return true;
      }
      return false;
    },

    /**
     * Toggle maximize for the focused group.
     * When maximized, only the focused group is visible.
     * Call again to restore the full grid.
     */
    toggleMaximize() {
      if (maximizedGroupId !== null) {
        // Restore
        maximizedGroupId = null;
      } else if (gridRoot.type === 'branch') {
        maximizedGroupId = focusedGroupId;
      }
    },

    get maximizedGroupId() { return maximizedGroupId; },
  };
}

/**
 * Replace the parent branch of a leaf (identified by groupId) with the sibling node.
 * Used internally by closeGroup for nested trees.
 * @param {object} node - Current tree node
 * @param {number} groupId - The groupId whose parent branch should be collapsed
 * @returns {object|null} New tree, or null if not found
 */
function replaceParentWithSibling(node, groupId) {
  if (node.type === 'leaf') return null;

  // Check if this branch is the direct parent
  for (let i = 0; i < 2; i++) {
    const child = node.children[i];
    if (child.type === 'leaf' && child.groupId === groupId) {
      // Return the sibling
      return node.children[1 - i];
    }
  }

  // Recurse into children
  const leftResult = replaceParentWithSibling(node.children[0], groupId);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }
  const rightResult = replaceParentWithSibling(node.children[1], groupId);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }
  return null;
}

export const editorGroupsStore = createEditorGroupsStore();
