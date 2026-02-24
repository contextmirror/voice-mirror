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

// ============ Store ============

function createEditorGroupsStore() {
  let gridRoot = $state({ type: 'leaf', groupId: 1 });
  let groups = $state(new Map([[1, { activeTabId: null }]]));
  let focusedGroupId = $state(1);
  let nextGroupId = $state(2);

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
     * @returns {number} The new group's ID
     */
    splitGroup(groupId, direction = 'horizontal') {
      const newId = nextGroupId;
      nextGroupId += 1;

      const oldLeaf = { type: 'leaf', groupId };
      const newLeaf = { type: 'leaf', groupId: newId };
      const branch = {
        type: 'branch',
        direction,
        ratio: 0.5,
        children: [oldLeaf, newLeaf],
      };

      const newRoot = replaceLeaf(gridRoot, groupId, branch);
      if (newRoot) {
        gridRoot = newRoot;
      }

      groups.set(newId, { activeTabId: null });
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
        group.activeTabId = tabId;
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
      groups = new Map([[1, { activeTabId: null }]]);
      focusedGroupId = 1;
      nextGroupId = 2;
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
