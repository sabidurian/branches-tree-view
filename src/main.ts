import { Notice, Platform, Plugin } from 'obsidian';
import { BranchesView } from './BranchesView';
import { getViewOptions } from './viewOptions';
import { BranchesSettings, BranchesSettingTab, DEFAULT_SETTINGS } from './settings';

const BRANCHES_VIEW_TYPE = 'branches-tree';

/** Stored position for a single node. */
export interface StoredPosition {
  x: number;
  y: number;
}

/** Full plugin data shape. */
interface BranchesData {
  /** Manual card positions keyed by Base scope ID → node ID → position. */
  positions: Record<string, Record<string, StoredPosition>>;
}

const DEFAULT_DATA: BranchesData = { positions: {} };

export default class BranchesPlugin extends Plugin {
  private data_: BranchesData = DEFAULT_DATA;
  settings: BranchesSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    const raw = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    this.data_ = { positions: raw?.positions ?? {} };

    this.addSettingTab(new BranchesSettingTab(this.app, this));

    this.registerBasesView(BRANCHES_VIEW_TYPE, {
      name: 'Tree',
      icon: 'lucide-network',
      factory: (controller, containerEl) =>
        new BranchesView(controller, containerEl, this),
      options: getViewOptions,
    });
  }

  onunload(): void {
    // cleanup handled by Obsidian
  }

  // ── Settings API ──

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, positions: this.data_.positions });
  }

  /** Returns true if lock should be auto-enabled (lockOnMobile + mobile platform). */
  shouldAutoLock(): boolean {
    return this.settings.lockOnMobile && (Platform.isMobile || Platform.isTablet);
  }

  // ── Position persistence API ──

  /** Get all stored positions for a given Base scope. */
  getPositions(scopeId: string): Record<string, StoredPosition> {
    return this.data_.positions[scopeId] ?? {};
  }

  /** Save a single node's position within a Base scope. */
  async saveNodePosition(scopeId: string, nodeId: string, pos: StoredPosition): Promise<void> {
    if (!this.data_.positions[scopeId]) {
      this.data_.positions[scopeId] = {};
    }
    this.data_.positions[scopeId][nodeId] = pos;
    await this.saveData({ ...this.settings, positions: this.data_.positions });
  }

  /** Save all positions for a scope at once (batch). */
  async saveAllPositions(scopeId: string, positions: Record<string, StoredPosition>): Promise<void> {
    this.data_.positions[scopeId] = positions;
    await this.saveData({ ...this.settings, positions: this.data_.positions });
  }

  /** Clear stored positions for a scope. */
  async clearPositions(scopeId: string): Promise<void> {
    delete this.data_.positions[scopeId];
    await this.saveData({ ...this.settings, positions: this.data_.positions });
  }
}
