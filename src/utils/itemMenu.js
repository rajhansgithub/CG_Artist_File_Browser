import { Copy, Eye, ExternalLink, FileOutput, FolderOpen, FolderSearch, ImagePlus, Layers, Pencil, Play, RefreshCw, RotateCcw, Send, Star, StarOff, Tag, Trash2 } from 'lucide-react';
import { isComparableItem, isConvertibleItem } from './formatHelpers';

// Drive roots (C:) and share roots (\\server\share) can't be renamed or deleted from the app
export function isRootLocation(path) {
  const s = String(path || '').replace(/\//g, '\\').replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(s) || /^\\\\[^\\]+\\[^\\]+$/.test(s);
}

// Extension point: a feature (labels, tags, ...) registers a provider once and returns extra entries for the
// items the menu was opened on. Each entry is { id, label, icon?, onSelect, disabled?, danger? }.
const providers = [];
export function registerItemMenuProvider(provider) {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

// Entries for the right-click menu. `items` is what the menu was opened on (one item today, a selection later).
// `actions` holds the app's handlers and state: isFavorite, hasIconChoice, sequenceFor, onOpen, onOpenExternal,
// onSetCompareA, onSetCompareB, onPlaySequence, onCopyPaths, onEditLabels, onReveal, onToggleFavorite, onChangeIcon,
// onResetIcon, onRename, onDelete, textureSetFor, onViewTextureSet, externalApps (the apps from Settings), onSendTo,
// onConvert (the images that can be converted, as one list).
export function buildItemMenu(items, actions) {
  const entries = [];
  const add = (entry) => entries.push(entry);
  const separator = () => {
    if (entries.length && !entries[entries.length - 1].separator) entries.push({ separator: true });
  };
  const single = items.length === 1 ? items[0] : null;
  const hasSequence = items.some((item) => item.isSequence);

  if (single) {
    add({
      id: 'open',
      label: 'Open',
      icon: single.isDirectory ? FolderOpen : Eye,
      onSelect: () => actions.onOpen(single)
    });
    if (!single.isDirectory) {
      add({ id: 'open-external', label: 'Open with default app', icon: ExternalLink, onSelect: () => actions.onOpenExternal(single) });
    }
    // A frame of a numbered series can be played as one clip; the grid itself shows every file on its own
    const sequence = !single.isDirectory && actions.sequenceFor(single);
    if (sequence) {
      add({ id: 'play-sequence', label: 'Play as sequence', icon: Play, onSelect: () => actions.onPlaySequence(sequence) });
    }
    // Opt-in only: a file with real sibling maps (wood_basecolor next to wood_normal) can be viewed as its texture set
    const textureSet = !single.isDirectory && actions.textureSetFor?.(single);
    if (textureSet) {
      add({ id: 'texture-set', label: 'View as texture set', icon: Layers, onSelect: () => actions.onViewTextureSet(textureSet) });
    }
    if (isComparableItem(single)) {
      add({ id: 'compare-a', label: 'Set as compare slot A', onSelect: () => actions.onSetCompareA(single) });
      add({ id: 'compare-b', label: 'Set as compare slot B', onSelect: () => actions.onSetCompareB(single) });
    }
  }

  // Files (not folders or image sequences) go to each app set up in Settings > External apps; a selection goes in one launch
  const sendable = items.filter((item) => !item.isDirectory && !item.isSequence);
  if (sendable.length && actions.externalApps?.length) {
    separator();
    actions.externalApps.forEach((app) => {
      add({ id: `send-to-${app.path}`, label: `Send to ${app.name}`, icon: Send, onSelect: () => actions.onSendTo(sendable, app) });
    });
  }

  // Images are converted to another format in the background; the dialog asks for the format and the folder
  const convertible = items.filter(isConvertibleItem);
  if (convertible.length && actions.onConvert) {
    separator();
    add({ id: 'convert', label: 'Convert…', icon: FileOutput, onSelect: () => actions.onConvert(convertible) });
  }

  separator();
  add({
    id: 'copy-path',
    label: items.length > 1 ? 'Copy paths' : 'Copy path',
    icon: Copy,
    onSelect: () => actions.onCopyPaths(items)
  });
  if (single) {
    add({ id: 'reveal', label: 'Reveal in Explorer', icon: FolderSearch, onSelect: () => actions.onReveal(single) });
    const favorite = actions.isFavorite(single);
    add({
      id: 'favorite',
      label: favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: favorite ? StarOff : Star,
      onSelect: () => actions.onToggleFavorite(single)
    });
  }
  add({ id: 'labels', label: 'Colour and tags…', icon: Tag, onSelect: () => actions.onEditLabels(items) });

  if (single?.isDirectory) {
    separator();
    add({ id: 'change-icon', label: 'Change icon…', icon: ImagePlus, onSelect: () => actions.onChangeIcon(single) });
    if (actions.hasIconChoice(single)) {
      add({ id: 'reset-icon', label: 'Use default icon', icon: RotateCcw, onSelect: () => actions.onResetIcon(single) });
    }
  }

  // Image sequences are one grouped entry; renaming or deleting one frame would split the sequence, so they stay off here
  if (!hasSequence) {
    separator();
    if (single) {
      add({
        id: 'rename',
        label: 'Rename…',
        icon: Pencil,
        disabled: isRootLocation(single.path),
        onSelect: () => actions.onRename(single)
      });
    }
    add({
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      danger: true,
      disabled: items.some((item) => isRootLocation(item.path)),
      onSelect: () => actions.onDelete(items)
    });
  }

  for (const provider of providers) {
    const extra = provider(items, actions) || [];
    if (extra.length) {
      separator();
      extra.forEach(add);
    }
  }

  while (entries.length && entries[entries.length - 1].separator) entries.pop();
  return entries;
}

// Entries for the right-click menu on the empty space of the folder view (not on a card or a row).
// `actions` holds onRefresh, the same in-place reload that F5 and Ctrl + R run.
export function buildFolderMenu(actions) {
  return [{ id: 'refresh', label: 'Refresh', icon: RefreshCw, onSelect: () => actions.onRefresh() }];
}

// Copies text to the clipboard; falls back to a hidden textarea when the async clipboard API is not available
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}
