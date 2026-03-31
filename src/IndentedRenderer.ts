/**
 * Branches — Indented (List) Tree Renderer
 *
 * Renders the tree as a collapsible indented list, similar to a file
 * explorer or outliner. Each node is a clickable row with expand/collapse
 * chevrons, color stripes, avatars, subtitles, and child count badges —
 * matching the spatial renderer's card features in list form.
 */

import { setIcon } from 'obsidian';
import type { TreeNode, TreeConfig } from './types';

export class IndentedRenderer {
  private container: HTMLElement;
  private listEl: HTMLElement | null = null;
  private config: TreeConfig;
  private nodeMap = new Map<string, TreeNode>();

  // Flat list of visible nodes in render order (for keyboard nav)
  private visibleNodes: TreeNode[] = [];
  private rowElements = new Map<string, HTMLElement>();
  private selectedNodeId: string | null = null;

  // Callbacks
  private onNodeClick: (node: TreeNode) => void;
  private onNodeOpen: (node: TreeNode) => void;
  private onContextMenu: ((node: TreeNode, event: MouseEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    config: TreeConfig,
    onNodeClick: (node: TreeNode) => void,
    onNodeOpen: (node: TreeNode) => void
  ) {
    this.container = container;
    this.config = config;
    this.onNodeClick = onNodeClick;
    this.onNodeOpen = onNodeOpen;
  }

  setContextMenuHandler(handler: (node: TreeNode, event: MouseEvent) => void): void {
    this.onContextMenu = handler;
  }

  render(roots: TreeNode[], nodeMap: Map<string, TreeNode>): void {
    this.nodeMap = nodeMap;
    this.listEl?.remove();
    this.visibleNodes = [];
    this.rowElements.clear();

    const wrapper = this.container.createDiv({ cls: 'branches-indented' });
    this.listEl = wrapper;

    // Make focusable for keyboard navigation
    wrapper.setAttribute('tabindex', '0');
    wrapper.style.outline = 'none';

    for (const root of roots) {
      this.renderNode(wrapper, root, 0);
    }

    this.setupKeyboard(wrapper);

    // Restore selection if it's still visible
    if (this.selectedNodeId && this.rowElements.has(this.selectedNodeId)) {
      this.selectRow(this.selectedNodeId);
    }
  }

  private renderNode(parent: HTMLElement, node: TreeNode, depth: number): void {
    this.visibleNodes.push(node);
    const row = parent.createDiv({ cls: 'branches-indented-row' });
    row.dataset.id = node.id;
    row.style.paddingLeft = `${12 + depth * 20}px`;
    this.rowElements.set(node.id, row);

    // Expand / collapse chevron
    const chevron = row.createSpan({ cls: 'branches-indented-chevron' });
    if (node.children.length > 0) {
      setIcon(chevron, node.expanded ? 'chevron-down' : 'chevron-right');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        // Re-render the subtree
        this.render(this.getRoots(), this.nodeMap);
      });
    } else {
      // Spacer to keep alignment
      chevron.classList.add('branches-indented-chevron--empty');
    }

    // Color stripe dot
    if (node.color) {
      const dot = row.createSpan({ cls: 'branches-indented-dot' });
      dot.style.background = node.color;
    }

    // Avatar
    if (node.imageUrl) {
      const isSquare = this.config.avatarShape === 'rounded-square';
      row.createEl('img', {
        cls: isSquare ? 'branches-indented-avatar branches-indented-avatar--square' : 'branches-indented-avatar',
        attr: { src: node.imageUrl, alt: node.title, draggable: 'false' },
      });
    }

    // Text content area
    const textArea = row.createDiv({ cls: 'branches-indented-text' });

    // Title
    textArea.createSpan({ cls: 'branches-indented-title', text: node.title });

    // Subtitles (inline, muted)
    if (node.subtitle) {
      textArea.createSpan({ cls: 'branches-indented-subtitle', text: node.subtitle });
    }
    if (node.subtitle2) {
      textArea.createSpan({ cls: 'branches-indented-subtitle branches-indented-subtitle2', text: node.subtitle2 });
    }

    // Child count badge
    if (this.config.showChildCount && node.children.length > 0) {
      row.createSpan({
        cls: 'branches-indented-badge',
        text: `${node.children.length}`,
      });
    }

    // Hover tooltip with configured properties
    const tooltipLines = this.buildTooltipLines(node);
    if (tooltipLines.length > 0) {
      // First few rows show tooltip below to avoid clipping under the Bases header
      const rowIndex = this.visibleNodes.length - 1;
      const isNearTop = rowIndex < 3;
      const tipCls = isNearTop
        ? 'branches-tooltip branches-tooltip--list branches-tooltip--bottom'
        : 'branches-tooltip branches-tooltip--list';
      const tooltip = row.createDiv({ cls: tipCls });
      for (const line of tooltipLines) {
        const tipRow = tooltip.createDiv({ cls: 'branches-tooltip-row' });
        tipRow.createSpan({ cls: 'branches-tooltip-label', text: line.label });
        tipRow.createSpan({ cls: 'branches-tooltip-value', text: line.value });
      }
    }

    // Click to open note
    row.addEventListener('click', () => this.onNodeClick(node));
    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.onNodeOpen(node);
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      if (this.onContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        this.onContextMenu(node, e);
      }
    });

    // Render children if expanded
    if (node.expanded && node.children.length > 0) {
      const childContainer = parent.createDiv({ cls: 'branches-indented-children' });
      for (const child of node.children) {
        this.renderNode(childContainer, child, depth + 1);
      }
    }
  }

  // ─── Keyboard navigation ───────────────────────────────────

  private setupKeyboard(wrapper: HTMLElement): void {
    wrapper.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault();
          e.stopPropagation();
          const idx = this.getSelectedIndex();
          if (idx > 0) {
            this.selectRow(this.visibleNodes[idx - 1].id);
          } else if (idx === -1 && this.visibleNodes.length > 0) {
            this.selectRow(this.visibleNodes[0].id);
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          e.stopPropagation();
          const idx = this.getSelectedIndex();
          if (idx < this.visibleNodes.length - 1) {
            this.selectRow(this.visibleNodes[idx + 1].id);
          } else if (idx === -1 && this.visibleNodes.length > 0) {
            this.selectRow(this.visibleNodes[0].id);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (this.selectedNodeId) {
            const node = this.nodeMap.get(this.selectedNodeId);
            if (node && node.children.length > 0 && !node.expanded) {
              node.expanded = true;
              this.render(this.getRoots(), this.nodeMap);
              this.selectRow(node.id);
              this.listEl?.focus();
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (this.selectedNodeId) {
            const node = this.nodeMap.get(this.selectedNodeId);
            if (node && node.expanded && node.children.length > 0) {
              // Collapse current node
              node.expanded = false;
              this.render(this.getRoots(), this.nodeMap);
              this.selectRow(node.id);
              this.listEl?.focus();
            } else if (node && node.parentIds.length > 0) {
              // Navigate up to parent
              this.selectRow(node.parentIds[0]);
            }
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
              node.expanded = !node.expanded;
              this.render(this.getRoots(), this.nodeMap);
              this.selectRow(node.id);
              this.listEl?.focus();
            }
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          this.selectRow(null);
          break;
        }
      }
    });
  }

  private selectRow(id: string | null): void {
    // Deselect previous
    if (this.selectedNodeId) {
      const prev = this.rowElements.get(this.selectedNodeId);
      if (prev) prev.classList.remove('branches-indented-row--selected');
    }
    this.selectedNodeId = id;
    if (id) {
      const el = this.rowElements.get(id);
      if (el) {
        el.classList.add('branches-indented-row--selected');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  private getSelectedIndex(): number {
    if (!this.selectedNodeId) return -1;
    return this.visibleNodes.findIndex(n => n.id === this.selectedNodeId);
  }

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
        if (val && typeof val === 'object' && !Array.isArray(val) && 'data' in val) {
          val = val.data;
        }
        if (Array.isArray(val)) {
          val = val.map((v: any) => {
            if (v && typeof v === 'object' && ('path' in v || 'display' in v)) {
              return v.display ?? v.path ?? String(v);
            }
            return String(v);
          }).join(', ');
        }
        const display = IndentedRenderer.stripWikiLinks(String(val).trim());
        if (!display) continue;
        const label = stripped.charAt(0).toUpperCase() + stripped.slice(1);
        lines.push({ label, value: display });
      }
    }

    return lines;
  }

  /** Walk back to root nodes from the nodeMap. */
  private getRoots(): TreeNode[] {
    const roots: TreeNode[] = [];
    for (const node of this.nodeMap.values()) {
      if (node.parentIds.length === 0) roots.push(node);
    }
    return roots;
  }

  destroy(): void {
    this.listEl?.remove();
    this.listEl = null;
  }
}
