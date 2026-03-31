/**
 * Branches — Plugin Settings Tab
 *
 * Global plugin-level settings (separate from per-view Bases config).
 */

import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

export interface BranchesSettings {
  /** Automatically lock drag-to-create on mobile / touch devices. */
  lockOnMobile: boolean;
}

export const DEFAULT_SETTINGS: BranchesSettings = {
  lockOnMobile: false,
};

export class BranchesSettingTab extends PluginSettingTab {
  private plugin: Plugin & { settings: BranchesSettings; saveSettings: () => Promise<void> };

  constructor(
    app: App,
    plugin: Plugin & { settings: BranchesSettings; saveSettings: () => Promise<void> },
  ) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Branches' });

    new Setting(containerEl)
      .setName('Lock on mobile')
      .setDesc(
        'Automatically lock the tree on touch / mobile devices to prevent accidental note creation and relationship changes.',
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.lockOnMobile)
          .onChange(async (value) => {
            this.plugin.settings.lockOnMobile = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
