import { lazy } from 'react';

// The heavy screens are loaded the first time they are opened instead of at startup, so the window comes up faster
// and uses less memory until a viewer is actually needed. Each one is its own file in the built app.
export const ImageViewer = lazy(() => import('./ImageViewer'));
export const TxTexViewer = lazy(() => import('./TxTexViewer'));
export const ImageSequencePlayer = lazy(() => import('./ImageSequencePlayer'));
export const VideoPlayer = lazy(() => import('./VideoPlayer'));
export const PdfViewer = lazy(() => import('./PdfViewer'));
export const MarkdownViewer = lazy(() => import('./MarkdownViewer'));
export const AudioPlayer = lazy(() => import('./AudioPlayer'));
export const Viewport3D = lazy(() => import('./Viewport3D'));
export const HdrExrInspector = lazy(() => import('./HdrExrInspector'));
export const CompareView = lazy(() => import('./CompareView'));
export const QuickLookWindow = lazy(() => import('./QuickLookWindow'));
export const InspectorDrawer = lazy(() => import('./InspectorDrawer'));
export const SettingsModal = lazy(() => import('./SettingsModal'));
export const BatchConvertModal = lazy(() => import('./BatchConvertModal'));
export const DuplicateFinderModal = lazy(() => import('./DuplicateFinderModal'));
export const TextureSetModal = lazy(() => import('./TextureSetModal'));
export const FolderIconPicker = lazy(() => import('./FolderIconPicker'));
export const PasteConflictModal = lazy(() => import('./PasteConflictModal'));
export const AchievementsScreen = lazy(() => import('./AchievementsScreen'));
