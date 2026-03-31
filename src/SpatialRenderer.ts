/**
 * Branches — Spatial Tree Renderer (Phase 3)
 *
 * Renders the tree as positioned card nodes on a pannable/zoomable canvas
 * with SVG connector edges. Notion-inspired visual style.
 */

import { setIcon } from 'obsidian';
import type { TreeNode, TreeConfig } from './types';
import { computeLayout, fitToView, computeSmoothstepPath, EDGE_PALETTE } from './layoutEngine';
import type { LayoutResult } from './types';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.08;

export class SpatialRenderer {
  private container: HTMLElement;
  private canvasWrapper: HTMLElement;
  private nodesLayer: HTMLElement;
  private edgesSvg: SVGSVGElement;
  private controlsBar: HTMLElement;

  private nodeElements = new Map<string, HTMLElement>();
  private roots: TreeNode[] = [];
  private nodeMap = new Map<string, TreeNode>();
  private config: TreeConfig;
  private layout: LayoutResult | null = null;

  // Spacing mode: affects edge gap AND dagre rank/node separation
  private edgeSpacing: 'compact' | 'expanded' = 'compact';
  private get edgeGap(): number { return this.edgeSpacing === 'compact' ? 8 : 48; }
  private baseConfig: TreeConfig | null = null; // original config before spacing overrides

  // Shared abort controller for event listeners (cleanup on destroy)
  private abortController = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private hasFittedOnce = false;

  // Pan/zoom state
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartPanX = 0;
  private panStartPanY = 0;

  // Selection
  private selectedNodeId: string | null = null;

  // Locked mode: disables all drag-to-create / drag-to-link functionality
  private locked = false;

  // Free-arrange mode: user can drag cards to reposition them
  private freeArrange = false;
  private nodeDragState: {
    active: boolean;
    node: TreeNode;
    el: HTMLElement;
    startX: number;  // pointer start (client coords)
    startY: number;
    nodeStartX: number; // node position at drag start
    nodeStartY: number;
    moved: boolean;    // true if pointer moved > threshold
    pointerId: number;
  } | null = null;

  // Callbacks
  private onNodeClick: (node: TreeNode) => void;
  private onNodeOpen: (node: TreeNode) => void;
  private onLink: (sourceId: string, targetId: string, mode: 'parent' | 'child') => void;
  private onCreate: (sourceId: string, newName: string, mode: 'parent' | 'child') => void;
  private onPartnerLink: ((sourceId: string, targetId: string) => void) | null;
  private onCreatePartner: ((sourceId: string, newName: string) => void) | null;
  private onNodeMoved: ((nodeId: string, x: number, y: number) => void) | null;
  private onContextMenu: ((node: TreeNode, event: MouseEvent) => void) | null = null;

  // Stored positions to apply after layout (from persistence layer)
  private storedPositions: Record<string, { x: number; y: number }> = {};

  // Whether edges should animate in (set true on full render, false during drag)
  private animateEdges = false;

  // Drag-to-link state
  private dragState: {
    active: boolean;
    sourceNode: TreeNode;
    mode: 'parent' | 'child' | 'partner';
    ghostLine: SVGLineElement | null;
    startX: number;
    startY: number;
  } | null = null;

  constructor(
    parentEl: HTMLElement,
    config: TreeConfig,
    onNodeClick: (node: TreeNode) => void,
    onNodeOpen: (node: TreeNode) => void,
    onLink: (sourceId: string, targetId: string, mode: 'parent' | 'child') => void,
    onCreate: (sourceId: string, newName: string, mode: 'parent' | 'child') => void,
    onPartnerLink: ((sourceId: string, targetId: string) => void) | null = null,
    onCreatePartner: ((sourceId: string, newName: string) => void) | null = null,
    onNodeMoved: ((nodeId: string, x: number, y: number) => void) | null = null,
    storedPositions: Record<string, { x: number; y: number }> = {}
  ) {
    this.config = config;
    this.onNodeClick = onNodeClick;
    this.onNodeOpen = onNodeOpen;
    this.onLink = onLink;
    this.onCreate = onCreate;
    this.onPartnerLink = onPartnerLink;
    this.onCreatePartner = onCreatePartner;
    this.onNodeMoved = onNodeMoved;
    this.storedPositions = storedPositions;

    // Build DOM structure
    this.container = parentEl.createDiv({ cls: 'branches-spatial' });
    if (config.showDotGrid) {
      this.container.classList.add('branches-spatial--dotgrid');
    }

    this.canvasWrapper = this.container.createDiv({ cls: 'branches-canvas-wrapper' });

    // SVG edges layer (below nodes)
    this.edgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.edgesSvg.classList.add('branches-edges');
    this.edgesSvg.setAttribute('width', '100%');
    this.edgesSvg.setAttribute('height', '100%');
    this.edgesSvg.style.position = 'absolute';
    this.edgesSvg.style.top = '0';
    this.edgesSvg.style.left = '0';
    this.edgesSvg.style.pointerEvents = 'none';
    this.edgesSvg.style.overflow = 'visible';
    this.canvasWrapper.appendChild(this.edgesSvg);

    // Nodes layer
    this.nodesLayer = this.canvasWrapper.createDiv({ cls: 'branches-nodes' });

    // Controls
    this.controlsBar = this.container.createDiv({ cls: 'branches-controls' });
    this.buildControls();

    // Event listeners
    this.setupPanZoom();
    this.setupKeyboard();

    // ResizeObserver: when embedded, the container may start with 0 dimensions.
    // Re-run autoFit once it gains size so nodes are positioned correctly.
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.hasFittedOnce) {
          this.hasFittedOnce = true;
          this.autoFit();
        }
      }
    });
    this.resizeObserver.observe(this.container);
  }

  // ─── Public API ────────────────────────────────────────────

  render(roots: TreeNode[], nodeMap: Map<string, TreeNode>): void {
    this.roots = roots;
    this.nodeMap = nodeMap;
    if (!this.baseConfig) this.baseConfig = { ...this.config };
    this.applySpacingToConfig();
    this.doLayout();
    // Full rebuild on initial render / data change
    this.rebuildNodes();
    this.animateEdges = true;
    this.renderEdges();
    this.animateEdges = false;
    this.autoFit();
  }

  setEdgeSpacing(mode: 'compact' | 'expanded'): void {
    this.edgeSpacing = mode;
    this.applySpacingToConfig();
    this.doLayout();
    this.rebuildNodes();
    this.renderEdges();
    this.autoFit();
  }

  private applySpacingToConfig(): void {
    if (!this.baseConfig) return;
    if (this.edgeSpacing === 'expanded') {
      this.config = {
        ...this.baseConfig,
        rankSep: this.baseConfig.rankSep * 2.5,
        nodeSep: this.baseConfig.nodeSep * 2,
      };
    } else {
      this.config = { ...this.baseConfig };
    }
  }

  getEdgeSpacing(): 'compact' | 'expanded' {
    return this.edgeSpacing;
  }

  setFreeArrange(on: boolean): void {
    this.freeArrange = on;
    // Visual hint: change cursor on all node cards
    for (const el of this.nodeElements.values()) {
      el.style.cursor = on ? 'grab' : '';
    }
  }

  getFreeArrange(): boolean {
    return this.freeArrange;
  }

  setLocked(on: boolean): void {
    this.locked = on;
    this.container.classList.toggle('branches-spatial--locked', on);
  }

  getLocked(): boolean {
    return this.locked;
  }

  setContextMenuHandler(handler: (node: TreeNode, event: MouseEvent) => void): void {
    this.onContextMenu = handler;
  }

  /** Public entry point for showing the create-note input at a canvas position. */
  showCreateInputPublic(
    cx: number, cy: number,
    sourceId: string, mode: 'parent' | 'child' | 'partner'
  ): void {
    this.showCreateInput(cx, cy, sourceId, mode);
  }

  selectNode(id: string | null): void {
    // Deselect previous
    if (this.selectedNodeId) {
      const prev = this.nodeElements.get(this.selectedNodeId);
      if (prev) prev.classList.remove('branches-node--selected');
    }
    this.selectedNodeId = id;
    if (id) {
      const el = this.nodeElements.get(id);
      if (el) el.classList.add('branches-node--selected');
    }
  }

  /** Clear all stored positions and re-render with pure dagre layout. */
  resetPositions(): void {
    this.storedPositions = {};
    if (this.freeArrange) {
      this.freeArrange = false;
      for (const el of this.nodeElements.values()) {
        el.style.cursor = '';
      }
    }
    this.doLayout();
    this.rebuildNodes();
    this.renderEdges();
    this.autoFit();
  }

  destroy(): void {
    this.abortController.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.nodeElements.clear();
    this.nodeMap.clear();
    this.roots = [];
    this.storedPositions = {};
    this.nodeDragState = null;
    this.dragState = null;
    this.layout = null;
    this.container.remove();
  }

  // ─── Layout ────────────────────────────────────────────────

  private doLayout(): void {
    this.layout = computeLayout(this.roots, this.config);

    // Apply persisted manual positions (override dagre for nodes that were moved)
    if (Object.keys(this.storedPositions).length > 0 && this.layout) {
      const MAX_COORD = 100_000;
      for (const node of this.layout.nodes) {
        const stored = this.storedPositions[node.id];
        if (stored && isFinite(stored.x) && isFinite(stored.y)) {
          node.x = Math.max(-MAX_COORD, Math.min(MAX_COORD, stored.x));
          node.y = Math.max(-MAX_COORD, Math.min(MAX_COORD, stored.y));
        }
      }
    }

    // Size the SVG to match layout bounding box
    // Recalculate if stored positions pushed nodes beyond dagre's bounding box
    if (this.layout) {
      let maxX = 0, maxY = 0;
      for (const node of this.layout.nodes) {
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
      const bb = {
        width: Math.max(this.layout.boundingBox.width, maxX + 40),
        height: Math.max(this.layout.boundingBox.height, maxY + 40),
      };
      this.layout.boundingBox = bb;
      this.edgesSvg.setAttribute('viewBox', `0 0 ${bb.width} ${bb.height}`);
      this.edgesSvg.style.width = `${bb.width}px`;
      this.edgesSvg.style.height = `${bb.height}px`;
      this.nodesLayer.style.width = `${bb.width}px`;
      this.nodesLayer.style.height = `${bb.height}px`;
    }
  }

  private autoFit(): void {
    if (!this.layout) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.hasFittedOnce = true;
    const fit = fitToView(this.layout.boundingBox, rect.width, rect.height);
    this.zoom = fit.zoom;
    this.panX = fit.panX;
    this.panY = fit.panY;
    this.applyTransform();
  }

  // ─── Node rendering ────────────────────────────────────────

  /** Full DOM rebuild — used on initial render and data changes. */
  private rebuildNodes(): void {
    this.nodesLayer.empty();
    this.nodeElements.clear();

    if (!this.layout) return;

    for (const node of this.layout.nodes) {
      const el = this.createNodeElement(node);
      this.nodesLayer.appendChild(el);
      this.nodeElements.set(node.id, el);
    }
  }

  /** Animated update — reuses existing elements, transitions positions. */
  private renderNodes(): void {
    if (!this.layout) {
      this.nodesLayer.empty();
      this.nodeElements.clear();
      return;
    }

    const newIds = new Set(this.layout.nodes.map(n => n.id));

    // Remove nodes that are no longer in the layout
    for (const [id, el] of this.nodeElements) {
      if (!newIds.has(id)) {
        el.classList.add('branches-node--exiting');
        // Remove after the exit animation completes
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // Fallback removal in case transition doesn't fire
        setTimeout(() => { if (el.isConnected) el.remove(); }, 350);
        this.nodeElements.delete(id);
      }
    }

    // Add or update nodes
    for (const node of this.layout.nodes) {
      const existing = this.nodeElements.get(node.id);
      if (existing) {
        // Update position with CSS transition (already defined on .branches-node)
        existing.style.transform = `translate(${node.x}px, ${node.y}px)`;
        existing.style.width = `${node.width}px`;
        existing.style.height = `${node.height}px`;
      } else {
        // New node: create and add
        const el = this.createNodeElement(node);
        el.classList.add('branches-node--entering');
        this.nodesLayer.appendChild(el);
        this.nodeElements.set(node.id, el);
        // Trigger enter animation after paint
        requestAnimationFrame(() => {
          el.classList.remove('branches-node--entering');
        });
      }
    }
  }

  private createNodeElement(node: TreeNode): HTMLElement {
    const el = document.createElement('div');
    el.className = 'branches-node';
    el.dataset.id = node.id;
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;
    if (this.freeArrange) el.style.cursor = 'grab';

    const signal = this.abortController.signal;

    // Expand/collapse button
    if (node.children.length > 0) {
      const expandBtn = el.createDiv({ cls: 'branches-node-expand' });
      setIcon(expandBtn, node.expanded ? 'chevron-down' : 'chevron-right');
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleExpand(node);
      }, { signal });
    }

    // Color indicator stripe on left edge
    if (node.color) {
      const stripe = el.createDiv({ cls: 'branches-node-color' });
      stripe.style.background = node.color;
    }

    // Content area
    const content = el.createDiv({ cls: 'branches-node-content' });
    content.createDiv({ cls: 'branches-node-title', text: node.title });

    // Subtitle line (truncated)
    if (node.subtitle) {
      content.createDiv({ cls: 'branches-node-subtitle', text: node.subtitle });
    }

    // Secondary subtitle line
    if (node.subtitle2) {
      content.createDiv({ cls: 'branches-node-subtitle branches-node-subtitle2', text: node.subtitle2 });
    }

    // Right section: avatar (if image set) and/or child count badge
    const showBadge = this.config.showChildCount && node.children.length > 0;
    if (node.imageUrl) {
      const isRoundedSquare = this.config.avatarShape === 'rounded-square';
      const avatarCls = isRoundedSquare
        ? 'branches-node-avatar-wrap branches-node-avatar-wrap--square'
        : 'branches-node-avatar-wrap';
      const avatarWrap = el.createDiv({ cls: avatarCls });
      const imgCls = isRoundedSquare
        ? 'branches-node-avatar branches-node-avatar--square'
        : 'branches-node-avatar';
      avatarWrap.createEl('img', {
        cls: imgCls,
        attr: { src: node.imageUrl, alt: node.title, draggable: 'false' },
      });
      if (showBadge) {
        const badge = avatarWrap.createDiv({ cls: 'branches-node-badge branches-node-badge--overlay' });
        badge.textContent = `${node.children.length}`;
      }
    } else if (showBadge) {
      const badge = el.createDiv({ cls: 'branches-node-badge' });
      badge.textContent = `${node.children.length}`;
    }

    // Drag handle placement depends on layout direction:
    // TB/BT: parent/child on top/bottom, partner on left/right
    // LR/RL: parent/child on left/right, partner on top/bottom
    const dir = this.config.layoutDirection;
    const isVerticalFlow = dir === 'TB' || dir === 'BT';

    // Parent handle: upstream edge; Child handle: downstream edge
    const parentSide = dir === 'TB' ? 'top' : dir === 'BT' ? 'bottom' : dir === 'LR' ? 'left' : 'right';
    const childSide = dir === 'TB' ? 'bottom' : dir === 'BT' ? 'top' : dir === 'LR' ? 'right' : 'left';
    const partnerSides = isVerticalFlow ? ['left', 'right'] : ['top', 'bottom'];

    const parentHandle = el.createDiv({ cls: `branches-drag-handle branches-drag-handle--${parentSide}` });
    const childHandle = el.createDiv({ cls: `branches-drag-handle branches-drag-handle--${childSide}` });

    parentHandle.addEventListener('pointerdown', (e) => {
      if (this.locked) return;
      e.stopPropagation();
      e.preventDefault();
      this.startDrag(node, 'parent', e);
    }, { signal });

    childHandle.addEventListener('pointerdown', (e) => {
      if (this.locked) return;
      e.stopPropagation();
      e.preventDefault();
      this.startDrag(node, 'child', e);
    }, { signal });

    // Partner handles on the perpendicular axis (only if partnership property is configured)
    if (this.onPartnerLink) {
      for (const side of partnerSides) {
        const handle = el.createDiv({ cls: `branches-drag-handle branches-drag-handle--${side}` });
        handle.addEventListener('pointerdown', (e) => {
          if (this.locked) return;
          e.stopPropagation();
          e.preventDefault();
          this.startDrag(node, 'partner', e);
        }, { signal });
      }
    }

    // Pointer handling: free-arrange drag OR click-to-open
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      // Ignore if the event originated on a drag handle (link handles)
      if ((e.target as HTMLElement).closest('.branches-drag-handle')) return;
      if ((e.target as HTMLElement).closest('.branches-node-expand')) return;

      if (this.freeArrange) {
        e.stopPropagation();
        e.preventDefault();
        this.nodeDragState = {
          active: true,
          node,
          el,
          startX: e.clientX,
          startY: e.clientY,
          nodeStartX: node.x,
          nodeStartY: node.y,
          moved: false,
          pointerId: e.pointerId,
        };
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
        el.style.zIndex = '10';
      }
    }, { signal });

    el.addEventListener('pointermove', (e) => {
      if (!this.nodeDragState || this.nodeDragState.node.id !== node.id) return;
      const dx = (e.clientX - this.nodeDragState.startX) / this.zoom;
      const dy = (e.clientY - this.nodeDragState.startY) / this.zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.nodeDragState.moved = true;
      }
      node.x = this.nodeDragState.nodeStartX + dx;
      node.y = this.nodeDragState.nodeStartY + dy;
      el.style.transform = `translate(${node.x}px, ${node.y}px)`;
      // Re-render edges to follow the moved card
      this.renderEdges();
    }, { signal });

    el.addEventListener('pointerup', (e) => {
      if (this.nodeDragState && this.nodeDragState.node.id === node.id) {
        const wasMoved = this.nodeDragState.moved;
        el.releasePointerCapture(this.nodeDragState.pointerId);
        el.style.cursor = this.freeArrange ? 'grab' : '';
        el.style.zIndex = '';
        this.nodeDragState = null;
        if (wasMoved) {
          // Persist the new position
          this.storedPositions[node.id] = { x: node.x, y: node.y };
          this.onNodeMoved?.(node.id, node.x, node.y);
        } else {
          // Treat as click
          this.selectNode(node.id);
          this.onNodeClick(node);
        }
        return;
      }
    }, { signal });

    // Click: select and open (only fires if not in free-arrange, or on short press)
    el.addEventListener('click', (e) => {
      if (this.freeArrange) return; // handled by pointerup
      this.selectNode(node.id);
      this.onNodeClick(node);
    }, { signal });

    // Double-click: open note
    el.addEventListener('dblclick', () => {
      this.onNodeOpen(node);
    }, { signal });

    // Right-click: context menu
    el.addEventListener('contextmenu', (e) => {
      if (this.onContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        this.onContextMenu(node, e);
      }
    }, { signal });

    // Hover tooltip with configured properties
    const tooltipLines = this.buildTooltipLines(node);
    if (tooltipLines.length > 0) {
      const tooltip = el.createDiv({ cls: 'branches-tooltip' });
      for (const line of tooltipLines) {
        const row = tooltip.createDiv({ cls: 'branches-tooltip-row' });
        row.createSpan({ cls: 'branches-tooltip-label', text: line.label });
        row.createSpan({ cls: 'branches-tooltip-value', text: line.value });
      }
    }

    if (node.id === this.selectedNodeId) {
      el.classList.add('branches-node--selected');
    }

    return el;
  }

  // ─── Tooltip ───────────────────────────────────────────────

  /** Strip [[wiki-link]] brackets, returning display text. */
  private static stripWikiLinks(text: string): string {
    return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_m, target, alias) => alias ?? target);
  }

  private buildTooltipLines(node: TreeNode): { label: string; value: string }[] {
    const lines: { label: string; value: string }[] = [];
    const props = this.config.tooltipProperties;

    if (props.length > 0) {
      for (const prop of props) {
        const stripped = prop.startsWith('note.') ? prop.slice(5) : prop;
        let val = node.properties[prop] ?? node.properties[stripped];
        if (val == null) continue;
        // Unwrap Bases-style { data: [...] } wrappers
        if (val && typeof val === 'object' && !Array.isArray(val) && 'data' in val) {
          val = val.data;
        }
        // Format arrays
        if (Array.isArray(val)) {
          val = val.map((v: any) => {
            if (v && typeof v === 'object' && ('path' in v || 'display' in v)) {
              return v.display ?? v.path ?? String(v);
            }
            return String(v);
          }).join(', ');
        }
        const display = SpatialRenderer.stripWikiLinks(String(val).trim());
        if (!display) continue;

        const label = stripped.charAt(0).toUpperCase() + stripped.slice(1);
        lines.push({ label, value: display });
      }
    }

    return lines;
  }

  // ─── Edge rendering ────────────────────────────────────────

  /** Apply draw-in animation to an SVG path if animations are enabled. */
  private applyEdgeAnimation(path: SVGPathElement, delayMs = 0): void {
    if (!this.animateEdges) return;
    // Skip animation on dashed edges (uncertain parentage, partnership) since
    // stroke-dasharray is already used for the visual pattern.
    if (path.getAttribute('stroke-dasharray')) return;
    // Measure the path length and use stroke-dasharray trick
    const len = path.getTotalLength();
    path.style.setProperty('--edge-length', String(len));
    path.setAttribute('stroke-dasharray', String(len));
    path.setAttribute('stroke-dashoffset', String(len));
    path.classList.add('branches-edge--animated');
    if (delayMs > 0) {
      path.style.animationDelay = `${delayMs}ms`;
    }
  }

  /**
   * Assigns a stable color index to every parent node that participates
   * in at least one multi-parent relationship.
   */
  private buildParentColorMap(): Map<string, number> {
    const map = new Map<string, number>();
    if (!this.layout) return map;
    let idx = 0;
    // Collect all parents involved in multi-parent edges
    for (const node of this.layout.nodes) {
      if (node.parentIds.length > 1) {
        for (const pid of node.parentIds) {
          if (!map.has(pid)) {
            map.set(pid, idx++ % EDGE_PALETTE.length);
          }
        }
      }
    }
    return map;
  }

  /**
   * Ensure the SVG <defs> block contains shared marker definitions:
   *  - branches-arrow: small arrowhead for parent→child edges
   *  - branches-dot: circle for partnership edge endpoints
   *
   * Markers use `context-stroke` so they inherit the edge's color.
   */
  private ensureMarkerDefs(): void {
    let defs = this.edgesSvg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      this.edgesSvg.prepend(defs);
    }

    // Arrow marker (6×6, pointing right, filled with edge stroke color)
    if (!defs.querySelector('#branches-arrow')) {
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      arrow.setAttribute('id', 'branches-arrow');
      arrow.setAttribute('viewBox', '0 0 6 6');
      arrow.setAttribute('refX', '5');
      arrow.setAttribute('refY', '3');
      arrow.setAttribute('markerWidth', '6');
      arrow.setAttribute('markerHeight', '6');
      arrow.setAttribute('markerUnits', 'userSpaceOnUse');
      arrow.setAttribute('orient', 'auto-start-reverse');
      const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrowPath.setAttribute('d', 'M 0 0 L 6 3 L 0 6 z');
      arrowPath.setAttribute('fill', 'context-stroke');
      arrow.appendChild(arrowPath);
      defs.appendChild(arrow);
    }

    // Dot marker (circle, filled with edge stroke color)
    if (!defs.querySelector('#branches-dot')) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      dot.setAttribute('id', 'branches-dot');
      dot.setAttribute('viewBox', '0 0 6 6');
      dot.setAttribute('refX', '3');
      dot.setAttribute('refY', '3');
      dot.setAttribute('markerWidth', '5');
      dot.setAttribute('markerHeight', '5');
      dot.setAttribute('markerUnits', 'userSpaceOnUse');
      dot.setAttribute('orient', 'auto');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '3');
      circle.setAttribute('cy', '3');
      circle.setAttribute('r', '2.5');
      circle.setAttribute('fill', 'context-stroke');
      dot.appendChild(circle);
      defs.appendChild(dot);
    }
  }

  private renderEdges(): void {
    // Clear existing edges
    while (this.edgesSvg.firstChild) {
      this.edgesSvg.removeChild(this.edgesSvg.firstChild);
    }

    if (!this.layout) return;

    this.ensureMarkerDefs();

    const direction = this.config.layoutDirection;
    const parentColors = this.buildParentColorMap();

    // Pre-compute: for each multi-parent child, which of its parents are
    // actually visible? We need this to compute connection-point offsets.
    const visibleParentsOf = new Map<string, string[]>();
    for (const node of this.layout.nodes) {
      if (node.parentIds.length > 1) {
        const visible = node.parentIds.filter(pid => this.nodeElements.has(pid) && this.nodeMap.has(pid));
        visibleParentsOf.set(node.id, visible);
      }
    }

    // Also track how many multi-parent children each parent has, to
    // spread departure points on the parent's bottom edge.
    const parentChildSlots = new Map<string, { count: number; next: number }>();
    for (const [childId, visPids] of visibleParentsOf.entries()) {
      for (const pid of visPids) {
        if (!parentChildSlots.has(pid)) {
          // Count total multi-parent children of this parent that are visible
          const parent = this.nodeMap.get(pid);
          if (!parent) continue;
          const mpChildren = parent.children.filter(c =>
            c.parentIds.length > 1 && this.nodeElements.has(c.id)
          );
          parentChildSlots.set(pid, { count: mpChildren.length, next: 0 });
        }
      }
    }

    // Two-pass: regular edges first, colored multi-parent edges on top
    const drawnEdges = new Set<string>();
    interface DeferredEdge {
      parentNode: TreeNode;
      node: TreeNode;
      color: string;
      sourceOffset: number;
      targetOffset: number;
      levelKey: string; // groups edges that share the same vertical span
    }
    const deferred: DeferredEdge[] = [];

    for (const node of this.layout.nodes) {
      const isMulti = node.parentIds.length > 1;

      for (const pid of node.parentIds) {
        const edgeKey = `${pid}->${node.id}`;
        if (drawnEdges.has(edgeKey)) continue;
        if (!this.nodeElements.has(pid)) continue;

        const parentNode = this.nodeMap.get(pid);
        if (!parentNode) continue;
        drawnEdges.add(edgeKey);

        if (isMulti) {
          const visPids = visibleParentsOf.get(node.id) ?? [pid];
          const idxInChild = visPids.indexOf(pid);
          const n = visPids.length;
          // Spread arrival points across the child's top edge
          const targetOffset = n <= 1 ? 0.5 : (idxInChild + 1) / (n + 1);

          // Spread departure points on the parent if it has multiple
          // multi-parent children
          const slot = parentChildSlots.get(pid);
          let sourceOffset = 0.5;
          if (slot && slot.count > 1) {
            sourceOffset = (slot.next + 1) / (slot.count + 1);
            slot.next++;
          }

          // Use parent's color property when available, fall back to palette
          const edgeColor = parentNode.color
            ? parentNode.color
            : EDGE_PALETTE[(parentColors.get(pid) ?? 0)];
          // Level key groups edges that share the same vertical span
          // so we can assign unique lane indices within each group
          const levelKey = `${Math.round(parentNode.y)}:${Math.round(node.y)}`;
          deferred.push({
            parentNode,
            node,
            color: edgeColor,
            sourceOffset,
            targetOffset,
            levelKey,
          });
        } else {
          // Regular single-parent edge: use parent's color or default gray
          const edgeColor = parentNode.color ?? 'var(--background-modifier-border)';
          const pathD = computeSmoothstepPath(parentNode, node, direction);
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', edgeColor);
          path.setAttribute('stroke-width', '1.5');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('marker-end', 'url(#branches-arrow)');
          // Uncertain parentage → dotted line
          if (node.parentageCertain === false) {
            path.setAttribute('stroke-dasharray', '4 4');
          }
          path.classList.add('branches-edge');
          this.edgesSvg.appendChild(path);
          this.applyEdgeAnimation(path);
        }
      }
    }

    // Group deferred edges by level, assign each a unique lane index
    const levelGroups = new Map<string, DeferredEdge[]>();
    for (const edge of deferred) {
      const group = levelGroups.get(edge.levelKey) ?? [];
      group.push(edge);
      levelGroups.set(edge.levelKey, group);
    }

    // Second pass: colored multi-parent edges rendered on top
    for (const [, group] of levelGroups) {
      const total = group.length;
      for (let i = 0; i < total; i++) {
        const { parentNode, node, color, sourceOffset, targetOffset } = group[i];
        // Each edge in the group gets a unique lane offset
        const midShift = (i - (total - 1) / 2) * this.edgeGap;
        const pathD = computeSmoothstepPath(
          parentNode, node, direction, 8, sourceOffset, targetOffset, midShift
        );
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-opacity', '0.9');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', 'url(#branches-arrow)');
        // Uncertain parentage → dotted line
        if (node.parentageCertain === false) {
          path.setAttribute('stroke-dasharray', '4 4');
        }
        path.classList.add('branches-edge--multi');
        this.edgesSvg.appendChild(path);
        this.applyEdgeAnimation(path, 80);
      }
    }

    // Third pass: partnership (dashed) edges
    this.renderPartnerEdges();
  }

  /** Counter for unique gradient IDs within the current render pass. */
  private gradientCounter = 0;

  private renderPartnerEdges(): void {
    if (!this.layout) return;

    const dir = this.config.layoutDirection;
    const isVerticalFlow = dir === 'TB' || dir === 'BT';
    const drawn = new Set<string>();
    this.gradientCounter = 0;

    // Ensure SVG has a <defs> element for gradients
    let defs = this.edgesSvg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      this.edgesSvg.prepend(defs);
    }

    // ── Collect all partnership edges ──
    interface PartnerEdge {
      nodeA: TreeNode;
      nodeB: TreeNode;
      laneKey: string;  // groups edges sharing the same cross-axis span
    }
    const edges: PartnerEdge[] = [];

    for (const node of this.layout.nodes) {
      for (const pid of node.partnerIds) {
        const key = [node.id, pid].sort().join('↔');
        if (drawn.has(key)) continue;
        drawn.add(key);

        const partner = this.nodeMap.get(pid);
        if (!partner || !this.nodeElements.has(pid)) continue;

        // Lane key: group edges that occupy the same horizontal band (TB/BT)
        // or vertical band (LR/RL) so we can offset them
        const laneKey = isVerticalFlow
          ? `${Math.round(node.y)}:${Math.round(partner.y)}`
          : `${Math.round(node.x)}:${Math.round(partner.x)}`;

        edges.push({ nodeA: node, nodeB: partner, laneKey });
      }
    }

    // ── Group by lane and assign offsets ──
    const laneGroups = new Map<string, PartnerEdge[]>();
    for (const edge of edges) {
      const group = laneGroups.get(edge.laneKey) ?? [];
      group.push(edge);
      laneGroups.set(edge.laneKey, group);
    }

    for (const [, group] of laneGroups) {
      const total = group.length;
      for (let i = 0; i < total; i++) {
        const { nodeA, nodeB } = group[i];
        // Lane offset: spread edges apart when multiple share the same span
        const laneOffset = total <= 1 ? 0 : (i - (total - 1) / 2) * this.edgeGap;

        let x1: number, y1: number, x2: number, y2: number;
        let pathD: string;

        if (isVerticalFlow) {
          const nodeCX = nodeA.x + nodeA.width / 2;
          const partnerCX = nodeB.x + nodeB.width / 2;

          if (nodeCX <= partnerCX) {
            x1 = nodeA.x + nodeA.width;
            x2 = nodeB.x;
          } else {
            x1 = nodeA.x;
            x2 = nodeB.x + nodeB.width;
          }
          y1 = nodeA.y + nodeA.height / 2 + laneOffset;
          y2 = nodeB.y + nodeB.height / 2 + laneOffset;

          const midX = (x1 + x2) / 2;
          pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        } else {
          const nodeCY = nodeA.y + nodeA.height / 2;
          const partnerCY = nodeB.y + nodeB.height / 2;

          x1 = nodeA.x + nodeA.width / 2 + laneOffset;
          x2 = nodeB.x + nodeB.width / 2 + laneOffset;

          if (nodeCY <= partnerCY) {
            y1 = nodeA.y + nodeA.height;
            y2 = nodeB.y;
          } else {
            y1 = nodeA.y;
            y2 = nodeB.y + nodeB.height;
          }

          const midY = (y1 + y2) / 2;
          pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        }

        // Determine stroke: gradient if both colored, solid if one, default if neither
        let strokeAttr = 'var(--text-muted)';
        const colorA = nodeA.color;
        const colorB = nodeB.color;

        if (colorA && colorB && colorA !== colorB) {
          const gradId = `branches-partner-grad-${this.gradientCounter++}`;
          const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
          grad.setAttribute('id', gradId);
          grad.setAttribute('gradientUnits', 'userSpaceOnUse');
          grad.setAttribute('x1', String(x1));
          grad.setAttribute('y1', String(y1));
          grad.setAttribute('x2', String(x2));
          grad.setAttribute('y2', String(y2));

          const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
          stop1.setAttribute('offset', '0%');
          stop1.setAttribute('stop-color', colorA);
          grad.appendChild(stop1);

          const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
          stop2.setAttribute('offset', '100%');
          stop2.setAttribute('stop-color', colorB);
          grad.appendChild(stop2);

          defs!.appendChild(grad);
          strokeAttr = `url(#${gradId})`;
        } else if (colorA && colorB) {
          strokeAttr = colorA;
        } else if (colorA) {
          strokeAttr = colorA;
        } else if (colorB) {
          strokeAttr = colorB;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', strokeAttr);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '6 4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('marker-start', 'url(#branches-dot)');
        path.setAttribute('marker-end', 'url(#branches-dot)');
        path.classList.add('branches-edge--partner');
        this.edgesSvg.appendChild(path);
      }
    }
  }

  // ─── Drag-to-link ───────────────────────────────────────────

  private startDrag(node: TreeNode, mode: 'parent' | 'child' | 'partner', e: PointerEvent): void {
    // Compute the drag start in canvas coordinates
    const rect = this.container.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - this.panX) / this.zoom;
    const canvasY = (e.clientY - rect.top - this.panY) / this.zoom;

    // Start point on the node edge, respecting layout direction
    const dir = this.config.layoutDirection;
    const isVerticalFlow = dir === 'TB' || dir === 'BT';
    let startX: number;
    let startY: number;

    if (mode === 'partner') {
      if (isVerticalFlow) {
        // Partner handles are on left/right
        const midX = node.x + node.width / 2;
        startX = canvasX < midX ? node.x : node.x + node.width;
        startY = node.y + node.height / 2;
      } else {
        // Partner handles are on top/bottom
        const midY = node.y + node.height / 2;
        startX = node.x + node.width / 2;
        startY = canvasY < midY ? node.y : node.y + node.height;
      }
    } else {
      // Parent/child: along the flow axis
      if (isVerticalFlow) {
        startX = node.x + node.width / 2;
        const parentIsTop = dir === 'TB';
        startY = (mode === 'parent') === parentIsTop ? node.y : node.y + node.height;
      } else {
        startY = node.y + node.height / 2;
        const parentIsLeft = dir === 'LR';
        startX = (mode === 'parent') === parentIsLeft ? node.x : node.x + node.width;
      }
    }

    // Create ghost line in the edges SVG
    const ghostLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ghostLine.setAttribute('x1', String(startX));
    ghostLine.setAttribute('y1', String(startY));
    ghostLine.setAttribute('x2', String(canvasX));
    ghostLine.setAttribute('y2', String(canvasY));
    ghostLine.setAttribute('stroke', 'var(--interactive-accent)');
    ghostLine.setAttribute('stroke-width', '2.5');
    ghostLine.setAttribute('stroke-dasharray', '6 4');
    ghostLine.setAttribute('stroke-linecap', 'round');
    ghostLine.style.pointerEvents = 'none';
    this.edgesSvg.appendChild(ghostLine);

    this.dragState = {
      active: true,
      sourceNode: node,
      mode,
      ghostLine,
      startX,
      startY,
    };

    // Mark source node
    const sourceEl = this.nodeElements.get(node.id);
    if (sourceEl) sourceEl.classList.add('branches-node--dragging');

    // Set up global listeners
    const onMove = (ev: PointerEvent) => this.onDragMove(ev);
    const onUp = (ev: PointerEvent) => {
      this.onDragEnd(ev);
      this.container.removeEventListener('pointermove', onMove);
      this.container.removeEventListener('pointerup', onUp);
    };
    this.container.addEventListener('pointermove', onMove);
    this.container.addEventListener('pointerup', onUp);
    this.container.setPointerCapture(e.pointerId);

    // Change cursor
    this.container.style.cursor = 'crosshair';
  }

  private onDragMove(e: PointerEvent): void {
    if (!this.dragState?.active || !this.dragState.ghostLine) return;

    const rect = this.container.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - this.panX) / this.zoom;
    const canvasY = (e.clientY - rect.top - this.panY) / this.zoom;

    this.dragState.ghostLine.setAttribute('x2', String(canvasX));
    this.dragState.ghostLine.setAttribute('y2', String(canvasY));

    // Hit-test: highlight node under cursor
    this.clearDropHighlights();
    const target = this.findNodeAtCanvasPoint(canvasX, canvasY);
    if (target && target.id !== this.dragState.sourceNode.id) {
      const el = this.nodeElements.get(target.id);
      if (el) el.classList.add('branches-node--drop-target');
    }
  }

  private onDragEnd(e: PointerEvent): void {
    if (!this.dragState?.active) return;

    const rect = this.container.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - this.panX) / this.zoom;
    const canvasY = (e.clientY - rect.top - this.panY) / this.zoom;

    // Find drop target
    const target = this.findNodeAtCanvasPoint(canvasX, canvasY);

    // Clean up ghost line
    if (this.dragState.ghostLine) {
      this.dragState.ghostLine.remove();
    }

    // Clean up highlights
    this.clearDropHighlights();
    const sourceEl = this.nodeElements.get(this.dragState.sourceNode.id);
    if (sourceEl) sourceEl.classList.remove('branches-node--dragging');

    // Execute link if valid target, or create new node on empty canvas
    const sourceId = this.dragState.sourceNode.id;
    const mode = this.dragState.mode;

    if (target && target.id !== this.dragState.sourceNode.id) {
      if (mode === 'partner' && this.onPartnerLink) {
        this.onPartnerLink(sourceId, target.id);
      } else if (mode !== 'partner') {
        this.onLink(sourceId, target.id, mode);
      }
      this.dragState = null;
      this.container.style.cursor = '';
    } else if (!target) {
      // Dropped on empty space — show inline input to create a new note
      this.dragState = null;
      this.container.style.cursor = '';
      if (mode === 'partner') {
        this.showCreateInput(canvasX, canvasY, sourceId, mode);
      } else {
        this.showCreateInput(canvasX, canvasY, sourceId, mode);
      }
    } else {
      this.dragState = null;
      this.container.style.cursor = '';
    }
  }

  private findNodeAtCanvasPoint(cx: number, cy: number): TreeNode | null {
    if (!this.layout) return null;
    for (const node of this.layout.nodes) {
      if (cx >= node.x && cx <= node.x + node.width &&
          cy >= node.y && cy <= node.y + node.height) {
        return node;
      }
    }
    return null;
  }

  private clearDropHighlights(): void {
    for (const el of this.nodeElements.values()) {
      el.classList.remove('branches-node--drop-target');
    }
  }

  /**
   * Show an inline text input on the canvas at (cx, cy) to name a new note.
   * On Enter, calls onCreate; on Escape or blur, cancels.
   */
  private showCreateInput(
    cx: number, cy: number,
    sourceId: string, mode: 'parent' | 'child' | 'partner'
  ): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'branches-create-input';
    wrapper.style.transform = `translate(${cx}px, ${cy - 18}px)`;

    const label = document.createElement('span');
    label.className = 'branches-create-label';
    const labelText = mode === 'parent' ? 'New parent' : mode === 'child' ? 'New child' : 'New partner';
    label.textContent = labelText;
    wrapper.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'branches-create-field';
    input.placeholder = 'Note name…';
    wrapper.appendChild(input);

    this.nodesLayer.appendChild(wrapper);

    // Focus after paint
    requestAnimationFrame(() => input.focus());

    // Characters forbidden in Obsidian note names
    const INVALID_CHARS = /[\/\\:*?"<>|#^[\]]/;

    let disposed = false;

    const commit = () => {
      if (disposed) return;
      const name = input.value.trim();
      cleanup();
      if (!name) return;
      if (INVALID_CHARS.test(name)) return; // silently reject bad chars
      if (mode === 'partner' && this.onCreatePartner) {
        this.onCreatePartner(sourceId, name);
      } else if (mode !== 'partner') {
        this.onCreate(sourceId, name, mode);
      }
    };

    const cancel = () => cleanup();

    const cleanup = () => {
      disposed = true;
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      wrapper.remove();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation();
    };

    const onBlur = () => {
      setTimeout(() => { if (!disposed && wrapper.isConnected) commit(); }, 120);
    };

    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
  }

  // ─── Expand/collapse ──────────────────────────────────────

  private toggleExpand(node: TreeNode): void {
    node.expanded = !node.expanded;
    this.doLayout();
    this.renderNodes();
    this.renderEdges();
    this.applyTransform();
  }

  // ─── Keyboard navigation ───────────────────────────────────

  private setupKeyboard(): void {
    const signal = this.abortController.signal;

    // Make container focusable
    this.container.setAttribute('tabindex', '0');
    this.container.style.outline = 'none';

    this.container.addEventListener('keydown', (e) => {
      // Don't intercept if a text input is focused
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const dir = this.config.layoutDirection;
      const isVertical = dir === 'TB' || dir === 'BT';
      const isReversed = dir === 'BT' || dir === 'RL';

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          e.stopPropagation();
          const next = this.getKeyboardTarget(e.key, isVertical, isReversed);
          if (next) {
            this.selectNode(next.id);
            this.panToNode(next);
          } else if (!this.selectedNodeId && this.roots.length > 0) {
            // Nothing selected yet — select the first root
            const first = this.roots[0];
            this.selectNode(first.id);
            this.panToNode(first);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (this.selectedNodeId) {
            const node = this.nodeMap.get(this.selectedNodeId);
            if (node) this.onNodeOpen(node);
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (this.selectedNodeId) {
            const node = this.nodeMap.get(this.selectedNodeId);
            if (node && node.children.length > 0) {
              this.toggleExpand(node);
            }
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          this.selectNode(null);
          break;
        }
      }
    }, { signal });
  }

  /**
   * Given a key press and layout direction, find the next node to navigate to.
   *
   * The mapping adapts to layout direction:
   * - "Upstream" arrow (↑ in TB, ↓ in BT, ← in LR, → in RL) → go to parent
   * - "Downstream" arrow → go to first child (or expand if collapsed)
   * - Perpendicular arrows → go to prev/next sibling
   */
  private getKeyboardTarget(
    key: string, isVertical: boolean, isReversed: boolean
  ): TreeNode | null {
    if (!this.selectedNodeId) return null;
    const current = this.nodeMap.get(this.selectedNodeId);
    if (!current) return null;

    // Classify the key into a logical direction relative to tree flow
    let logical: 'parent' | 'child' | 'prevSibling' | 'nextSibling' | null = null;

    if (isVertical) {
      // TB: Up=parent, Down=child, Left=prevSibling, Right=nextSibling
      // BT: Down=parent, Up=child, Left=prevSibling, Right=nextSibling
      if (key === 'ArrowUp') logical = isReversed ? 'child' : 'parent';
      else if (key === 'ArrowDown') logical = isReversed ? 'parent' : 'child';
      else if (key === 'ArrowLeft') logical = 'prevSibling';
      else if (key === 'ArrowRight') logical = 'nextSibling';
    } else {
      // LR: Left=parent, Right=child, Up=prevSibling, Down=nextSibling
      // RL: Right=parent, Left=child, Up=prevSibling, Down=nextSibling
      if (key === 'ArrowLeft') logical = isReversed ? 'child' : 'parent';
      else if (key === 'ArrowRight') logical = isReversed ? 'parent' : 'child';
      else if (key === 'ArrowUp') logical = 'prevSibling';
      else if (key === 'ArrowDown') logical = 'nextSibling';
    }

    if (!logical) return null;

    if (logical === 'parent') {
      // Go to first parent
      if (current.parentIds.length > 0) {
        return this.nodeMap.get(current.parentIds[0]) ?? null;
      }
    } else if (logical === 'child') {
      if (current.children.length > 0) {
        if (!current.expanded) {
          // Expand first, then select first child
          this.toggleExpand(current);
        }
        return current.children[0];
      }
    } else {
      // Sibling navigation — find current node among its parent's children
      const siblings = this.getSiblings(current);
      if (siblings.length > 1) {
        const idx = siblings.findIndex(s => s.id === current.id);
        if (logical === 'prevSibling' && idx > 0) return siblings[idx - 1];
        if (logical === 'nextSibling' && idx < siblings.length - 1) return siblings[idx + 1];
      }
    }

    return null;
  }

  /** Get the siblings of a node (children of same parent, or roots if no parent). */
  private getSiblings(node: TreeNode): TreeNode[] {
    if (node.parentIds.length === 0) {
      return this.roots;
    }
    const parent = this.nodeMap.get(node.parentIds[0]);
    if (!parent) return [node];
    // Only return visible (expanded) children
    return parent.children;
  }

  /** Pan the canvas so a node is visible and reasonably centered. */
  private panToNode(node: TreeNode): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nodeCX = node.x + node.width / 2;
    const nodeCY = node.y + node.height / 2;

    // Target: center the node in the viewport
    const targetPanX = rect.width / 2 - nodeCX * this.zoom;
    const targetPanY = rect.height / 2 - nodeCY * this.zoom;

    // Only pan if the node is outside the visible area (with margin)
    const margin = 60;
    const nodeScreenX = node.x * this.zoom + this.panX;
    const nodeScreenY = node.y * this.zoom + this.panY;
    const nodeScreenR = (node.x + node.width) * this.zoom + this.panX;
    const nodeScreenB = (node.y + node.height) * this.zoom + this.panY;

    if (
      nodeScreenX < margin || nodeScreenY < margin ||
      nodeScreenR > rect.width - margin || nodeScreenB > rect.height - margin
    ) {
      this.panX = targetPanX;
      this.panY = targetPanY;
      this.applyTransform();
    }
  }

  // ─── Pan/Zoom ─────────────────────────────────────────────

  private setupPanZoom(): void {
    const signal = this.abortController.signal;

    // Mouse wheel zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom + delta));

      // Zoom towards cursor
      const scale = newZoom / this.zoom;
      this.panX = mouseX - (mouseX - this.panX) * scale;
      this.panY = mouseY - (mouseY - this.panY) * scale;
      this.zoom = newZoom;
      this.applyTransform();
    }, { passive: false, signal });

    // Click-drag pan
    this.container.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.branches-node')) return;
      if ((e.target as HTMLElement).closest('.branches-controls')) return;
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panStartPanX = this.panX;
      this.panStartPanY = this.panY;
      this.container.style.cursor = 'grabbing';
      this.container.setPointerCapture(e.pointerId);
    }, { signal });

    this.container.addEventListener('pointermove', (e) => {
      if (!this.isPanning) return;
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.panX = this.panStartPanX + dx;
      this.panY = this.panStartPanY + dy;
      this.applyTransform();
    }, { signal });

    this.container.addEventListener('pointerup', () => {
      this.isPanning = false;
      this.container.style.cursor = '';
    }, { signal });

    // Double-click to fit
    this.container.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.branches-node')) return;
      if ((e.target as HTMLElement).closest('.branches-controls')) return;
      this.autoFit();
    }, { signal });
  }

  private zoomToCenter(delta: number): void {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom + delta));
    const scale = newZoom / this.zoom;
    this.panX = cx - (cx - this.panX) * scale;
    this.panY = cy - (cy - this.panY) * scale;
    this.zoom = newZoom;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.canvasWrapper.style.transform =
      `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  // ─── Controls ─────────────────────────────────────────────

  private buildControls(): void {
    const signal = this.abortController.signal;

    const zoomIn = this.controlsBar.createDiv({ cls: 'branches-control-btn' });
    setIcon(zoomIn, 'plus');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    zoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomToCenter(ZOOM_STEP * 3);
    }, { signal });

    const zoomOut = this.controlsBar.createDiv({ cls: 'branches-control-btn' });
    setIcon(zoomOut, 'minus');
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomToCenter(-ZOOM_STEP * 3);
    }, { signal });

    const fitBtn = this.controlsBar.createDiv({ cls: 'branches-control-btn' });
    setIcon(fitBtn, 'maximize-2');
    fitBtn.setAttribute('aria-label', 'Fit to view');
    fitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.autoFit();
    }, { signal });
  }
}
