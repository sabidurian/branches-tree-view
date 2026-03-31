/**
 * Branches — Layout Engine (Phase 2)
 *
 * Uses dagre to compute x/y positions for tree nodes.
 * Supports four layout directions and handles re-layout on expand/collapse.
 */

import dagre from 'dagre';
import type { TreeNode, TreeConfig, LayoutResult } from './types';

/**
 * Reorder a group of sibling nodes so their cross-axis positions
 * match the array order (which was pre-sorted by BranchesView).
 *
 * Collects the cross-axis coordinates dagre assigned, sorts the
 * coordinate slots ascending, then assigns them to nodes in array
 * order — effectively swapping positions to match our sort.
 *
 * @param siblings  Nodes to reorder (must share the same rank).
 * @param isVertical  true for TB/BT (swap x), false for LR/RL (swap y).
 */
function reorderGroup(siblings: TreeNode[], isVertical: boolean): void {
  if (siblings.length < 2) return;

  // Collect the cross-axis positions dagre chose
  const slots = siblings.map(n => isVertical ? n.x : n.y).sort((a, b) => a - b);

  // Assign slots in array order (array order = desired order)
  for (let i = 0; i < siblings.length; i++) {
    if (isVertical) {
      siblings[i].x = slots[i];
    } else {
      siblings[i].y = slots[i];
    }
  }
}

/**
 * Compute layout positions for all visible (expanded) tree nodes.
 */
export function computeLayout(
  roots: TreeNode[],
  config: TreeConfig
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: config.layoutDirection,
    ranksep: config.rankSep,
    nodesep: config.nodeSep,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add visible nodes (respecting expanded state).
  // DAG-aware: a node may be reachable via multiple parents.
  const visibleNodes: TreeNode[] = [];
  const added = new Set<string>();

  const addNode = (node: TreeNode) => {
    if (added.has(node.id)) return;
    added.add(node.id);
    visibleNodes.push(node);
    g.setNode(node.id, { width: node.width, height: node.height });
    if (node.expanded) {
      for (const child of node.children) {
        addNode(child);
      }
    }
  };

  for (const root of roots) {
    addNode(root);
  }

  // Add edges: for each visible node, draw an edge from each of its parents
  for (const node of visibleNodes) {
    for (const pid of node.parentIds) {
      if (added.has(pid)) {
        g.setEdge(pid, node.id);
      }
    }
  }

  // Run layout
  dagre.layout(g);

  // Read back positions
  for (const node of visibleNodes) {
    const layoutNode = g.node(node.id);
    if (layoutNode) {
      // dagre returns center coordinates; convert to top-left
      node.x = layoutNode.x - node.width / 2;
      node.y = layoutNode.y - node.height / 2;
    }
  }

  // ── Post-dagre sibling reorder ──
  // dagre's barycenter heuristic ignores our desired child order.
  // Fix: for each parent's children, collect the cross-axis positions
  // dagre assigned, sort those slots, then redistribute them to
  // children in the order defined by parent.children[] (which was
  // already sorted by BranchesView.sortChildren).
  const isVertical = config.layoutDirection === 'TB' || config.layoutDirection === 'BT';
  const nodeById = new Map<string, TreeNode>();
  for (const n of visibleNodes) nodeById.set(n.id, n);

  // Also reorder roots (they have no parent but share rank 0)
  reorderGroup(roots, isVertical);

  // Reorder each parent's visible children
  for (const node of visibleNodes) {
    if (!node.expanded || node.children.length < 2) continue;
    // Only consider children that are actually in the layout
    const visibleChildren = node.children.filter(c => added.has(c.id));
    if (visibleChildren.length < 2) continue;
    reorderGroup(visibleChildren, isVertical);
  }

  // Compute bounding box
  const graph = g.graph();
  const boundingBox = {
    width: (graph.width ?? 0),
    height: (graph.height ?? 0),
  };

  return { nodes: visibleNodes, boundingBox };
}

/**
 * Compute the zoom and pan needed to fit all nodes in the viewport.
 */
export function fitToView(
  boundingBox: { width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  padding = 40
): { zoom: number; panX: number; panY: number } {
  const availW = viewportWidth - padding * 2;
  const availH = viewportHeight - padding * 2;

  if (boundingBox.width === 0 || boundingBox.height === 0) {
    return { zoom: 1, panX: 0, panY: 0 };
  }

  const zoomX = availW / boundingBox.width;
  const zoomY = availH / boundingBox.height;
  const zoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.15), 2.0);

  const panX = (viewportWidth - boundingBox.width * zoom) / 2;
  const panY = (viewportHeight - boundingBox.height * zoom) / 2;

  return { zoom, panX, panY };
}

/**
 * Compute the pan needed to center a specific node in the viewport.
 */
export function focusOnNode(
  node: TreeNode,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { panX: number; panY: number } {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;

  return {
    panX: viewportWidth / 2 - centerX * zoom,
    panY: viewportHeight / 2 - centerY * zoom,
  };
}

/**
 * Compute an SVG smoothstep path between two nodes.
 * Draws a rounded right-angle connector.
 *
 * sourceOffset / targetOffset: fractional position (0–1) along the
 * connection edge of each node. 0.5 = center (default). Used to
 * spread apart multiple edges arriving at the same node.
 */
export function computeSmoothstepPath(
  source: TreeNode,
  target: TreeNode,
  direction: 'TB' | 'BT' | 'LR' | 'RL',
  radius = 8,
  sourceOffset = 0.5,
  targetOffset = 0.5,
  midShift = 0
): string {
  let sx: number, sy: number, tx: number, ty: number;

  // Padding inset so lines don't start/end at the very corners
  const pad = 12;

  switch (direction) {
    case 'TB':
      sx = source.x + pad + (source.width - pad * 2) * sourceOffset;
      sy = source.y + source.height;
      tx = target.x + pad + (target.width - pad * 2) * targetOffset;
      ty = target.y;
      break;
    case 'BT':
      sx = source.x + pad + (source.width - pad * 2) * sourceOffset;
      sy = source.y;
      tx = target.x + pad + (target.width - pad * 2) * targetOffset;
      ty = target.y + target.height;
      break;
    case 'LR':
      sx = source.x + source.width;
      sy = source.y + pad + (source.height - pad * 2) * sourceOffset;
      tx = target.x;
      ty = target.y + pad + (target.height - pad * 2) * targetOffset;
      break;
    case 'RL':
      sx = source.x;
      sy = source.y + pad + (source.height - pad * 2) * sourceOffset;
      tx = target.x + target.width;
      ty = target.y + pad + (target.height - pad * 2) * targetOffset;
      break;
  }

  // Determine if the path is primarily vertical or horizontal
  const isVertical = direction === 'TB' || direction === 'BT';

  // Minimum vertical stem length at each end so horizontal lanes
  // from other edges never obscure the connection to a node.
  const stemMin = 10;

  if (isVertical) {
    // midShift offsets the horizontal segment so parallel edges don't overlap
    const rawMidY = (sy + ty) / 2 + midShift;
    // Clamp so we always have ≥stemMin px of vertical stem at each end
    const yLow = Math.min(sy, ty) + stemMin;
    const yHigh = Math.max(sy, ty) - stemMin;
    const midY = Math.max(yLow, Math.min(yHigh, rawMidY));
    const dx = tx - sx;
    const dy1 = midY - sy;
    const dy2 = ty - midY;
    const r = Math.min(radius, Math.abs(dx) / 2, Math.abs(dy1), Math.abs(dy2));

    if (Math.abs(dx) < 1) {
      // Straight vertical line
      return `M ${sx} ${sy} L ${tx} ${ty}`;
    }

    const xDir = dx > 0 ? 1 : -1;
    const yDir1 = dy1 > 0 ? 1 : -1;
    const yDir2 = dy2 > 0 ? 1 : -1;

    return [
      `M ${sx} ${sy}`,
      `L ${sx} ${midY - r * yDir1}`,
      `Q ${sx} ${midY} ${sx + r * xDir} ${midY}`,
      `L ${tx - r * xDir} ${midY}`,
      `Q ${tx} ${midY} ${tx} ${midY + r * yDir2}`,
      `L ${tx} ${ty}`,
    ].join(' ');
  } else {
    const rawMidX = (sx + tx) / 2 + midShift;
    const xLow = Math.min(sx, tx) + stemMin;
    const xHigh = Math.max(sx, tx) - stemMin;
    const midX = Math.max(xLow, Math.min(xHigh, rawMidX));
    const dy = ty - sy;
    const dx1 = midX - sx;
    const dx2 = tx - midX;
    const r = Math.min(radius, Math.abs(dy) / 2, Math.abs(dx1), Math.abs(dx2));

    if (Math.abs(dy) < 1) {
      return `M ${sx} ${sy} L ${tx} ${ty}`;
    }

    const yDir = dy > 0 ? 1 : -1;
    const xDir1 = dx1 > 0 ? 1 : -1;
    const xDir2 = dx2 > 0 ? 1 : -1;

    return [
      `M ${sx} ${sy}`,
      `L ${midX - r * xDir1} ${sy}`,
      `Q ${midX} ${sy} ${midX} ${sy + r * yDir}`,
      `L ${midX} ${ty - r * yDir}`,
      `Q ${midX} ${ty} ${midX + r * xDir2} ${ty}`,
      `L ${tx} ${ty}`,
    ].join(' ');
  }
}

/**
 * Palette of visually distinct edge colors for multi-parent relationships.
 * Chosen for readability on both light and dark backgrounds.
 */
export const EDGE_PALETTE = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#a855f7', // purple
];
