// Every keyboard shortcut the app handles, grouped for the cheatsheet overlay (? or F1).
//
// Each item has `keys` and `action`. `keys` is a list of alternatives, shown with "/" between them.
// Each alternative is a list of keys pressed together, shown with "+" between them, e.g. ['Ctrl', 'L'].
// Each group names the handler it mirrors in its comment. When a handler's keys change, change them here too.
export const SHORTCUT_GROUPS = [
  {
    // AssetGrid.jsx (keyboard listener), App.jsx (Ctrl + L, F5 / Ctrl + R, Alt + arrows, mouse side buttons, Delete,
    // F2, Alt + Up, Ctrl + F, Ctrl + Shift + C, right-click on empty space)
    title: 'Folders and selection',
    items: [
      { keys: [['Arrow keys']], action: 'Move the selection (up and down move a row)' },
      { keys: [['Shift', 'Arrow keys']], action: 'Extend the selection from the anchor item' },
      { keys: [['Home'], ['End']], action: 'First / last item' },
      { keys: [['Page Up'], ['Page Down']], action: 'Move a screen at a time' },
      { keys: [['Enter']], action: 'Open the selected folder or file' },
      { keys: [['Backspace'], ['Alt', 'Up']], action: 'Go up to the parent folder' },
      { keys: [['Alt', 'Left'], ['Alt', 'Right']], action: 'Back / forward through folder history' },
      { keys: [['Mouse back'], ['Mouse forward']], action: 'Side buttons on the mouse: back / forward' },
      { keys: [['Ctrl', 'L'], ['Alt', 'D']], action: 'Type a folder path or network address' },
      { keys: [['Ctrl', 'F']], action: 'Type in the filter box (top right)' },
      { keys: [['Delete']], action: 'Delete the selected files and folders: moved to the Recycle Bin after a confirm' },
      { keys: [['Shift', 'Delete']], action: 'Delete the selection for good, skipping the Recycle Bin (type DELETE to confirm)' },
      { keys: [['F2']], action: 'Rename the selected item (one item at a time)' },
      { keys: [['Ctrl', 'Shift', 'C']], action: 'Copy the path of the selected item (one path per line for a selection)' },
      { keys: [['F5'], ['Ctrl', 'R']], action: 'Refresh this folder in place (same folder, selection and view)' },
      { keys: [['Ctrl', 'A']], action: 'Select all' },
      { keys: [['Right-click']], action: 'Menu for the item, or on empty space: Refresh the folder in place' },
      { keys: [['Click']], action: 'Select one item' },
      { keys: [['Ctrl', 'Click']], action: 'Add or remove one item' },
      { keys: [['Shift', 'Click']], action: 'Select a range' },
      { keys: [['Ctrl', 'Shift', 'Click']], action: 'Add a range to the selection' },
      { keys: [['Drag']], action: 'Box select: drag on empty space' },
      { keys: [['Ctrl', 'Mouse wheel']], action: 'Resize thumbnails (Large icons view)' }
    ]
  },
  {
    // App.jsx (I and Alt + Enter, and the Inspector button in the breadcrumb bar), InspectorDrawer.jsx
    title: 'Inspector drawer',
    items: [
      { keys: [['I'], ['Alt', 'Enter']], action: 'Show or hide the Inspector: details of the selected file, beside the grid' }
    ]
  },
  {
    // Every viewer's own Escape handler (ImageViewer, TxTexViewer, VideoPlayer, ImageSequencePlayer, AudioPlayer,
    // PdfViewer, Viewport3D, HdrExrInspector)
    title: 'Any viewer',
    items: [{ keys: [['Esc']], action: 'Close the viewer (leaves full screen first)' }]
  },
  {
    // useQuickLook.js (Space and Esc), QuickLookWindow.jsx (the floating preview)
    title: 'Quick Look',
    items: [
      { keys: [['Space']], action: 'Open the selected file in a small floating preview (audio and video start playing)' },
      { keys: [['Space'], ['Esc']], action: 'Close the floating preview' },
      { keys: [['Arrow keys']], action: 'While the preview is open, move through the folder and the preview follows' },
      { keys: [['Double-click']], action: 'Open the file in the full viewer (also from the floating preview)' }
    ]
  },
  {
    // ImageViewer.jsx, TxTexViewer.jsx
    title: 'Image and texture viewers',
    items: [
      { keys: [['Left'], ['Right']], action: 'Previous / next image or texture' },
      { keys: [['Z', 'Drag']], action: 'Zoom: hold Z and drag (image viewer)' },
      { keys: [['Ctrl', '0']], action: 'Fit to screen (or hold Z and press 0)' }
    ]
  },
  {
    // VideoPlayer.jsx, ImageSequencePlayer.jsx (the two share these keys)
    title: 'Video and image sequences',
    items: [
      { keys: [['Space']], action: 'Play / pause' },
      { keys: [['Left'], ['Right'], [','], ['.']], action: 'Step one frame back / forward (Shift + Left / Right: one second)' },
      { keys: [['Home'], ['End']], action: 'First / last frame (image sequences)' },
      { keys: [['I'], ['[']], action: 'Set the in point of the loop' },
      { keys: [['O'], [']']], action: 'Set the out point of the loop' },
      { keys: [['\\']], action: 'Clear the loop' },
      { keys: [['S']], action: 'Snapshot the current frame' },
      { keys: [['F']], action: 'Full screen' },
      { keys: [['1 – 6']], action: 'Show RGB, R, G, B, alpha or luminance only' },
      { keys: [['C']], action: 'Cycle through the channel views' },
      { keys: [['E', 'Drag']], action: 'Exposure: hold E and drag' },
      { keys: [['E', '+'], ['E', '-']], action: 'Step exposure by 0.5 while E is held' },
      { keys: [['E', '0']], action: 'Reset exposure while E is held' },
      { keys: [['Z', 'Drag']], action: 'Zoom: hold Z and drag' },
      { keys: [['Z', '0']], action: 'Reset zoom while Z is held' }
    ]
  },
  {
    // AudioPlayer.jsx
    title: 'Audio player',
    items: [
      { keys: [['Space']], action: 'Play / pause' },
      { keys: [['Left'], ['Right']], action: 'Back / forward 5 seconds' },
      { keys: [['L']], action: 'Loop on / off' }
    ]
  },
  {
    // PdfViewer.jsx
    title: 'PDF viewer',
    items: [
      { keys: [['Page Down'], ['Space']], action: 'Next page' },
      { keys: [['Page Up'], ['Shift', 'Space']], action: 'Previous page' },
      { keys: [['Home'], ['End']], action: 'First / last page' },
      { keys: [['Up'], ['Down']], action: 'Scroll a little' },
      { keys: [['Left'], ['Right']], action: 'Previous / next file' },
      { keys: [['+'], ['-']], action: 'Zoom in / out' },
      { keys: [['Ctrl', '0']], action: 'Fit width' },
      { keys: [['Ctrl', '1']], action: 'Actual size (100%)' },
      { keys: [['F']], action: 'Fit page' },
      { keys: [['R']], action: 'Rotate 90 degrees' }
    ]
  },
  {
    // Viewport3D.jsx
    title: '3D model viewer',
    items: [
      { keys: [['F']], action: 'Frame the model' },
      { keys: [['O']], action: 'Show / hide the outliner (prim tree; click a prim to select and frame it)' },
      { keys: [['Numpad 1'], ['Numpad 3'], ['Numpad 7']], action: 'Front, right or top view (Ctrl: back or left for 1 and 3)' },
      { keys: [['Numpad 5']], action: 'Toggle orthographic view' }
    ]
  },
  {
    // HdrExrInspector.jsx
    title: 'HDR and EXR inspector',
    items: [
      { keys: [['Z', 'Drag']], action: 'Zoom: hold Z and drag' },
      { keys: [['0']], action: 'Reset zoom' },
      { keys: [['E', 'Drag']], action: 'Exposure: hold E and drag' },
      { keys: [['E', '+'], ['E', '-']], action: 'Step exposure by 0.5 while E is held' },
      { keys: [['E', '0']], action: 'Reset exposure while E is held' },
      { keys: [['V']], action: 'Flip vertically' },
      { keys: [['F']], action: 'Fit view' },
      { keys: [['W']], action: 'Wipe on / off' },
      { keys: [['P']], action: 'Probes on / off' },
      { keys: [['I'], ['N']], action: 'Show / hide the sidebar' }
    ]
  },
  {
    // CompareView.jsx, CompareVideoTransport.jsx
    title: 'Compare',
    items: [
      { keys: [['Space']], action: 'Switch between A and B (images and 3D models)' },
      { keys: [['X']], action: 'Switch between A and B (video)' },
      { keys: [['1'], ['2'], ['3'], ['4']], action: 'Wipe, split, toggle and diff modes (4 is not for 3D models)' },
      { keys: [['R']], action: 'Reset the view (F also does it for 3D models)' },
      { keys: [['Space']], action: 'Play / pause the video compare' },
      { keys: [['Left'], ['Right']], action: 'Step one frame in the video compare (Shift: one second)' },
      { keys: [['Home']], action: 'Back to the start of the video compare' }
    ]
  },
  {
    // PathInput.jsx, SortMenu.jsx, ItemContextMenu.jsx, LabelPanels.jsx, FolderIconPicker.jsx
    title: 'Menus and the address box',
    items: [
      { keys: [['Enter']], action: 'Go to the path typed in the address box (Esc cancels)' },
      { keys: [['Esc']], action: 'Close the sort, context, label or icon menu' }
    ]
  },
  {
    // ShortcutCheatsheet.jsx
    title: 'This list',
    items: [
      { keys: [['?'], ['F1']], action: 'Show or hide this list' },
      { keys: [['Esc']], action: 'Close this list' }
    ]
  }
];
