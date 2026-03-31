/**
 * Branches — Tree View for Obsidian Bases
 *
 * Phase 3: Spatial canvas rendering with dagre layout, pan/zoom,
 * node cards, and SVG connector edges.
 */

import { BasesView, Menu, Modal, Notice, QueryController, setIcon, TFile } from 'obsidian';
import type BranchesPlugin from './main';
import type { TreeNode, TreeConfig } from './types';
import { DEFAULT_TREE_CONFIG, KNOWN_PARENT_PROPERTIES, KNOWN_PARTNER_PROPERTIES } from './types';
import { SpatialRenderer } from './SpatialRenderer';
import { IndentedRenderer } from './IndentedRenderer';

/** Confirmation modal for restoring default layout. */
class RestoreDefaultsModal extends Modal {
  private confirmed = false;
  private onConfirm: () => void;

  constructor(app: import('obsidian').App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Restore default layout?' });
    contentEl.createEl('p', {
      text: 'Are you sure you wish to restore to default view settings? Any and all arrangements you\u2019ve made will be lost. Relationships and data will persist.',
    });

    const btnRow = contentEl.createDiv({ cls: 'modal-button-container' });

    btnRow.createEl('button', { text: 'No, Cancel' }).addEventListener('click', () => {
      this.close();
    });

    const confirmBtn = btnRow.createEl('button', {
      text: 'Yes, Restore',
      cls: 'mod-warning',
    });
    confirmBtn.addEventListener('click', () => {
      this.confirmed = true;
      this.close();
    });
  }

  onClose(): void {
    if (this.confirmed) this.onConfirm();
    this.contentEl.empty();
  }
}

export class BranchesView extends BasesView {
  type = 'branches-tree';

  private plugin: BranchesPlugin;
  private scrollEl: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private treeRoots: TreeNode[] = [];
  private nodeMap = new Map<string, TreeNode>();
  private spatialRenderer: SpatialRenderer | null = null;
  private indentedRenderer: IndentedRenderer | null = null;
  private scopeId = '';  // unique ID for this Base view (for position persistence)

  constructor(
    controller: QueryController,
    scrollEl: HTMLElement,
    plugin: BranchesPlugin
  ) {
    super(controller);
    this.scrollEl = scrollEl;
    this.plugin = plugin;
  }

  // ─── Bases lifecycle ───────────────────────────────────────

  onDataUpdated(): void {
    const entries: any[] = this.data?.data ?? [];

    const parentPropId = this.config.getAsPropertyId('parentProp');
    const parentPropRaw = this.config.get('parentProp') as string | undefined;
    const layoutDir = (this.config.get('layoutDirection') as string) || 'TB';

    const parentProp = this.resolveParentPropName(parentPropId, parentPropRaw, entries);

    // Resolve partner property (optional)
    const partnerPropId = this.config.getAsPropertyId('partnerProp');
    const partnerPropRaw = this.config.get('partnerProp') as string | undefined;
    const partnerProp = this.resolvePartnerPropName(partnerPropId, partnerPropRaw, entries);

    // Resolve image property (optional)
    const imagePropId = this.config.getAsPropertyId('imageProp');
    const imagePropRaw = this.config.get('imageProp') as string | undefined;
    const imageProp = this.resolveSimplePropName(imagePropId, imagePropRaw);

    // Resolve subtitle property (optional)
    const subtitlePropId = this.config.getAsPropertyId('labelProp');
    const subtitlePropRaw = this.config.get('labelProp') as string | undefined;
    const subtitleProp = this.resolveSimplePropName(subtitlePropId, subtitlePropRaw);

    // Resolve secondary subtitle property (optional)
    const subtitle2PropId = this.config.getAsPropertyId('subtitle2Prop');
    const subtitle2PropRaw = this.config.get('subtitle2Prop') as string | undefined;
    const subtitle2Prop = this.resolveSimplePropName(subtitle2PropId, subtitle2PropRaw);

    // Resolve color property (optional)
    const colorPropId = this.config.getAsPropertyId('colorProp');
    const colorPropRaw = this.config.get('colorProp') as string | undefined;
    const colorProp = this.resolveSimplePropName(colorPropId, colorPropRaw);

    // Resolve parentage certainty property (optional)
    const certaintyPropId = this.config.getAsPropertyId('certaintyProp');
    const certaintyPropRaw = this.config.get('certaintyProp') as string | undefined;
    const certaintyProp = this.resolveSimplePropName(certaintyPropId, certaintyPropRaw);

    // Resolve child order property (optional — numeric or date for sorting)
    const childOrderPropId = this.config.getAsPropertyId('childOrderProp');
    const childOrderPropRaw = this.config.get('childOrderProp') as string | undefined;
    const childOrderProp = this.resolveSimplePropName(childOrderPropId, childOrderPropRaw);

    // Show child count toggle (defaults to true)
    const showChildCount = this.config.get('showChildCount') as boolean ?? true;

    // Show dot grid toggle (defaults to false)
    const showDotGrid = this.config.get('showDotGrid') as boolean ?? false;

    // Avatar shape (defaults to 'circle')
    const avatarShape = (this.config.get('avatarShape') as string) || 'circle';

    // Tooltip properties (comma-separated text field, max 7, or auto-detect from frontmatter)
    const tooltipPropsRaw = (this.config.get('tooltipProps') as string) || '';
    const userTooltipProps = tooltipPropsRaw
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 7);

    const { roots, allNodes, nodeMap } = this.buildTreeFromEntries(entries, parentProp, partnerProp);
    this.treeRoots = roots;
    this.nodeMap = nodeMap;

    // Populate optional per-node data from properties
    if (imageProp) this.populateImageUrls(entries, imageProp, nodeMap);
    if (subtitleProp) this.populateSubtitles(entries, subtitleProp, nodeMap);
    if (subtitle2Prop) this.populateSubtitles2(entries, subtitle2Prop, nodeMap);
    if (colorProp) this.populateColors(entries, colorProp, nodeMap);
    if (certaintyProp) this.populateCertainty(entries, certaintyProp, nodeMap);
    if (childOrderProp) this.populateChildOrder(entries, childOrderProp, nodeMap);

    // Sort AFTER all populate calls so childOrderValue is available
    this.sortTreeNodes(roots);

    // If user hasn't configured tooltip properties, auto-detect from first node's frontmatter
    let tooltipProperties = userTooltipProps;
    if (tooltipProperties.length === 0) {
      const firstNode = allNodes[0];
      if (firstNode) {
        tooltipProperties = Object.keys(firstNode.properties).slice(0, 5);
      }
    }

    const treeConfig: TreeConfig = {
      ...DEFAULT_TREE_CONFIG,
      parentProperty: parentProp,
      partnerProperty: partnerProp || undefined,
      childOrderProperty: childOrderProp || undefined,
      showChildCount,
      showDotGrid,
      avatarShape: avatarShape as TreeConfig['avatarShape'],
      tooltipProperties,
      layoutDirection: layoutDir as TreeConfig['layoutDirection'],
    };

    // Compute a stable scope ID for position persistence.
    // Use the first entry's folder path + parent property as a key.
    const firstFile = entries[0]?.file;
    const folder = firstFile?.parent?.path ?? '';
    this.scopeId = `${folder}::${parentProp}`;

    const viewMode = (this.config.get('viewMode') as string) || 'spatial';
    this.render(allNodes, parentProp, partnerProp, treeConfig, viewMode);
  }

  onClose(): void {
    this.spatialRenderer?.destroy();
    this.spatialRenderer = null;
    this.indentedRenderer?.destroy();
    this.indentedRenderer = null;
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
  }

  // ─── Parent property detection ─────────────────────────────

  private resolveParentPropName(
    propId: any,
    rawConfig: string | undefined,
    entries: any[]
  ): string {
    if (propId) return String(propId);
    if (rawConfig?.trim()) return rawConfig.trim();

    if (entries.length > 0) {
      const entry = entries[0];
      for (const name of KNOWN_PARENT_PROPERTIES) {
        if (this.tryGetValue(entry, name) != null) return name;
        if (this.tryGetValue(entry, `note.${name}`) != null) return `note.${name}`;
      }
    }

    return 'parent';
  }

  private resolvePartnerPropName(
    propId: any,
    rawConfig: string | undefined,
    entries: any[]
  ): string | null {
    if (propId) return String(propId);
    if (rawConfig?.trim()) return rawConfig.trim();

    // Auto-detect from known partner property names
    if (entries.length > 0) {
      const entry = entries[0];
      for (const name of KNOWN_PARTNER_PROPERTIES) {
        if (this.tryGetValue(entry, name) != null) return name;
        if (this.tryGetValue(entry, `note.${name}`) != null) return `note.${name}`;
      }
    }

    return null; // No partner property found — that's fine
  }

  /** Resolve a simple (non-auto-detect) property name from config. */
  private resolveSimplePropName(
    propId: any,
    rawConfig: string | undefined
  ): string | null {
    if (propId) return String(propId);
    if (rawConfig?.trim()) return rawConfig.trim();
    return null;
  }

  /**
   * Read image property values from Bases entries and set imageUrl on nodes.
   * Obsidian stores images as internal links like [[image.png]] or paths.
   * We convert them to vault resource URIs that <img> can render.
   */
  private populateImageUrls(
    entries: any[],
    imageProp: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    const app = this.plugin.app;

    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;

      const node = nodeMap.get(file.path);
      if (!node) continue;

      const imgVal = this.readEntryValue(entry, imageProp);

      if (!imgVal) continue;

      // Unwrap Bases wrapper
      let raw = imgVal;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      // Take first element if array
      if (Array.isArray(raw)) raw = raw[0];
      if (!raw) continue;

      // Extract the image path from various formats
      let imgPath: string | null = null;

      if (typeof raw === 'object' && raw.path && typeof raw.path === 'string') {
        imgPath = raw.path;
      } else if (typeof raw === 'string') {
        // Strip wikilink brackets
        const wikiMatch = raw.match(/^\[\[(.+?)(?:\|.+?)?\]\]$/);
        imgPath = wikiMatch ? wikiMatch[1] : raw.trim();
      }

      if (!imgPath) continue;

      // Resolve to vault file and get resource URL
      const imgFile = app.metadataCache.getFirstLinkpathDest(imgPath, file.path)
        ?? app.vault.getAbstractFileByPath(imgPath);

      if (imgFile instanceof TFile) {
        node.imageUrl = app.vault.getResourcePath(imgFile);
      }
    }
  }

  /**
   * Read a text property from entries and set subtitle on nodes.
   */
  private populateSubtitles(
    entries: any[],
    subtitleProp: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;
      const node = nodeMap.get(file.path);
      if (!node) continue;

      const val = this.readEntryValue(entry, subtitleProp);
      if (val == null) continue;

      // Unwrap Bases wrapper
      let raw = val;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      if (Array.isArray(raw)) raw = raw[0];
      if (!raw) continue;

      const str = typeof raw === 'string' ? raw : String(raw);
      if (str && str !== '[object Object]' && str !== 'null' && str !== 'undefined') {
        // Strip wikilink brackets for display
        const wikiMatch = str.match(/^\[\[(.+?)(?:\|(.+?))?\]\]$/);
        node.subtitle = wikiMatch ? (wikiMatch[2] ?? wikiMatch[1]) : str;
      }
    }
  }

  /**
   * Read a text property from entries and set subtitle2 on nodes.
   * Identical logic to populateSubtitles but writes to subtitle2.
   */
  private populateSubtitles2(
    entries: any[],
    subtitle2Prop: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;
      const node = nodeMap.get(file.path);
      if (!node) continue;

      const val = this.readEntryValue(entry, subtitle2Prop);
      if (val == null) continue;

      let raw = val;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      if (Array.isArray(raw)) raw = raw[0];
      if (!raw) continue;

      const str = typeof raw === 'string' ? raw : String(raw);
      if (str && str !== '[object Object]' && str !== 'null' && str !== 'undefined') {
        const wikiMatch = str.match(/^\[\[(.+?)(?:\|(.+?))?\]\]$/);
        node.subtitle2 = wikiMatch ? (wikiMatch[2] ?? wikiMatch[1]) : str;
      }
    }
  }

  /**
   * 24 base hues for category auto-assignment. Each hue has 6 tonal variants
   * generated at runtime via HSL manipulation, giving 144 total distinct colors.
   * Hues are spaced to maximise perceptual distance between adjacent categories.
   */
  private static readonly BASE_HUES: [number, number, number][] = [
    // [hue, saturation%, lightness%]
    [239, 84, 67],  // indigo
    [38,  92, 50],  // amber
    [160, 84, 39],  // emerald
    [0,   84, 60],  // red
    [258, 90, 66],  // violet
    [188, 94, 43],  // cyan
    [25,  95, 53],  // orange
    [330, 81, 60],  // pink
    [173, 80, 40],  // teal
    [271, 91, 65],  // purple
    [84,  78, 44],  // lime
    [347, 77, 50],  // rose
    [199, 89, 48],  // sky
    [292, 84, 61],  // fuchsia
    [142, 71, 45],  // green
    [210, 70, 55],  // steel blue
    [48,  89, 50],  // gold
    [310, 60, 50],  // plum
    [120, 50, 40],  // forest
    [15,  80, 55],  // burnt orange
    [220, 75, 60],  // cornflower
    [55,  75, 45],  // olive-gold
    [350, 65, 45],  // burgundy
    [180, 55, 45],  // dark cyan
  ];

  /** Number of tonal variants per base hue. */
  private static readonly TONES_PER_HUE = 6;

  /**
   * Generate 6 tonal variants for a given HSL base color.
   * Returns hex strings ranging from a darker/more saturated tone
   * to a lighter/less saturated tone.
   */
  private static generateTones(h: number, s: number, l: number): string[] {
    const offsets = [
      { sOff: +6,  lOff: -14 },  // darkest
      { sOff: +3,  lOff: -7 },   // dark
      { sOff: 0,   lOff: 0 },    // base
      { sOff: -5,  lOff: +8 },   // light
      { sOff: -10, lOff: +16 },  // lighter
      { sOff: -15, lOff: +24 },  // lightest
    ];
    return offsets.map(({ sOff, lOff }) => {
      const ns = Math.max(20, Math.min(100, s + sOff));
      const nl = Math.max(20, Math.min(85, l + lOff));
      return BranchesView.hslToHex(h, ns, nl);
    });
  }

  /** Convert HSL (h: 0-360, s: 0-100, l: 0-100) to a hex string. */
  private static hslToHex(h: number, s: number, l: number): string {
    const s1 = s / 100;
    const l1 = l / 100;
    const a = s1 * Math.min(l1, 1 - l1);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * Read a color property from entries and set color on nodes.
   * If the value looks like a hex color, use it directly.
   * Otherwise, auto-assign colors from a palette keyed by unique values.
   * Siblings/neighbours sharing the same category get contrasting tones.
   */
  private populateColors(
    entries: any[],
    colorProp: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    // First pass: collect all raw values per node path
    const nodeValues = new Map<string, string>();
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;
      const node = nodeMap.get(file.path);
      if (!node) continue;

      const val = this.readEntryValue(entry, colorProp);
      if (val == null) continue;

      let raw = val;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      if (Array.isArray(raw)) raw = raw[0];
      if (!raw) continue;

      const str = (typeof raw === 'string' ? raw : String(raw)).trim();
      if (str && str !== '[object Object]') {
        nodeValues.set(file.path, str);
      }
    }

    // Map each unique category string → a base hue index
    const categoryHueIndex = new Map<string, number>();
    let hueIdx = 0;

    // Pre-generate tone arrays per category (lazy, on first encounter)
    const categoryTones = new Map<string, string[]>();

    // Track per-category how many nodes have been assigned, so adjacent
    // same-category nodes get different tones automatically
    const categoryCounter = new Map<string, number>();

    // Group nodes by their parent so we can detect same-category siblings
    const siblingGroups = new Map<string, string[]>(); // parentId → [childPath, ...]
    for (const [path] of nodeValues) {
      const node = nodeMap.get(path);
      if (!node) continue;
      // Use first parentId as grouping key; orphans group under ''
      const groupKey = node.parentIds.length > 0 ? node.parentIds[0] : '';
      if (!siblingGroups.has(groupKey)) siblingGroups.set(groupKey, []);
      siblingGroups.get(groupKey)!.push(path);
    }

    // Assign colors: iterate by sibling groups so we can offset tones
    // for adjacent same-category nodes within each group
    const assigned = new Set<string>();

    for (const [, siblings] of siblingGroups) {
      // Track which tone index was last used for each category within this group
      const groupCategoryTone = new Map<string, number>();

      for (const path of siblings) {
        if (assigned.has(path)) continue;
        assigned.add(path);

        const str = nodeValues.get(path)!;
        const node = nodeMap.get(path);
        if (!node) continue;

        if (/^#([0-9a-fA-F]{3}){1,2}$/.test(str)) {
          node.color = str;
          continue;
        }

        // Ensure this category has a hue and tones array
        if (!categoryHueIndex.has(str)) {
          categoryHueIndex.set(str, hueIdx % BranchesView.BASE_HUES.length);
          hueIdx++;
        }
        if (!categoryTones.has(str)) {
          const [h, s, l] = BranchesView.BASE_HUES[categoryHueIndex.get(str)!];
          categoryTones.set(str, BranchesView.generateTones(h, s, l));
        }

        const tones = categoryTones.get(str)!;
        // Pick the next tone for this category within this sibling group,
        // cycling through available tones so neighbours contrast
        const prevTone = groupCategoryTone.get(str) ?? -1;
        // Skip by 2 for maximum contrast between adjacent same-category siblings
        const toneIdx = (prevTone + 2) % BranchesView.TONES_PER_HUE;
        groupCategoryTone.set(str, toneIdx);

        node.color = tones[toneIdx];
      }
    }

    // Catch any nodes not in a sibling group (shouldn't happen, but safety)
    for (const [path, str] of nodeValues) {
      const node = nodeMap.get(path);
      if (!node || node.color) continue;

      if (/^#([0-9a-fA-F]{3}){1,2}$/.test(str)) {
        node.color = str;
      } else {
        if (!categoryTones.has(str)) {
          if (!categoryHueIndex.has(str)) {
            categoryHueIndex.set(str, hueIdx % BranchesView.BASE_HUES.length);
            hueIdx++;
          }
          const [h, s, l] = BranchesView.BASE_HUES[categoryHueIndex.get(str)!];
          categoryTones.set(str, BranchesView.generateTones(h, s, l));
        }
        const counter = categoryCounter.get(str) ?? 0;
        categoryCounter.set(str, counter + 1);
        node.color = categoryTones.get(str)![counter % BranchesView.TONES_PER_HUE];
      }
    }
  }

  /**
   * Read a boolean certainty property from entries and set parentageCertain on nodes.
   * A value of false (or the string "false") marks the edge to parent as uncertain (dotted).
   */
  private populateCertainty(
    entries: any[],
    certaintyProp: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;
      const node = nodeMap.get(file.path);
      if (!node) continue;

      const val = this.readEntryValue(entry, certaintyProp);
      if (val == null) continue;

      // Unwrap Bases wrapper
      let raw = val;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      if (Array.isArray(raw)) raw = raw[0];

      // Interpret: boolean false or string "false" → uncertain
      if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
        node.parentageCertain = false;
      }
    }
  }

  // ─── Child sorting (called after all populate passes) ────────

  /**
   * Sort each parent's children array using affinity grouping and
   * the childOrderValue (populated by populateChildOrder).
   *
   * Must be called AFTER populateChildOrder so values are present.
   */
  private sortTreeNodes(roots: TreeNode[]): void {
    const compareByOrder = (a: TreeNode, b: TreeNode): number => {
      const aVal = a.childOrderValue ?? Infinity;
      const bVal = b.childOrderValue ?? Infinity;
      if (aVal !== bVal) return aVal - bVal;
      return a.title.localeCompare(b.title);
    };

    const sortChildren = (parent: TreeNode) => {
      if (parent.children.length <= 1) {
        for (const c of parent.children) sortChildren(c);
        return;
      }

      // Partition: exclusive children (only this parent) vs shared (multi-parent)
      const exclusive: TreeNode[] = [];
      const shared: TreeNode[] = [];
      for (const child of parent.children) {
        if (child.parentIds.length <= 1) {
          exclusive.push(child);
        } else {
          shared.push(child);
        }
      }

      exclusive.sort(compareByOrder);

      // Group shared children by their secondary parent set
      const sharedGroups = new Map<string, TreeNode[]>();
      for (const child of shared) {
        const otherParents = child.parentIds
          .filter(pid => pid !== parent.id)
          .sort()
          .join('|');
        if (!sharedGroups.has(otherParents)) sharedGroups.set(otherParents, []);
        sharedGroups.get(otherParents)!.push(child);
      }

      const sortedShared: TreeNode[] = [];
      for (const [, group] of sharedGroups) {
        group.sort(compareByOrder);
        sortedShared.push(...group);
      }

      parent.children = [...exclusive, ...sortedShared];

      for (const c of parent.children) sortChildren(c);
    };

    for (const r of roots) sortChildren(r);
    roots.sort(compareByOrder);
  }

  /**
   * Read a numeric or date property from entries and set childOrderValue on nodes.
   * Numeric values are used directly. Date strings are parsed to epoch ms.
   * Nodes without a parseable value get Infinity (sorted to end).
   */
  private populateChildOrder(
    entries: any[],
    orderProp: string,
    nodeMap: Map<string, TreeNode>
  ): void {
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;
      const node = nodeMap.get(file.path);
      if (!node) continue;

      const val = this.readEntryValue(entry, orderProp);
      if (val == null) continue;

      // Unwrap Bases wrapper
      let raw = val;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
        raw = raw.data;
      }
      if (Array.isArray(raw)) raw = raw[0];
      if (raw == null) continue;

      // Try numeric first
      const num = Number(raw);
      if (!isNaN(num)) {
        node.childOrderValue = num;
        continue;
      }

      // Try date parsing (ISO strings, YYYY-MM-DD, etc.)
      const str = typeof raw === 'string' ? raw.trim() : String(raw);
      const ts = Date.parse(str);
      if (!isNaN(ts)) {
        node.childOrderValue = ts;
      }
    }
  }

  /**
   * Safely read a single property value from a Bases entry.
   * Returns the value or null on failure (getValue can throw for unknown props).
   */
  private tryGetValue(entry: any, prop: string): any {
    try { return entry.getValue(prop); } catch { return null; }
  }

  /** Read a property value from a Bases entry, trying note. prefix variants. */
  private readEntryValue(entry: any, prop: string): any {
    let val = this.tryGetValue(entry, prop);
    if (val == null && !prop.startsWith('note.')) {
      val = this.tryGetValue(entry, `note.${prop}`);
    }
    if (val == null && prop.startsWith('note.')) {
      val = this.tryGetValue(entry, prop.replace(/^note\./, ''));
    }
    return val;
  }

  // ─── Tree building ─────────────────────────────────────────

  private buildTreeFromEntries(
    entries: any[],
    parentProp: string,
    partnerProp: string | null = null
  ): { roots: TreeNode[]; allNodes: TreeNode[]; nodeMap: Map<string, TreeNode> } {
    if (entries.length === 0) {
      return { roots: [], allNodes: [], nodeMap: new Map() };
    }

    const nodeMap = new Map<string, TreeNode>();
    const basenameToPath = new Map<string, string>();

    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;

      const id = file.path;
      const title = file.basename;

      // Read frontmatter properties for tooltip display
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      // Copy frontmatter keys (skip internal Obsidian keys)
      const props: Record<string, any> = {};
      for (const [k, v] of Object.entries(fm)) {
        if (k === 'position' || k === 'cssclasses') continue;
        props[k] = v;
      }

      nodeMap.set(id, {
        id, title,
        parentIds: [],
        partnerIds: [],
        children: [],
        depth: 0,
        properties: props,
        expanded: true,
        x: 0, y: 0,
        width: DEFAULT_TREE_CONFIG.nodeWidth,
        height: DEFAULT_TREE_CONFIG.nodeHeight,
      });

      basenameToPath.set(title.toLowerCase(), id);
    }

    // Resolve parent relationships (supports multi-parent via array values)
    for (const entry of entries) {
      const file: TFile | null = entry.file ?? null;
      if (!file) continue;

      const node = nodeMap.get(file.path);
      if (!node) continue;

      const parentVal = this.readEntryValue(entry, parentProp);
      if (!parentVal) continue;

      // Resolve all parent links (single value or array)
      const parentPaths = this.resolveLinks(parentVal, basenameToPath);
      for (const pp of parentPaths) {
        if (pp !== file.path && nodeMap.has(pp)) {
          node.parentIds.push(pp);
        }
      }
    }

    // Resolve partner relationships (bidirectional)
    if (partnerProp) {
      for (const entry of entries) {
        const file: TFile | null = entry.file ?? null;
        if (!file) continue;

        const node = nodeMap.get(file.path);
        if (!node) continue;

        const partnerVal = this.readEntryValue(entry, partnerProp);

        if (!partnerVal) continue;

        const partnerPaths = this.resolveLinks(partnerVal, basenameToPath);
        for (const pp of partnerPaths) {
          if (pp !== file.path && nodeMap.has(pp) && !node.partnerIds.includes(pp)) {
            node.partnerIds.push(pp);
          }
        }
      }
    }

    // Detect and break cycles via DFS
    const hasCyclePath = (startId: string, targetId: string, visited: Set<string>): boolean => {
      if (startId === targetId) return true;
      if (visited.has(startId)) return false;
      visited.add(startId);
      const n = nodeMap.get(startId);
      if (!n) return false;
      for (const pid of n.parentIds) {
        if (hasCyclePath(pid, targetId, visited)) return true;
      }
      return false;
    };
    for (const node of nodeMap.values()) {
      node.parentIds = node.parentIds.filter(pid => {
        const creates = hasCyclePath(pid, node.id, new Set());
        return !creates;
      });
    }

    // Wire children (a node is a child of every parent it lists)
    for (const node of nodeMap.values()) {
      for (const pid of node.parentIds) {
        const parent = nodeMap.get(pid);
        if (parent && !parent.children.includes(node)) {
          parent.children.push(node);
        }
      }
    }

    // Roots = nodes with no parents
    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentIds.length === 0) roots.push(node);
    }

    // Set depth (for DAG: depth = longest path from any root)
    const depthCache = new Map<string, number>();
    const computeDepth = (n: TreeNode): number => {
      if (depthCache.has(n.id)) return depthCache.get(n.id)!;
      if (n.parentIds.length === 0) { depthCache.set(n.id, 0); return 0; }
      const maxParent = Math.max(...n.parentIds.map(pid => {
        const p = nodeMap.get(pid);
        return p ? computeDepth(p) : -1;
      }));
      const d = maxParent + 1;
      depthCache.set(n.id, d);
      return d;
    };
    for (const node of nodeMap.values()) {
      node.depth = computeDepth(node);
    }

    // Default alphabetical sort (real sort happens after populate calls)
    const alphaSort = (n: TreeNode) => {
      n.children.sort((a, b) => a.title.localeCompare(b.title));
      for (const c of n.children) alphaSort(c);
    };
    for (const r of roots) alphaSort(r);
    roots.sort((a, b) => a.title.localeCompare(b.title));

    // Flatten — DFS but deduplicate (a DAG node may be reachable via multiple paths)
    const allNodes: TreeNode[] = [];
    const seen = new Set<string>();
    const walk = (n: TreeNode) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      allNodes.push(n);
      for (const c of n.children) walk(c);
    };
    for (const r of roots) walk(r);

    return { roots, allNodes, nodeMap };
  }

  /**
   * Resolve a raw property value to an array of file paths.
   *
   * Bases may return link properties in many forms:
   *   - A string: "[[Note]]" or "Note"
   *   - A TFile object: { path: "folder/Note.md", basename: "Note", ... }
   *   - An array of strings or TFile objects
   *   - A link object with .path or .display properties
   */
  private resolveLinks(
    rawValue: any,
    basenameToPath: Map<string, string>
  ): string[] {
    // Bases wraps property values in an object with a .data property.
    // Unwrap it first: { data: [...], icon: ..., type: ... } → [...]
    let unwrapped = rawValue;
    if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped) && 'data' in unwrapped) {
      unwrapped = unwrapped.data;
    }

    // Normalize to array
    const items: any[] = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
    const results: string[] = [];

    for (const val of items) {
      if (val == null) continue;

      const resolved = this.resolveSingleLink(val, basenameToPath);
      if (resolved) results.push(resolved);
    }

    return results;
  }

  /**
   * Resolve a single link value to a file path.
   */
  private resolveSingleLink(
    val: any,
    basenameToPath: Map<string, string>
  ): string | null {
    if (val == null) return null;

    // Case 1: TFile object (has .path and .basename)
    if (typeof val === 'object' && val.path && typeof val.path === 'string') {
      return val.path;
    }

    // Case 2: Link object with display name (some Bases internals)
    if (typeof val === 'object' && val.display && typeof val.display === 'string') {
      return this.resolveStringLink(val.display, basenameToPath);
    }

    // Case 3: String value (wikilink or plain text)
    if (typeof val === 'string') {
      return this.resolveStringLink(val, basenameToPath);
    }

    // Case 4: Try toString as last resort
    try {
      const str = String(val);
      if (str && str !== '[object Object]') {
        return this.resolveStringLink(str, basenameToPath);
      }
    } catch { return null; }

    return null;
  }

  /**
   * Resolve a string (possibly a wikilink) to a file path.
   */
  private resolveStringLink(
    str: string,
    basenameToPath: Map<string, string>
  ): string | null {
    // Strip wikilink brackets: [[Note Title]] or [[Note|Display]]
    const wikiMatch = str.match(/^\[\[(.+?)(?:\|.+?)?\]\]$/);
    const linkTarget = wikiMatch ? wikiMatch[1] : str.trim();
    if (!linkTarget) return null;

    // Try Obsidian's metadataCache
    const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(linkTarget, '');
    if (resolved) return resolved.path;

    // Fallback: match against basenames
    const lower = linkTarget.toLowerCase();
    if (basenameToPath.has(lower)) return basenameToPath.get(lower)!;

    return null;
  }

  // ─── Rendering ─────────────────────────────────────────────

  private render(
    allNodes: TreeNode[],
    parentProp: string,
    partnerProp: string | null,
    treeConfig: TreeConfig,
    viewMode: string = 'spatial'
  ): void {
    // Cleanup
    this.spatialRenderer?.destroy();
    this.spatialRenderer = null;
    this.indentedRenderer?.destroy();
    this.indentedRenderer = null;
    if (this.rootEl) this.rootEl.remove();

    const container = this.scrollEl.createDiv({ cls: 'branches-container' });
    this.rootEl = container;

    // Header
    const header = container.createDiv({ cls: 'branches-header' });
    const iconEl = header.createSpan({ cls: 'branches-header-icon' });
    setIcon(iconEl, 'network');
    header.createSpan({ cls: 'branches-header-title', text: 'Branches' });

    // Header toggle group (spatial mode only)
    if (viewMode === 'spatial') {
      const toggleGroup = header.createDiv({ cls: 'branches-header-toggles' });

      // Edge spacing toggle
      const spacingToggle = toggleGroup.createDiv({ cls: 'branches-spacing-toggle' });
      const spacingBtn = spacingToggle.createEl('button', {
        cls: 'branches-spacing-btn',
        attr: { 'aria-label': 'Toggle edge spacing' },
      });
      const spacingIcon = spacingBtn.createSpan({ cls: 'branches-spacing-icon' });
      setIcon(spacingIcon, 'separator-horizontal');
      const spacingLabel = spacingBtn.createSpan({
        cls: 'branches-spacing-label',
        text: 'Compact',
      });
      spacingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.spatialRenderer) return;
        const current = this.spatialRenderer.getEdgeSpacing();
        const next = current === 'compact' ? 'expanded' : 'compact';
        this.spatialRenderer.setEdgeSpacing(next);
        spacingLabel.textContent = next === 'compact' ? 'Compact' : 'Expanded';
      });

      // Free-arrange toggle
      const arrangeToggle = toggleGroup.createDiv({ cls: 'branches-spacing-toggle' });
      const arrangeBtn = arrangeToggle.createEl('button', {
        cls: 'branches-spacing-btn',
        attr: { 'aria-label': 'Toggle free arrange' },
      });
      const arrangeIcon = arrangeBtn.createSpan({ cls: 'branches-spacing-icon' });
      setIcon(arrangeIcon, 'move');
      const arrangeLabel = arrangeBtn.createSpan({
        cls: 'branches-spacing-label',
        text: 'Arrange',
      });
      arrangeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.spatialRenderer) return;
        const next = !this.spatialRenderer.getFreeArrange();
        this.spatialRenderer.setFreeArrange(next);
        arrangeBtn.classList.toggle('branches-spacing-btn--active', next);
        arrangeLabel.textContent = next ? 'Arranging' : 'Arrange';
      });

      // Lock toggle
      const autoLock = this.plugin.shouldAutoLock();
      const lockToggle = toggleGroup.createDiv({ cls: 'branches-spacing-toggle' });
      const lockBtn = lockToggle.createEl('button', {
        cls: `branches-spacing-btn${autoLock ? ' branches-spacing-btn--active' : ''}`,
        attr: { 'aria-label': 'Toggle lock (disables drag-to-create)' },
      });
      const lockIcon = lockBtn.createSpan({ cls: 'branches-spacing-icon' });
      setIcon(lockIcon, autoLock ? 'lock' : 'lock');
      const lockLabel = lockBtn.createSpan({
        cls: 'branches-spacing-label',
        text: autoLock ? 'Locked' : 'Lock',
      });
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.spatialRenderer) return;
        const next = !this.spatialRenderer.getLocked();
        this.spatialRenderer.setLocked(next);
        lockBtn.classList.toggle('branches-spacing-btn--active', next);
        lockLabel.textContent = next ? 'Locked' : 'Lock';
      });

      // Restore Defaults toggle
      const restoreToggle = toggleGroup.createDiv({ cls: 'branches-spacing-toggle' });
      const restoreBtn = restoreToggle.createEl('button', {
        cls: 'branches-spacing-btn',
        attr: { 'aria-label': 'Restore default layout' },
      });
      const restoreIcon = restoreBtn.createSpan({ cls: 'branches-spacing-icon' });
      setIcon(restoreIcon, 'rotate-ccw');
      restoreBtn.createSpan({
        cls: 'branches-spacing-label',
        text: 'Restore',
      });
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        new RestoreDefaultsModal(this.plugin.app, async () => {
          await this.plugin.clearPositions(this.scopeId);
          if (this.spatialRenderer) {
            this.spatialRenderer.resetPositions();
            // Turn off Arrange if active
            arrangeBtn.classList.remove('branches-spacing-btn--active');
            arrangeLabel.textContent = 'Arrange';
          }
          new Notice('Branches: Layout restored to defaults.');
        }).open();
      });
    }

    header.createSpan({
      cls: 'branches-header-meta',
      text: `${allNodes.length} notes · ${this.treeRoots.length} root${this.treeRoots.length !== 1 ? 's' : ''}`,
    });

    // Empty state
    if (allNodes.length === 0) {
      const empty = container.createDiv({ cls: 'branches-empty' });
      // Detect embed context — scrollEl may be inside a markdown-embed container
      const isEmbed = !!this.scrollEl.closest('.internal-embed, .markdown-embed');
      if (isEmbed) {
        empty.createEl('h3', { text: 'Embedded view' });
        empty.createEl('p', {
          text: 'Bases may not pass query results to embedded custom views. Open the .base file directly for the full tree.',
        });
      } else {
        empty.createEl('h3', { text: 'No tree structure found' });
        empty.createEl('p', {
          text: 'This view needs a property that links notes to other notes in this Base (like "parent" or "partOf").',
        });
      }
      return;
    }

    // ── Indented (List) mode ──
    if (viewMode === 'indented') {
      this.indentedRenderer = new IndentedRenderer(
        container,
        treeConfig,
        (node) => {
          this.plugin.app.workspace.openLinkText(node.id, '', false);
        },
        (node) => {
          this.plugin.app.workspace.openLinkText(node.id, '', 'tab');
        }
      );
      this.indentedRenderer.setContextMenuHandler((node, event) => {
        this.showNodeContextMenu(node, event, parentProp, partnerProp);
      });
      this.indentedRenderer.render(this.treeRoots, this.nodeMap);
      return;
    }

    // ── Spatial (Canvas) mode ──
    this.spatialRenderer = new SpatialRenderer(
      container,
      treeConfig,
      // onNodeClick: select
      (node) => {
        this.plugin.app.workspace.openLinkText(node.id, '', false);
      },
      // onNodeOpen: open in new tab
      (node) => {
        this.plugin.app.workspace.openLinkText(node.id, '', 'tab');
      },
      // onLink: drag-to-link (parent/child)
      (sourceId, targetId, mode) => {
        void this.handleLink(sourceId, targetId, mode, parentProp);
      },
      // onCreate: drag-to-empty creates new note (parent/child)
      (sourceId, newName, mode) => {
        void this.handleCreate(sourceId, newName, mode, parentProp);
      },
      // onPartnerLink: drag side-to-side links partners
      partnerProp
        ? (sourceId, targetId) => {
            void this.handlePartnerLink(sourceId, targetId, partnerProp);
          }
        : null,
      // onCreatePartner: drag side to empty creates a new partner note
      partnerProp
        ? (sourceId, newName) => {
            void this.handleCreatePartner(sourceId, newName, partnerProp);
          }
        : null,
      // onNodeMoved: persist manual position
      (nodeId, x, y) => {
        this.plugin.saveNodePosition(this.scopeId, nodeId, { x, y });
      },
      // storedPositions: load persisted positions
      this.plugin.getPositions(this.scopeId)
    );

    // Auto-lock on mobile/tablet if setting is enabled
    if (this.plugin.shouldAutoLock()) {
      this.spatialRenderer.setLocked(true);
    }

    // Context menu handler
    this.spatialRenderer.setContextMenuHandler((node, event) => {
      this.showNodeContextMenu(node, event, parentProp, partnerProp);
    });

    this.spatialRenderer.render(this.treeRoots, this.nodeMap);
  }

  // ─── Drag-to-link: write frontmatter ────────────────────────

  private async handleLink(
    sourceId: string,
    targetId: string,
    mode: 'parent' | 'child',
    parentProp: string
  ): Promise<void> {
    const app = this.plugin.app;

    // mode 'parent': dragged from top of source to target → add target as parent of source
    // mode 'child': dragged from bottom of source to target → add source as parent of target
    const childPath = mode === 'parent' ? sourceId : targetId;
    const parentPath = mode === 'parent' ? targetId : sourceId;

    const childFile = app.vault.getAbstractFileByPath(childPath);
    if (!(childFile instanceof TFile)) {
      new Notice('Branches: Could not find note to link.');
      return;
    }

    // Get the parent's display name for the wikilink
    const parentFile = app.vault.getAbstractFileByPath(parentPath);
    const parentName = parentFile instanceof TFile ? parentFile.basename : parentPath;
    const wikilink = `[[${parentName}]]`;

    // Bases uses "note.parent" as property ID but frontmatter key is just "parent"
    const fmKey = parentProp.startsWith('note.') ? parentProp.slice(5) : parentProp;

    try {
      await app.fileManager.processFrontMatter(childFile, (fm) => {
        const existing = fm[fmKey];

        if (!existing) {
          // No parent yet — set as single value
          fm[fmKey] = wikilink;
        } else if (Array.isArray(existing)) {
          // Already an array — append if not duplicate
          const normalized = existing.map((v: string) => String(v).toLowerCase());
          if (!normalized.includes(wikilink.toLowerCase())) {
            existing.push(wikilink);
          }
        } else {
          // Single value — convert to array
          const existingStr = String(existing);
          if (existingStr.toLowerCase() !== wikilink.toLowerCase()) {
            fm[fmKey] = [existingStr, wikilink];
          }
        }
      });
    } catch (err) {
      new Notice('Branches: Failed to link notes — ' + (err as Error).message);
    }
  }

  // ─── Drag-to-empty: create new note ──────────────────────

  private async handleCreate(
    sourceId: string,
    newName: string,
    mode: 'parent' | 'child',
    parentProp: string
  ): Promise<void> {
    const app = this.plugin.app;
    const fmKey = parentProp.startsWith('note.') ? parentProp.slice(5) : parentProp;

    // Determine folder: same folder as the source note
    const sourceFile = app.vault.getAbstractFileByPath(sourceId);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Branches: Could not find source note.');
      return;
    }
    const folder = sourceFile.parent?.path ?? '';
    const newPath = folder ? `${folder}/${newName}.md` : `${newName}.md`;

    // Don't overwrite existing files
    if (app.vault.getAbstractFileByPath(newPath)) {
      new Notice(`Branches: "${newName}" already exists.`);
      return;
    }

    try {
      if (mode === 'child') {
        const sourceName = sourceFile.basename;
        const content = `---\n${fmKey}: "[[${sourceName}]]"\n---\n`;
        await app.vault.create(newPath, content);
      } else {
        await app.vault.create(newPath, '');
        const wikilink = `[[${newName}]]`;
        await app.fileManager.processFrontMatter(sourceFile, (fm) => {
          const existing = fm[fmKey];
          if (!existing) {
            fm[fmKey] = wikilink;
          } else if (Array.isArray(existing)) {
            const normalized = existing.map((v: string) => String(v).toLowerCase());
            if (!normalized.includes(wikilink.toLowerCase())) {
              existing.push(wikilink);
            }
          } else {
            const existingStr = String(existing);
            if (existingStr.toLowerCase() !== wikilink.toLowerCase()) {
              fm[fmKey] = [existingStr, wikilink];
            }
          }
        });
      }
    } catch (err) {
      new Notice('Branches: Failed to create note — ' + (err as Error).message);
    }
  }

  // ─── Partnership: link two existing notes ──────────────────

  private async handlePartnerLink(
    sourceId: string,
    targetId: string,
    partnerProp: string
  ): Promise<void> {
    const app = this.plugin.app;
    const fmKey = partnerProp.startsWith('note.') ? partnerProp.slice(5) : partnerProp;

    const sourceFile = app.vault.getAbstractFileByPath(sourceId);
    const targetFile = app.vault.getAbstractFileByPath(targetId);
    if (!(sourceFile instanceof TFile) || !(targetFile instanceof TFile)) {
      new Notice('Branches: Could not find notes for partner link.');
      return;
    }

    // Add target to source's partner list
    await this.appendToFrontmatterList(sourceFile, fmKey, `[[${targetFile.basename}]]`);
    // Add source to target's partner list (bidirectional)
    await this.appendToFrontmatterList(targetFile, fmKey, `[[${sourceFile.basename}]]`);
  }

  // ─── Partnership: create new partner note ──────────────────

  private async handleCreatePartner(
    sourceId: string,
    newName: string,
    partnerProp: string
  ): Promise<void> {
    const app = this.plugin.app;
    const fmKey = partnerProp.startsWith('note.') ? partnerProp.slice(5) : partnerProp;

    const sourceFile = app.vault.getAbstractFileByPath(sourceId);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Branches: Could not find source note.');
      return;
    }

    const folder = sourceFile.parent?.path ?? '';
    const newPath = folder ? `${folder}/${newName}.md` : `${newName}.md`;

    if (app.vault.getAbstractFileByPath(newPath)) {
      new Notice(`Branches: "${newName}" already exists.`);
      return;
    }

    try {
      const content = `---\n${fmKey}: "[[${sourceFile.basename}]]"\n---\n`;
      await app.vault.create(newPath, content);
      await this.appendToFrontmatterList(sourceFile, fmKey, `[[${newName}]]`);
    } catch (err) {
      new Notice('Branches: Failed to create partner note — ' + (err as Error).message);
    }
  }

  // ─── Shared: append wikilink to a frontmatter list property ─

  private async appendToFrontmatterList(
    file: TFile,
    fmKey: string,
    wikilink: string
  ): Promise<void> {
    try {
      await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
        const existing = fm[fmKey];
        if (!existing) {
          fm[fmKey] = wikilink;
        } else if (Array.isArray(existing)) {
          const normalized = existing.map((v: string) => String(v).toLowerCase());
          if (!normalized.includes(wikilink.toLowerCase())) {
            existing.push(wikilink);
          }
        } else {
          const existingStr = String(existing);
          if (existingStr.toLowerCase() !== wikilink.toLowerCase()) {
            fm[fmKey] = [existingStr, wikilink];
          }
        }
      });
    } catch (err) {
      new Notice('Branches: Failed to update frontmatter — ' + (err as Error).message);
    }
  }

  // ─── Context menu ────────────────────────────────────────

  private showNodeContextMenu(
    node: TreeNode,
    event: MouseEvent,
    parentProp: string,
    partnerProp: string | null
  ): void {
    const menu = new Menu();
    const app = this.plugin.app;

    // ── Open actions ──
    menu.addItem((item) => {
      item.setTitle('Open note')
        .setIcon('file-text')
        .onClick(() => app.workspace.openLinkText(node.id, '', false));
    });
    menu.addItem((item) => {
      item.setTitle('Open in new tab')
        .setIcon('file-plus')
        .onClick(() => app.workspace.openLinkText(node.id, '', 'tab'));
    });
    menu.addItem((item) => {
      item.setTitle('Open to the right')
        .setIcon('separator-vertical')
        .onClick(() => app.workspace.openLinkText(node.id, '', 'split'));
    });

    menu.addSeparator();

    // ── Add actions ──
    menu.addItem((item) => {
      item.setTitle('Add parent…')
        .setIcon('arrow-up')
        .onClick(() => this.promptAndCreate(node.id, 'parent', parentProp));
    });
    menu.addItem((item) => {
      item.setTitle('Add child…')
        .setIcon('arrow-down')
        .onClick(() => this.promptAndCreate(node.id, 'child', parentProp));
    });
    if (partnerProp) {
      menu.addItem((item) => {
        item.setTitle('Add partner…')
          .setIcon('link')
          .onClick(() => this.promptAndCreate(node.id, 'partner', partnerProp));
      });
    }

    // ── Remove parent(s) ──
    if (node.parentIds.length > 0) {
      menu.addSeparator();
      for (const pid of node.parentIds) {
        const parentNode = this.nodeMap.get(pid);
        const parentLabel = parentNode?.title ?? pid;
        menu.addItem((item) => {
          item.setTitle(`Remove parent: ${parentLabel}`)
            .setIcon('x')
            .onClick(() => { void this.removeParent(node.id, pid, parentProp); });
        });
      }
    }

    // ── Remove child(ren) ──
    if (node.children.length > 0) {
      menu.addSeparator();
      for (const child of node.children) {
        menu.addItem((item) => {
          item.setTitle(`Remove child: ${child.title}`)
            .setIcon('x')
            .onClick(() => { void this.removeParent(child.id, node.id, parentProp); });
        });
      }
    }

    // ── Remove partner(s) ──
    if (partnerProp && node.partnerIds.length > 0) {
      menu.addSeparator();
      for (const pid of node.partnerIds) {
        const partnerNode = this.nodeMap.get(pid);
        const partnerLabel = partnerNode?.title ?? pid;
        menu.addItem((item) => {
          item.setTitle(`Remove partner: ${partnerLabel}`)
            .setIcon('unlink')
            .onClick(() => { void this.removePartner(node.id, pid, partnerProp); });
        });
      }
    }

    // ── Delete file ──
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('Delete note')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => { void this.deleteNote(node.id); });
    });

    menu.showAtMouseEvent(event);
  }

  /** Prompt for a name and create a new linked note (parent, child, or partner). */
  private promptAndCreate(
    sourceId: string,
    mode: 'parent' | 'child' | 'partner',
    prop: string
  ): void {
    // Re-use the SpatialRenderer's inline input if spatial view is active
    if (this.spatialRenderer) {
      const node = this.nodeMap.get(sourceId);
      if (!node) return;
      // Calculate a canvas position near the node for the input
      const offsetX = mode === 'partner' ? node.width + 40 : 0;
      const offsetY = mode === 'child' ? node.height + 40 : mode === 'parent' ? -50 : 0;
      this.spatialRenderer.showCreateInputPublic(
        node.x + offsetX, node.y + offsetY,
        sourceId, mode
      );
    }
  }

  // ─── Removal operations ───────────────────────────────────

  /** Remove a specific parent from a child's frontmatter. */
  private async removeParent(
    childId: string,
    parentId: string,
    parentProp: string
  ): Promise<void> {
    const app = this.plugin.app;
    const childFile = app.vault.getAbstractFileByPath(childId);
    if (!(childFile instanceof TFile)) return;

    const parentFile = app.vault.getAbstractFileByPath(parentId);
    const parentName = parentFile instanceof TFile ? parentFile.basename : parentId;
    const fmKey = parentProp.startsWith('note.') ? parentProp.slice(5) : parentProp;

    try {
      await app.fileManager.processFrontMatter(childFile, (fm) => {
        const existing = fm[fmKey];
        if (!existing) return;

        if (Array.isArray(existing)) {
          fm[fmKey] = existing.filter((v: string) => {
            const normalized = String(v).replace(/^\[\[|\]\]$/g, '').toLowerCase();
            return normalized !== parentName.toLowerCase();
          });
          // Unwrap single-element array
          if (fm[fmKey].length === 1) fm[fmKey] = fm[fmKey][0];
          if (fm[fmKey].length === 0) delete fm[fmKey];
        } else {
          const normalized = String(existing).replace(/^\[\[|\]\]$/g, '').toLowerCase();
          if (normalized === parentName.toLowerCase()) {
            delete fm[fmKey];
          }
        }
      });
    } catch (err) {
      new Notice('Branches: Failed to remove parent — ' + (err as Error).message);
    }
  }

  /** Remove a bidirectional partner relationship. */
  private async removePartner(
    sourceId: string,
    partnerId: string,
    partnerProp: string
  ): Promise<void> {
    const app = this.plugin.app;
    const fmKey = partnerProp.startsWith('note.') ? partnerProp.slice(5) : partnerProp;

    const sourceFile = app.vault.getAbstractFileByPath(sourceId);
    const partnerFile = app.vault.getAbstractFileByPath(partnerId);

    if (sourceFile instanceof TFile && partnerFile instanceof TFile) {
      await this.removeFromFrontmatterList(sourceFile, fmKey, partnerFile.basename);
      await this.removeFromFrontmatterList(partnerFile, fmKey, sourceFile.basename);
    }
  }

  /** Remove a wikilink from a frontmatter list/value. */
  private async removeFromFrontmatterList(
    file: TFile,
    fmKey: string,
    targetBasename: string
  ): Promise<void> {
    try {
      await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
        const existing = fm[fmKey];
        if (!existing) return;

        if (Array.isArray(existing)) {
          fm[fmKey] = existing.filter((v: string) => {
            const normalized = String(v).replace(/^\[\[|\]\]$/g, '').toLowerCase();
            return normalized !== targetBasename.toLowerCase();
          });
          if (fm[fmKey].length === 1) fm[fmKey] = fm[fmKey][0];
          if (fm[fmKey].length === 0) delete fm[fmKey];
        } else {
          const normalized = String(existing).replace(/^\[\[|\]\]$/g, '').toLowerCase();
          if (normalized === targetBasename.toLowerCase()) {
            delete fm[fmKey];
          }
        }
      });
    } catch (err) {
      new Notice('Branches: Failed to update frontmatter — ' + (err as Error).message);
    }
  }

  /** Delete a note file (moves to trash). */
  private async deleteNote(noteId: string): Promise<void> {
    const app = this.plugin.app;
    const file = app.vault.getAbstractFileByPath(noteId);
    if (!(file instanceof TFile)) return;

    try {
      await app.vault.trash(file, true);
      new Notice(`Branches: "${file.basename}" moved to trash.`);
    } catch (err) {
      new Notice('Branches: Failed to delete note — ' + (err as Error).message);
    }
  }
}
