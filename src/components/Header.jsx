import React from 'react';
import { LabelFilterMenu } from './LabelPanels';
import { Search, RefreshCw, X } from 'lucide-react';

export const UI_MODES = [
  { id: 'simple', label: 'Simple', title: 'Simple: a slim side rail with your drives, and the main filters' },
  { id: 'pro', label: 'Pro', title: 'Pro: the full sidebar, every filter with counts, sizes on every tile' }
];

// The floating toolbar: back, forward and up, the folder's name with its path and counts, the tools, search,
// and the Simple / Pro switch. The file-type filters live in the dock at the bottom (FilterDock).
export default function Header({
  searchTerm,
  setSearchTerm,
  labelFilter,
  setLabelFilter,
  labelTags,
  onRefreshFolder,
  isRefreshing,
  searchInputRef,
  uiMode,
  onChangeUiMode,
  navNode,
  toolsNode
}) {
  const pro = uiMode === 'pro';

  return (
    <div className="topbar-area">
      <header className="topbar" data-ui={uiMode}>
        <div className="tb-nav">{navNode}</div>

        <div className="tb-tools">
          {toolsNode}
          <LabelFilterMenu filter={labelFilter} setFilter={setLabelFilter} tags={labelTags} />
          {pro && (
            <button
              className="icon-btn"
              onClick={onRefreshFolder}
              style={isRefreshing ? { animation: 'spin 0.8s linear infinite' } : undefined}
              title="Refresh this folder (F5 or Ctrl+R)"
              aria-label="Refresh this folder"
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>

        <div className="tb-search">
          <Search size={14} className="tb-search-icon" />
          <input
            type="text"
            ref={searchInputRef}
            className="tb-search-input"
            placeholder="Search"
            title="Search this folder (Ctrl+F)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm ? (
            <button className="tb-search-clear" onClick={() => setSearchTerm('')} aria-label="Clear search">
              <X size={12} />
            </button>
          ) : (
            <kbd className="tb-search-key">Ctrl F</kbd>
          )}
        </div>

        <div className="mode-switch" role="group" aria-label="Interface mode">
          {UI_MODES.map((m) => (
            <button
              key={m.id}
              className={`mode-btn ${uiMode === m.id ? 'active' : ''}`}
              onClick={() => onChangeUiMode(m.id)}
              title={m.title}
              aria-pressed={uiMode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>
    </div>
  );
}
