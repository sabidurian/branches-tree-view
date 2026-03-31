---
title: Branches Plugin — Security & Submission Audit
type: knowings
tags:
  - knowings
  - research
  - ephemeral
  - processes
  - tools
date: 2026-03-30
source: Claude Opus 4.6
notes: "Project: Branches Plugin, Conversation: Security Audit"
---

# Branches Plugin — Security & Submission Audit

This report covers all security, code quality, and Obsidian community plugin submission issues identified in the Branches tree-view plugin codebase, measured against Obsidian's official plugin review checklist and security scanning requirements.

## Obsidian Submission Requirements Summary

Obsidian's plugin review process enforces several automated and manual checks. Plugins are scanned with an ESLint-based tool that flags specific patterns. The key rules that apply to Branches are:

**Forbidden patterns** (auto-reject): `eval()`, `Function()` constructor, `innerHTML` / `outerHTML` assignment, dynamic `<script>` loading.

**Required practices**: keyboard accessibility on interactive elements, removal of sample/template code, proper `manifest.json` formatting, GitHub release tag matching manifest version exactly (no `v` prefix).

**Required files**: `manifest.json`, `main.js`, `styles.css` (optional), `LICENSE`, `README.md`.

---

## Audit Findings

### Critical — 3 Issues

**C1. Empty catch blocks suppress errors silently**

Files: `BranchesView.ts` (lines ~152, 156, 219–224, 660–665, 716–721, 753–758)

```typescript
try { parentVal = entry.getValue(parentProp); } catch { /* */ }
try { parentVal = entry.getValue(`note.${parentProp}` as any); } catch { /* */ }
```

The triple-try pattern for reading Bases values uses empty catch blocks throughout. If `getValue()` throws for an unexpected reason (corrupt data, API change), the failure is invisible. This masks bugs and makes debugging nearly impossible for end users.

**Fix:** Replace empty catch blocks with at minimum a `console.warn` in development, or use a shared utility that handles the try/catch centrally and logs on first failure.

---

**C2. Event listener memory leak in SpatialRenderer**

File: `SpatialRenderer.ts` (lines ~1079–1171)

`setupPanZoom()` and `buildControls()` attach `wheel`, `pointerdown`, `pointermove`, `pointerup`, and `dblclick` listeners to `this.container`. The `destroy()` method only calls `this.container.remove()`, which detaches the DOM element but does not explicitly unregister these listeners. If the container element is referenced elsewhere (e.g., by captured closures), the listeners and their closures remain in memory.

**Fix:** Store listener references as class fields and call `removeEventListener()` in `destroy()`. Alternatively, use an `AbortController` signal shared across all listeners for one-call cleanup:

```typescript
private abortController = new AbortController();

private setupPanZoom(): void {
  const signal = this.abortController.signal;
  this.container.addEventListener('wheel', handler, { passive: false, signal });
  // ...
}

destroy(): void {
  this.abortController.abort();
  this.container.remove();
}
```

---

**C3. Unsafe type assertion before file operations**

File: `BranchesView.ts` (lines ~1189, 1276)

```typescript
const folder = (sourceFile as TFile).parent?.path ?? '';
```

The code casts to `TFile` without verifying the abstract file is actually a `TFile` (it could be a `TFolder`). If `sourceFile` is null or a folder, this crashes at runtime.

**Fix:** Guard with `instanceof`:

```typescript
if (!(sourceFile instanceof TFile)) return;
const folder = sourceFile.parent?.path ?? '';
```

---

### High — 3 Issues

**H1. `console.log` statements in production code (Obsidian review blocker)**

Files: `main.ts` (lines 27, 45, 49), `BranchesView.ts` (lines ~728, 795)

```typescript
console.log('[Branches] Loading plugin…');
console.log('[Branches] Plugin loaded. Tree view registered.');
console.log(`[Branches] "${node.title}" parent raw:`, parentVal, ...);
```

Obsidian's plugin reviewer and automated ESLint scanner flag `console.log` calls. These are debug artifacts that should be stripped before submission. `console.warn` and `console.error` for genuine issues are acceptable.

**Fix:** Remove all `console.log` statements. Retain `console.warn` / `console.error` for actual failure conditions only.

---

**H2. Multiple `as any` type assertions bypass safety**

File: `BranchesView.ts` (lines ~154, 180, 221, 224, 662, 665, 718, 721, 755, 758)

```typescript
entry.getValue(`note.${name}` as any);
```

These are used in the triple-try pattern to coerce string property paths. They suppress TypeScript's type system entirely, meaning a future Bases API change could introduce silent breakage.

**Fix:** Create a typed helper:

```typescript
function readEntryValue(entry: BasesEntry, prop: string): unknown {
  const paths = [prop, `note.${prop}`, prop.replace(/^note\./, '')];
  for (const p of paths) {
    try { const v = entry.getValue(p as any); if (v != null) return v; } catch { /* */ }
  }
  return null;
}
```

This centralizes both the `as any` and the catch logic, keeping it contained.

---

**H3. User-facing operations fail silently**

File: `BranchesView.ts` (lines ~1145–1231, 1284–1323)

Drag-to-link and drag-to-create operations write frontmatter via `vault.modify()`. If these fail (e.g., file locked, disk full), the error is caught and logged to console, but the user sees no feedback.

**Fix:** Use Obsidian's `Notice` API to surface failures:

```typescript
import { Notice } from 'obsidian';

catch (err) {
  new Notice('Branches: Failed to update note — ' + (err as Error).message);
  console.error('[Branches] handleLink failed:', err);
}
```

---

### Medium — 3 Issues

**M1. No filename validation on create-on-drop input**

File: `SpatialRenderer.ts` (lines ~1019–1030)

```typescript
const newName = input.value.trim();
if (!newName) return;
this.onCreate(sourceId, newName, mode);
```

The input allows characters forbidden in filenames (`/ \ : * ? " < > |`). Obsidian may handle some of these internally, but passing invalid names could cause unexpected behavior or errors downstream.

**Fix:** Validate before committing:

```typescript
const INVALID_CHARS = /[\/\\:*?"<>|]/;
if (!newName || INVALID_CHARS.test(newName)) {
  new Notice('Invalid note name');
  return;
}
```

---

**M2. `instanceof TFile` check missing on image resolution**

File: `BranchesView.ts` (line ~252)

```typescript
const imgFile = app.metadataCache.getFirstLinkpathDest(imgPath, file.path)
  ?? app.vault.getAbstractFileByPath(imgPath);
if (imgFile && 'path' in imgFile) {
  node.imageUrl = app.vault.getResourcePath(imgFile as TFile);
}
```

The `'path' in imgFile` check passes for both `TFile` and `TFolder`. Passing a `TFolder` to `getResourcePath()` would fail.

**Fix:** Replace with `imgFile instanceof TFile`.

---

**M3. Race condition window in create-input blur handler**

File: `SpatialRenderer.ts` (line ~1058)

```typescript
const onBlur = () => {
  setTimeout(() => { if (wrapper.isConnected) commit(); }, 120);
};
```

The 120ms delay creates a window where the view could be destroyed between the blur event and the timeout firing, causing stale state access. The `isConnected` check mitigates the worst case, but a destroyed renderer could still receive the callback.

**Fix:** Add an `isActive` flag that `destroy()` sets to false, and check it in the timeout.

---

### Low — 5 Issues

**L1. `minAppVersion` in manifest.json may be stale**

The manifest specifies `"minAppVersion": "1.10.0"` — verify this is the actual minimum Obsidian version supporting the Bases API. If Bases was introduced later, this should be updated.

---

**L2. Missing `LICENSE` file**

The Obsidian submission checklist requires a `LICENSE` file in the repository root. Verify this exists before submitting.

---

**L3. Missing `README.md`**

A `README.md` with usage instructions is required for submission. Should describe what the plugin does, how to configure it, and include screenshots.

---

**L4. No keyboard accessibility on header toggle buttons**

The Compact, Arrange, and Lock buttons are created as `<button>` elements (good — inherently focusable), but verify they have visible focus indicators. Obsidian reviewers check that all interactive elements are keyboard-navigable with visible focus states.

---

**L5. Inconsistent error message detail**

Warning messages like `console.warn('[Branches] Could not find child file:', childPath)` lack context about what the user was trying to do. Standardize error messages to include the operation that failed.

---

## Positive Findings

The codebase demonstrates several security best practices:

- **No `innerHTML` or `outerHTML`** — all DOM construction uses Obsidian's `createDiv()` / `createEl()` / `createSpan()` helpers and `document.createElementNS()` for SVG, which are safe from injection
- **No `eval()` or `Function()` constructor** — no dynamic code execution
- **No external network requests** — zero `fetch()`, `XMLHttpRequest`, or outbound calls
- **No hardcoded secrets or tokens**
- **Well-scoped CSS** — all selectors use the `branches-` prefix; no `!important` overrides; no global selectors that could bleed into Obsidian's UI
- **Proper dependency footprint** — only `dagre` as a runtime dependency, which is a well-established layout library
- **Clean separation of concerns** — types, layout, rendering, and view logic are in separate modules

---

## Priority Fix Order for Submission Readiness

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | H1: Remove all `console.log` statements | Low |
| 2 | C2: Fix event listener memory leak | Medium |
| 3 | C1: Replace empty catch blocks with logging utility | Medium |
| 4 | C3: Add `instanceof TFile` guards | Low |
| 5 | H3: Surface errors to users via `Notice` | Low |
| 6 | H2: Centralize `as any` in a helper function | Medium |
| 7 | M1: Validate filenames on create input | Low |
| 8 | M2: Fix image file type check | Low |
| 9 | L2–L3: Add LICENSE and README | Low |
| 10 | L4: Verify keyboard focus indicators | Low |

---

## Sources

- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Obsidian Submission Requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Obsidian Plugin Security](https://help.obsidian.md/plugin-security)
- [obsidian-releases GitHub Repository](https://github.com/obsidianmd/obsidian-releases)
- [obsidian-sample-plugin Template](https://github.com/obsidianmd/obsidian-sample-plugin)
- [CVE-2021-42057 — eval() vulnerability in obsidian-dataview](https://github.com/blacksmithgu/obsidian-dataview/issues/615)
- [Obsidian Forum — Plugin Security Discussion](https://forum.obsidian.md/t/security-of-the-plugins/7544)
