import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import { getLibraryIcon } from '../utils/folderIconLibrary';
import { normalizeFolderKey, useFolderIcons, useSystemFolderIcon } from '../utils/folderIconStore';

// The icon of one folder: the user's pick, else the icon Windows shows for it (File Explorer customised
// folders), else the plain folder glyph. Image icons load lazily like any <img>.
export default function FolderIcon({ item, size = 15, strokeWidth = 1.5, color, className, style }) {
  const { assignments, customUrls } = useFolderIcons();
  const choice = assignments[normalizeFolderKey(item.path)];
  const system = useSystemFolderIcon(item.path, !choice && !!item.systemIcon);
  const [failedUrl, setFailedUrl] = useState(null);

  let imageUrl = null;
  if (choice && choice.startsWith('lib:')) {
    const entry = getLibraryIcon(choice.slice(4));
    if (entry) {
      const Icon = entry.Icon;
      return <Icon size={size} strokeWidth={strokeWidth} color={color} className={className} style={style} />;
    }
  } else if (choice && choice.startsWith('custom:')) {
    imageUrl = customUrls[choice.slice(7)] || null;
  } else if (system) {
    imageUrl = system;
  }

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className={`folder-icon-image ${className || ''}`}
        style={{ width: size, height: size, ...style }}
        onError={() => setFailedUrl(imageUrl)}
      />
    );
  }
  return <Folder size={size} strokeWidth={strokeWidth} color={color} className={className} style={style} />;
}
