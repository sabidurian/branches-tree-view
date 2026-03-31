/**
 * Branches — Core type definitions.
 *
 * These interfaces are the shared data contract between the data model,
 * layout engine, and renderers.
 */

/** A single node in the tree hierarchy. */
export interface TreeNode {
  /** Unique key — the note's file path from Bases. */
  id: string;
  /** Display name (note title or filename). */
  title: string;
  /** Parent node IDs. Empty array = root node. Supports DAG (multi-parent). */
  parentIds: string[];
  /** Partner node IDs. Bidirectional partnership relationships (e.g. spouse). */
  partnerIds: string[];
  /** Direct children, populated during tree building. */
  children: TreeNode[];
  /** Depth in the tree (0 = root). */
  depth: number;
  /** All Bases properties for this row. */
  properties: Record<string, any>;
  /** Whether this node's children are visible. */
  expanded: boolean;
  /** Optional image URL for avatar display (vault resource URI). */
  imageUrl?: string;
  /** Optional subtitle text from a configured property. */
  subtitle?: string;
  /** Optional secondary subtitle text from a configured property. */
  subtitle2?: string;
  /** Optional color value (hex or named) from a configured property. */
  color?: string;
  /** Whether this node's parentage is certain (default true). False = dotted edge to parent. */
  parentageCertain?: boolean;
  /** Optional sort value for child ordering (numeric or date-parseable). */
  childOrderValue?: number;

  // Layout positions (set by dagre in Phase 2)
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Configuration for how the tree is built and displayed. */
export interface TreeConfig {
  /** Which property defines parent → child relationships. */
  parentProperty: string;
  /** Which property defines bidirectional partnership relationships (e.g. spouse). */
  partnerProperty?: string;
  /** Which property to display as the node title. */
  labelProperty: string;
  /** Optional property for node color-coding. */
  colorProperty?: string;
  /** Optional property for sorting children (numeric or date). */
  childOrderProperty?: string;
  /** Whether to show child count badges on nodes. */
  showChildCount: boolean;
  /** Whether to show a dot grid on the canvas background. */
  showDotGrid: boolean;
  /** Avatar shape: 'circle' (default) or 'rounded-square'. */
  avatarShape: 'circle' | 'rounded-square';
  /** Property names to display in hover tooltips. Empty = auto-detect from frontmatter. */
  tooltipProperties: string[];
  /** Layout direction for dagre. */
  layoutDirection: 'TB' | 'BT' | 'LR' | 'RL';
  /** Node card width in pixels. */
  nodeWidth: number;
  /** Node card height in pixels. */
  nodeHeight: number;
  /** Vertical gap between hierarchy levels. */
  rankSep: number;
  /** Horizontal gap between sibling nodes. */
  nodeSep: number;
}

/** Result of dagre layout computation. */
export interface LayoutResult {
  /** All positioned nodes (flattened). */
  nodes: TreeNode[];
  /** Bounding box of the entire layout. */
  boundingBox: { width: number; height: number };
}

/** Default configuration values. */
export const DEFAULT_TREE_CONFIG: TreeConfig = {
  parentProperty: 'parent',
  labelProperty: 'file.name',
  showChildCount: true,
  showDotGrid: false,
  avatarShape: 'circle',
  tooltipProperties: [],
  layoutDirection: 'TB',
  nodeWidth: 240,
  nodeHeight: 64,
  rankSep: 60,
  nodeSep: 24,
};

/**
 * Known property names that typically define parent-child relationships.
 * Used by autoDetectParentProperty().
 */
export const KNOWN_PARENT_PROPERTIES = [
  'parent',
  'parentof',
  'partof',
  'belongsto',
  'parenttask',
  'parentitem',
  'parent-task',
  'parent-item',
  'part-of',
  'belongs-to',
];

/**
 * Known property names for partnership/peer relationships.
 * Used by autoDetectPartnerProperty().
 */
export const KNOWN_PARTNER_PROPERTIES = [
  'spouse',
  'partner',
  'partners',
  'peer',
  'peers',
  'sibling',
  'siblings',
  'co-parent',
  'coparent',
  'ally',
  'allies',
  'associate',
  'associates',
];
