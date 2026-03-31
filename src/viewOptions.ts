/**
 * Branches — View Options
 *
 * Defines the configuration panel options shown in the
 * Bases "Configure view" sidebar when a Tree view is active.
 */

export function getViewOptions(): any[] {
  return [
    // ── Property selectors ──
    {
      type: 'property',
      key: 'parentProp',
      displayName: 'Parent property',
      placeholder: 'e.g. parent, partOf',
    },
    {
      type: 'property',
      key: 'partnerProp',
      displayName: 'Partnership property',
      placeholder: 'e.g. spouse, partner',
    },
    {
      type: 'property',
      key: 'imageProp',
      displayName: 'Image property',
      placeholder: 'e.g. image, avatar, photo',
    },
    {
      type: 'property',
      key: 'colorProp',
      displayName: 'Color by',
      placeholder: 'Select property…',
    },
    {
      type: 'property',
      key: 'certaintyProp',
      displayName: 'Parentage certainty',
      placeholder: 'e.g. parentageCertain',
    },
    {
      type: 'property',
      key: 'labelProp',
      displayName: 'Subtitle property',
      placeholder: 'Shown below the title',
    },
    {
      type: 'property',
      key: 'subtitle2Prop',
      displayName: 'Secondary subtitle',
      placeholder: 'Second line below subtitle',
    },
    {
      type: 'property',
      key: 'childOrderProp',
      displayName: 'Child order',
      placeholder: 'e.g. dob, sortOrder, date',
    },

    // ── Layout direction ──
    {
      type: 'dropdown',
      key: 'layoutDirection',
      displayName: 'Layout direction',
      options: {
        TB: 'Top → Bottom',
        BT: 'Bottom → Top',
        LR: 'Left → Right',
        RL: 'Right → Left',
      },
    },

    // ── View mode ──
    {
      type: 'dropdown',
      key: 'viewMode',
      displayName: 'View mode',
      options: {
        spatial: 'Spatial (Canvas)',
        indented: 'Indented (List)',
      },
    },

    // ── Tooltip visible properties ──
    {
      type: 'text',
      key: 'tooltipProps',
      displayName: 'Tooltip properties',
      placeholder: 'e.g. parent, spouse, dob (comma-separated, max 7)',
    },

    // ── Avatar shape ──
    {
      type: 'dropdown',
      key: 'avatarShape',
      displayName: 'Avatar shape',
      options: {
        circle: 'Circle',
        'rounded-square': 'Rounded square',
      },
    },

    // ── Toggles ──
    {
      type: 'toggle',
      key: 'showChildCount',
      displayName: 'Show child count badges',
    },
    {
      type: 'toggle',
      key: 'showDotGrid',
      displayName: 'Canvas dot grid',
    },
  ];
}
