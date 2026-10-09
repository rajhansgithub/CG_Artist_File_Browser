import { Copy, Eye, ExternalLink, FolderOpen, FolderSearch, ImagePlus, Pencil, RotateCcw, Star, StarOff, Trash2 } from 'lucide-react';
import { isComparableItem } from './formatHelpers';

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
// `actions` holds the app's handlers and state: isFavorite, hasIconChoice, onOpen, onOpenExternal, onSetCompareA,
// onSetCompareB, onCopyPaths, onReveal, onToggleFavorite, onChangeIcon, onResetIcon, onRename, onDelete.
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
    if (isComparableItem(single)) {
      add({ id: 'compare-a', label: 'Set as compare slot A', onSelect: () => actions.onSetCompareA(single) });
      add({ id: 'compare-b', label: 'Set as compare slot B', onSelect: () => actions.onSetCompareB(single) });
    }
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
