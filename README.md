

# Branches

**Interactive tree and DAG visualization for Obsidian Bases.**

Branches adds a "Tree" view to Obsidian's built-in Bases feature, turning flat note collections into navigable, interactive hierarchies. Think family trees, org charts, project breakdowns, taxonomies, or any structure where notes have parent-child relationships.

The plugin draws inspiration from visual mind-mapping tools like MindNode, XMind, Scapple, and Miro, aiming to combine the spatial freedom of a canvas with the structured clarity of an outliner, all inside your Obsidian vault with no data lock-in.

### Spatial (Canvas) View
#### (Top-to-Bottom Example)
![tree-view-spatial-top-bottom](https://github.com/user-attachments/assets/adb6f0ef-480f-477b-a2a4-817255e8a85a)

#### (Left-to-Right Example)
![tree-view-spatial-left-right](https://github.com/user-attachments/assets/09f9b6bf-e0e3-4a16-98f5-3c9bd2476bd2)

#### (Manual Arrangement Example)
![tree-view-left-right-arrange-manually](https://github.com/user-attachments/assets/d906c0ea-c8e5-4805-a1c0-3e9d655feaa6)

### Indented (List) View
#### (Base View on Left / Added to Sidebar on Right)
![tree-view-normal-and-in-sidebar](https://github.com/user-attachments/assets/19424a99-d9f5-4ed5-9c8f-c27c1b7b0962)


---

## Features at a Glance

### Two View Modes

- **Spatial (Canvas)** — A pannable, zoomable infinite canvas with node cards connected by SVG edges. Drag to rearrange, scroll to zoom, and build relationships by dragging between nodes.
- **Indented (List)** — A collapsible outliner that renders the same tree as a compact, scrollable list with expand/collapse chevrons. Ideal for quick scanning and deep hierarchies.

### Relationship Management

- **Parent/child linking** — Drag from the top or bottom handle of any node to another to set a parent-child relationship (writes to frontmatter automatically)
- **Partnership linking** — Drag from the side handles to create bidirectional peer relationships (e.g., spouse, collaborator, co-author)
- **Drag-to-create** — Drag a handle into empty space to create a brand new note with the relationship pre-wired
- **Multi-parent (DAG) support** — Notes can have multiple parents, rendered with distinct multi-parent edge styling
- **Cycle detection** — Circular references are automatically detected and safely broken

### Node Cards

- **Title** from the note filename
- **Subtitle and secondary subtitle** from any frontmatter property
- **Avatar/image** from a linked image property (circle or rounded-square shape)
- **Color stripe** — automatic categorical coloring from a chosen property (144 distinct colors) or direct hex values
- **Child count badge** — pill indicator showing number of children, overlaid on the avatar when present
- **Hover tooltips** — configurable display of up to 7 frontmatter properties on hover, with automatic wiki-link bracket stripping

### Canvas Controls (Spatial View)

- **Compact / Expanded** — Toggle edge spacing density
- **Arrange** — Free-arrange mode for manual node positioning (positions persist across sessions)
- **Lock** — Disables all drag-to-create and drag-to-link to prevent accidental edits
- **Restore Defaults** — Returns all nodes to the automatic dagre layout (with confirmation dialog)
- **Zoom controls** — Plus, minus, and fit-to-view buttons

### Keyboard Navigation

- **Spatial view** — Arrow keys navigate the tree in a direction-aware way (adapts to TB/BT/LR/RL layout), Enter opens a note, Space toggles expand/collapse, Escape deselects
- **Indented view** — Up/Down walks the visible list, Right expands, Left collapses (or navigates to parent), Enter opens, Space toggles, Escape deselects

### Right-Click Context Menu (Both Views)

- Open note / Open in new tab / Open to the right
- Add parent, child, or partner
- Remove specific parent, child, or partner relationships
- Delete note (moves to system trash with confirmation)

### Configure View Options

All options are accessible from the Bases "Configure view" sidebar:

| Option | Description |
|---|---|
| Parent property | Which frontmatter field defines the parent (auto-detects common names like `parent`, `partOf`) |
| Partnership property | Bidirectional peer relationship field (e.g., `spouse`, `partner`) |
| Image property | Frontmatter field pointing to a note's avatar image |
| Color by | Property used for automatic color assignment |
| Parentage certainty | Boolean property — `false` renders a dashed edge instead of solid |
| Subtitle property | Text shown below the node title |
| Secondary subtitle | Second line below the subtitle |
| Child order | Numeric or date property used to sort children (e.g., `dob`, `sortOrder`) |
| Layout direction | Top-to-bottom, bottom-to-top, left-to-right, or right-to-left |
| View mode | Spatial (Canvas) or Indented (List) |
| Tooltip properties | Comma-separated list of frontmatter keys to show on hover (max 7) |
| Avatar shape | Circle or rounded square |
| Show child count badges | Toggle badge visibility |
| Canvas dot grid | Toggle background dot pattern |

### Style Settings Integration

With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) community plugin installed, Branches exposes 35+ customizable properties across 8 categories:

- **Node Cards** — background color, border radius, shadow opacity, padding, font sizes, color stripe width
- **Avatars** — size, border width
- **Edges** — stroke widths for single-parent, multi-parent, and partnership edges; partnership dash pattern
- **Canvas** — background blend amount, dot grid spacing
- **Zoom Controls** — border radius, button size, shadow opacity
- **Badges** — font size, overlay badge size
- **Indented View** — row height, avatar size, title/subtitle font sizes, color dot size, badge font size
- **Tooltips** — font size, background color, border radius, shadow opacity, max width

### Plugin Settings

- **Lock on Mobile** — Automatically engages Lock mode on touch/mobile devices to prevent accidental drag actions

---

## Usage Guide

### Getting Started

1. Install the Branches plugin
2. Create or open a `.base` file in Obsidian
3. Click the view selector in the Bases toolbar and choose **Tree**
4. If your notes already have a `parent` property (or similar), Branches will auto-detect it and render the hierarchy immediately

If no parent property is found, open **Configure view** from the Bases sidebar and select which property defines the parent-child relationship.

### Family Trees and Genealogies

Family trees are one of the most natural fits for Branches. Set up your Base with person notes that have:

- `parent` — linking to one or two parent notes (multi-parent is supported)
- `spouse` or `partner` — for partnership relationships (rendered as dashed horizontal edges with gradient coloring)
- `dob` — as the child order property, so siblings sort chronologically
- `image` — for avatar photos on each card
- `parentageCertain` — a boolean field; set to `false` to render uncertain lineages with dotted edges

Choose **Bottom → Top** layout direction for a traditional genealogy chart where ancestors sit above descendants. Enable the **Color by** option on a property like `surname` or `house` to visually distinguish family branches.

The **partnership linking** feature is especially useful here: drag from the side handle of one person to another to create a bidirectional spouse/partner relationship. Both notes' frontmatter updates automatically.

### Organizational Charts

For company or team structures:

- `parent` or `reportsTo` — links each person to their manager
- `department` — use as the Color by property to color-code by team
- `title` — set as the Subtitle property to show job titles on cards
- `location` — set as Secondary subtitle for office location

Choose **Top → Bottom** layout. Use **Compact** edge spacing for tighter orgs, **Expanded** for readability. The **child count badge** quickly shows team sizes at each level.

When onboarding changes, drag a person's top handle to a new manager to reassign reporting lines — Branches updates the frontmatter instantly.

### Project and Task Breakdown Structures

Break complex projects into phases, workstreams, and tasks:

- `partOf` — links sub-tasks to their parent task or phase
- `status` — use as Color by (e.g., "in-progress" gets one color, "complete" another)
- `assignee` — set as Subtitle to see who owns each item
- `priority` or `sortOrder` — set as Child order to control display sequence

The **Indented (List) view** works particularly well for task breakdowns — it's compact, scannable, and the expand/collapse chevrons let you focus on one branch at a time. Use keyboard navigation (arrow keys + Space to toggle) for rapid scanning.

### Taxonomies and Knowledge Hierarchies

For categorizing notes into subject hierarchies (e.g., biology taxonomy, design system component trees, legal code structures):

- `parent` — the classification hierarchy
- No image, subtitle, or partner needed — keep it minimal
- **Left → Right** layout gives a wide, readable tree for deep taxonomies

The **Indented view** mirrors a traditional outline and works well when hierarchies go 5+ levels deep. The **Spatial view** gives a bird's-eye perspective of the full structure.

### Worldbuilding and Fiction Planning

Map fictional worlds, story structures, or character relationships:

- `parent` — for organizational hierarchies (kingdoms → regions → cities) or story act structure
- `partner` or `ally` — for character relationship webs
- `image` — character portraits or location images
- `faction` or `house` — use as Color by for political/faction coloring

Use **Arrange mode** to manually position nodes after the initial layout, creating spatial clusters that reflect narrative proximity. Positions persist across sessions, so your custom arrangement is never lost.

### Switching Between Views

Both views show the same data — switch freely between them using the **View mode** dropdown in Configure view:

- Use **Spatial** when you need the big picture, want to manually arrange nodes, or are actively building new relationships by dragging
- Use **Indented** when you need to quickly scan a deep hierarchy, find a specific node, or work through the tree systematically with keyboard navigation

---

## Planned Features & Known Issues

The following capabilities are planned but not yet implemented:

- **Export / Sharing** — Export the tree as a PNG or SVG image, or copy a date range to clipboard for use in presentations and documents
- **ARIA Accessibility Support** — Full screen reader compatibility with ARIA roles, labels, and live regions for both views
- **Embedded Base Support** — Rendering the tree view inside another note via `![[file.base]]` embeds (currently under investigation; may involve Obsidian platform limitations)

---

