import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { load3DModel, normalizeModel } from '../utils/assetLoader';
import {
  CAMERA_MODES,
  VIEW_DIRECTIONS,
  createCameraRig,
  resizeRig,
  setCameraMode,
  snapCameraView,
  frameModel,
  getViewState,
  applyViewState,
  cameraModeForFov,
  isOrtho
} from '../utils/viewportCamera';
import { MATCAP_OPTIONS, getMatcapMaterial, disposeMatcaps } from '../utils/matcaps';
import {
  canSmoothMesh,
  countGeometryTriangles,
  smoothLevelFor,
  buildSmoothGeometry,
  randomMeshColor
} from '../utils/smoothPreview';
import {
  buildPolygonWireIndices,
  buildAngleNormalGeometry,
  POLYGON_WIRE_MAX_TRIANGLES,
  ANGLE_NORMALS_MAX_TRIANGLES
} from '../utils/meshTopology';
import ModelOutliner from './ModelOutliner';
import UvView from './UvView';
import '../styles/viewport-panels.css';
import '../styles/viewer3d.css';
import {
  RotateCw,
  Sun,
  Grid,
  Camera,
  Play,
  Pause,
  Maximize2,
  Box,
  Check,
  ExternalLink,
  ListTree,
  Spline,
  Grid2x2,
  SlidersHorizontal,
  ChevronDown,
  FolderSearch,
  PanelRight,
  X
} from 'lucide-react';
import { formatBytes, formatDate } from '../utils/formatHelpers';
import { opened, openFailed } from '../achievements/observer.js';

// Every triangle edge, for very dense models and as the fallback.
// Pre-allocates a contiguous Uint32Array (no V8 array reallocations / 1.5GB heap spikes).
// Supports up to 2.5 million triangles at 1:1 fidelity (under 12ms build time).
function buildTriangleWireIndices(geom, totalTris) {
  const isIndexed = !!geom.index;
  const maxSafeTris = 2500000;
  const step = totalTris > maxSafeTris ? Math.ceil(totalTris / maxSafeTris) : 1;
  const sampledTris = Math.ceil(totalTris / step);

  const lineIndices = new Uint32Array(sampledTris * 6);
  let writeIdx = 0;
  const src = isIndexed ? geom.index.array : null;
  for (let i = 0; i < totalTris; i += step) {
    const a = src ? src[i * 3] : i * 3;
    const b = src ? src[i * 3 + 1] : i * 3 + 1;
    const c = src ? src[i * 3 + 2] : i * 3 + 2;
    lineIndices[writeIdx++] = a;
    lineIndices[writeIdx++] = b;
    lineIndices[writeIdx++] = b;
    lineIndices[writeIdx++] = c;
    lineIndices[writeIdx++] = c;
    lineIndices[writeIdx++] = a;
  }
  return lineIndices;
}

// Optimized wireframe LineSegments overlay generator
function getOrCreateWireframeHelper(mesh) {
  if (mesh.userData.wireframeHelper) {
    return mesh.userData.wireframeHelper;
  }

  // Always the file's own geometry, even while Smooth preview or softened normals show another copy.
  // So the wireframe is the original cage, like Maya's 3 key, and it stays valid when the display geometry changes.
  const geom = mesh.userData.origGeometry || mesh.geometry;
  if (!geom || !geom.attributes?.position) return null;

  const posAttr = geom.attributes.position;
  const totalVerts = posAttr.count;
  const isIndexed = !!geom.index;
  const totalTris = Math.floor(isIndexed ? geom.index.count / 3 : totalVerts / 3);

  if (totalTris <= 0) return null;

  // Polygon edges: quads and n-gons show their own edges, not the triangulation lines inside them.
  // Real triangle meshes (STL, or models without flat neighbouring triangles) keep every triangle edge.
  let lineIndices = null;
  if (totalTris <= POLYGON_WIRE_MAX_TRIANGLES) {
    try {
      const polygonal = buildPolygonWireIndices(geom, { keepTriangles: !!mesh.userData.keepTriangleEdges });
      if (polygonal) lineIndices = polygonal.indices;
    } catch (err) {
      console.error('Polygon wireframe failed, showing triangles:', err);
    }
  }
  if (!lineIndices) lineIndices = buildTriangleWireIndices(geom, totalTris);

  const wireGeom = new THREE.BufferGeometry();
  // Direct zero-copy reuse of the mesh's vertex buffer:
  wireGeom.setAttribute('position', posAttr);
  wireGeom.setIndex(new THREE.BufferAttribute(lineIndices, 1));

  // High performance opaque line material with early-Z depth testing (avoids massive alpha blending overdraw)
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: false,
    depthTest: true,
    depthWrite: false
  });

  const wireHelper = new THREE.LineSegments(wireGeom, lineMat);
  wireHelper.renderOrder = 10;
  // Mark strictly as helper so scene traversal never re-processes or duplicates it
  wireHelper.userData.isHelper = true;
  wireHelper.userData.isWireframeOverlay = true;

  mesh.add(wireHelper);
  mesh.userData.wireframeHelper = wireHelper;
  return wireHelper;
}

// Option styling shared by the HUD dropdowns
const OPTION_STYLE = { color: '#000000', backgroundColor: '#ffffff' };

// Model panel (Pro) open or closed, remembered between models and sessions
const PANEL_KEY = 'cg_artist_viewer3d_panel';
const readPanelOpen = () => {
  try {
    return localStorage.getItem(PANEL_KEY) !== '0';
  } catch {
    return true;
  }
};

// 20800 -> 20.8k, for the stat tiles
const compactNumber = (n) => {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return n.toLocaleString();
};

// A pick in the bottom dock: the current value on top, what it sets underneath
function DockPick({ caption, title, value, onChange, children, disabled }) {
  return (
    <label className={`v3d-pick ${disabled ? 'dim' : ''}`} title={title}>
      <span className="v3d-pick-value">
        <select value={value} onChange={onChange}>
          {children}
        </select>
        <ChevronDown size={12} className="v3d-pick-chevron" />
      </span>
      <span className="v3d-cap">{caption}</span>
    </label>
  );
}

// An on / off row in the Model panel
function PanelToggle({ label, on, onChange, title, dim }) {
  return (
    <button
      type="button"
      className={`v3d-toggle ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
      onClick={() => onChange(!on)}
      title={title}
      role="switch"
      aria-checked={on}
    >
      <span>{label}</span>
      <span className="v3d-switch" />
    </button>
  );
}
const MATCAP_PREFIX = 'matcap:';

// `onViewChange(viewState)` fires whenever the camera moves or its lens/projection
// changes. `viewApiRef.current` is filled with { getViewState, setViewState } so another
// component (for example synced compare) can read and drive this viewport's camera.
export default function Viewport3D({
  asset,
  onClose,
  onRevealInExplorer,
  onOpenExternal,
  onViewChange,
  viewApiRef
}) {
  const [panelOpen, setPanelOpenState] = useState(readPanelOpen);
  const setPanelOpen = (open) => {
    setPanelOpenState(open);
    try {
      localStorage.setItem(PANEL_KEY, open ? '1' : '0');
    } catch {
      // Not remembered; the panel still opens and closes
    }
  };
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading 3D asset...');
  const [loadError, setLoadError] = useState(null);

  // Viewport Settings State
  const [turntable, setTurntable] = useState(false);
  const [turntableSpeed, setTurntableSpeed] = useState(1.0);
  const [showGrid, setShowGrid] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [renderMode, setRenderMode] = useState('lit'); // 'lit', 'wire_overlay', 'wireframe', 'normals', 'clay'
  const [lightingPreset, setLightingPreset] = useState('studio'); // 'studio', 'sunset', 'neutral', 'cyber'
  const [lightAngle, setLightAngle] = useState(0); // degrees the light rig is turned around the model
  const [cameraMode, setCameraModeState] = useState('default'); // lens preset id or 'ortho'
  const [viewPreset, setViewPreset] = useState('free'); // 'free', 'front', 'back', 'left', 'right', 'top'
  const [stats, setStats] = useState(null);

  // Smooth preview (subdivided display copy of the meshes) and one flat colour per mesh. Both start off.
  const [smoothPreview, setSmoothPreview] = useState(false);
  const [smoothInfo, setSmoothInfo] = useState(null); // { level, triangles } while the preview is showing
  const [smoothNote, setSmoothNote] = useState('');
  const [randomColors, setRandomColors] = useState(false);
  const [geometryVersion, setGeometryVersion] = useState(0); // bumps when meshes get a different geometry

  // Normals: 'original' keeps the file's normals; 'angle' softens / hardens edges by angle like Maya (0 = all hard, 180 = all soft)
  const [normalMode, setNormalMode] = useState('original');
  const [softenAngle, setSoftenAngle] = useState(30);
  const [appliedAngle, setAppliedAngle] = useState(null); // softenAngle after a short pause while dragging, null = original
  const [normalsPanelOpen, setNormalsPanelOpen] = useState(false);
  const [uvOpen, setUvOpen] = useState(false);

  // Outliner: the loaded model root (set once it loads), the panel's open state and the object picked in it
  const [modelRoot, setModelRoot] = useState(null);
  const [outlinerOpen, setOutlinerOpen] = useState(false);
  const [selectedObject, setSelectedObject] = useState(null);

  // Animation State
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const [animations, setAnimations] = useState([]);
  const [currentAnimIndex, setCurrentAnimIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animTime, setAnimTime] = useState(0);
  const [animDuration, setAnimDuration] = useState(0);

  // Three.js internal references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null); // always the active camera (perspective or orthographic)
  const rigRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const selectionBoxRef = useRef(null); // outline around the object picked in the outliner
  const gridRef = useRef(null);
  const lightsGroupRef = useRef(null);
  const mixerRef = useRef(null);
  const actionRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const needsRenderRef = useRef(true);
  const smoothCacheRef = useRef(new Map()); // original geometry -> { [level]: smoothed geometry }
  const angleCacheRef = useRef(new Map()); // original geometry -> { angle, geometry } with softened normals
  const appliedAngleRef = useRef(null);
  const smoothNoteTimerRef = useRef(null);

  // Refs to avoid stale closures in render loop
  const turntableRef = useRef(false);
  const turntableSpeedRef = useRef(1.0);
  const isPlayingRef = useRef(true);
  const viewPresetRef = useRef('free');
  const onViewChangeRef = useRef(onViewChange);
  const applyingViewRef = useRef(false);
  const actionsRef = useRef({});
  onViewChangeRef.current = onViewChange;
  appliedAngleRef.current = appliedAngle;

  // Synchronize turntable and controls autoRotate
  useEffect(() => {
    turntableRef.current = turntable;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = turntable;
      controlsRef.current.autoRotateSpeed = 2.5 * turntableSpeed;
    }
  }, [turntable, turntableSpeed]);

  useEffect(() => {
    turntableSpeedRef.current = turntableSpeed;
  }, [turntableSpeed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Update lighting whenever preset changes
  const updateLighting = (preset, group) => {
    if (!group) return;
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    // Clean scene environment map for standard 3D studio light rigs
    if (sceneRef.current) {
      sceneRef.current.environment = null;
    }

    if (preset === 'studio') {
      const hemi = new THREE.HemisphereLight(0xffffff, 0x1c1c1c, 0.8);
      group.add(hemi);

      const key = new THREE.DirectionalLight(0xffffff, 2.0);
      key.position.set(5, 8, 5);
      key.castShadow = true;
      key.shadow.mapSize.width = 1024;
      key.shadow.mapSize.height = 1024;
      key.shadow.bias = -0.0002;
      group.add(key);

      const fill = new THREE.DirectionalLight(0xa0a0a0, 0.8);
      fill.position.set(-5, 4, -4);
      group.add(fill);

      const rim = new THREE.DirectionalLight(0xffffff, 1.2);
      rim.position.set(0, 5, -6);
      group.add(rim);
    } else if (preset === 'neutral') {
      const amb = new THREE.AmbientLight(0xffffff, 1.4);
      group.add(amb);

      const dir1 = new THREE.DirectionalLight(0xffffff, 1.2);
      dir1.position.set(4, 8, 4);
      dir1.castShadow = true;
      dir1.shadow.mapSize.width = 1024;
      dir1.shadow.mapSize.height = 1024;
      dir1.shadow.bias = -0.0002;
      group.add(dir1);

      const dir2 = new THREE.DirectionalLight(0xffffff, 0.8);
      dir2.position.set(-4, 5, -4);
      group.add(dir2);
    } else if (preset === 'high_contrast') {
      const hemi = new THREE.HemisphereLight(0xffffff, 0x050505, 0.4);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xffffff, 3.2);
      sun.position.set(8, 6, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 1024;
      sun.shadow.mapSize.height = 1024;
      sun.shadow.bias = -0.0002;
      group.add(sun);
    } else if (preset === 'rim_only') {
      const amb = new THREE.AmbientLight(0xffffff, 0.2);
      group.add(amb);

      const rim1 = new THREE.DirectionalLight(0xffffff, 2.5);
      rim1.position.set(5, 5, -5);
      group.add(rim1);

      const rim2 = new THREE.DirectionalLight(0xffffff, 2.5);
      rim2.position.set(-5, 5, -5);
      group.add(rim2);
    }
  };

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0c);
    sceneRef.current = scene;

    const rig = createCameraRig(width, height);
    rig.persp.position.set(3, 2.5, 4);
    rigRef.current = rig;
    cameraRef.current = rig.active;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(rig.active, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1; // allow slight under-view
    controls.target.set(0, 1.0, 0);
    controls.autoRotate = turntableRef.current;
    controls.autoRotateSpeed = 2.5 * turntableSpeedRef.current;
    controlsRef.current = controls;

    // Neutral monochrome ground grid
    const grid = new THREE.GridHelper(10, 20, 0x555555, 0x222222);
    grid.position.y = 0;
    scene.add(grid);
    gridRef.current = grid;

    // Lighting Setup
    const lightsGroup = new THREE.Group();
    scene.add(lightsGroup);
    lightsGroupRef.current = lightsGroup;
    updateLighting(lightingPreset, lightsGroup);

    // Responsive ResizeObserver for buttery-smooth window resizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0] || !rendererRef.current || !rigRef.current) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return;
      resizeRig(rigRef.current, w, h);
      rendererRef.current.setSize(w, h);
      rendererRef.current.shadowMap.needsUpdate = true;
      // setSize clears the canvas, so draw again (the viewer only draws when something changed)
      needsRenderRef.current = true;
    });

    resizeObserver.observe(containerRef.current);

    // Render loop with smart render-on-demand
    let animFrameId;
    const handleControlsChange = () => {
      needsRenderRef.current = true;

      // Dragging the view away from a Front/Top/... snap hands the dropdown back to "free"
      const preset = viewPresetRef.current;
      if (preset !== 'free' && !applyingViewRef.current) {
        const dir = VIEW_DIRECTIONS[preset];
        const current = rigRef.current.active.position.clone().sub(controls.target).normalize();
        if (dir && current.dot(dir) < 0.99995) {
          viewPresetRef.current = 'free';
          setViewPreset('free');
        }
      }

      if (onViewChangeRef.current && !applyingViewRef.current) {
        onViewChangeRef.current(getViewState(rigRef.current, controls));
      }
    };
    controls.addEventListener('change', handleControlsChange);

    const canvas = renderer.domElement;
    const handleContextLost = (e) => {
      e.preventDefault();
      console.warn('WebGL context lost! Waiting for restoration...');
      cancelAnimationFrame(animFrameId);
    };

    const handleContextRestored = () => {
      console.log('WebGL context restored! Re-rendering scene...');
      if (containerRef.current && rendererRef.current && rigRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        resizeRig(rigRef.current, w, h);
        rendererRef.current.setSize(w, h);
      }
      needsRenderRef.current = true;
      animate();
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();
      const isTurntableActive = turntableRef.current;
      const isAnimActive = !!(mixerRef.current && isPlayingRef.current);

      if (isAnimActive) {
        mixerRef.current.update(delta);
        if (actionRef.current) {
          setAnimTime(actionRef.current.time);
        }
      }

      // controls.update() returns true while damping or autoRotate is in motion
      const controlsMoving = controls.update();

      if (isTurntableActive || isAnimActive || controlsMoving || needsRenderRef.current) {
        renderer.render(scene, cameraRef.current);
        needsRenderRef.current = false;
      }
    };

    animate();

    return () => {
      controls.removeEventListener('change', handleControlsChange);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameId);
      disposeMatcaps();
      selectionBoxRef.current?.geometry?.dispose();
      selectionBoxRef.current?.material?.dispose();
      renderer.dispose();
    };
  }, []);

  // Camera helpers. They only touch refs and stable setters, so the keyboard handler
  // (registered once) can call the latest copy through actionsRef.
  // Run a camera change without the per-event notification; one update goes out afterwards
  const withoutViewEvents = (fn) => {
    applyingViewRef.current = true;
    try {
      fn();
    } finally {
      applyingViewRef.current = false;
    }
  };

  const afterCameraChange = () => {
    cameraRef.current = rigRef.current.active;
    needsRenderRef.current = true;
    if (onViewChangeRef.current && controlsRef.current) {
      onViewChangeRef.current(getViewState(rigRef.current, controlsRef.current));
    }
  };

  const changeCameraMode = (modeId) => {
    if (!rigRef.current || !controlsRef.current) return;
    withoutViewEvents(() => setCameraMode(rigRef.current, controlsRef.current, modeId));
    setCameraModeState(modeId);
    afterCameraChange();
  };

  const snapView = (name) => {
    if (!rigRef.current || !controlsRef.current) return;
    if (name === 'free') {
      viewPresetRef.current = 'free';
      setViewPreset('free');
      return;
    }
    viewPresetRef.current = name;
    setViewPreset(name);
    withoutViewEvents(() => snapCameraView(rigRef.current, controlsRef.current, name));
    afterCameraChange();
  };

  const frameObject = (object3D) => {
    if (!rigRef.current || !controlsRef.current || !object3D) return;
    viewPresetRef.current = 'free';
    setViewPreset('free');
    withoutViewEvents(() => frameModel(rigRef.current, controlsRef.current, object3D));
    afterCameraChange();
  };

  const frameCurrentModel = () => frameObject(modelRef.current);

  // Outliner click: outline the object and frame the camera on it. An object with no geometry under it
  // (an empty or a bare group) has nothing to frame, so it is only selected.
  const selectObject = (obj) => {
    clearSelectionBox();
    setSelectedObject(obj);
    if (obj && !new THREE.Box3().setFromObject(obj).isEmpty()) {
      const outline = new THREE.BoxHelper(obj, 0x3b9eff);
      outline.userData.isHelper = true;
      sceneRef.current?.add(outline);
      selectionBoxRef.current = outline;
      frameObject(obj);
    }
    needsRenderRef.current = true;
  };

  actionsRef.current = {
    snapView,
    frameCurrentModel,
    toggleOrtho: () => changeCameraMode(isOrtho(rigRef.current) ? 'default' : 'ortho')
  };

  // Programmatic access to the camera for other components (synced compare)
  useEffect(() => {
    if (!viewApiRef) return undefined;
    viewApiRef.current = {
      getViewState: () => getViewState(rigRef.current, controlsRef.current),
      setViewState: (state) => {
        if (!rigRef.current || !controlsRef.current) return;
        // Silent: applying a state must not echo back through onViewChange
        withoutViewEvents(() => applyViewState(rigRef.current, controlsRef.current, state));
        cameraRef.current = rigRef.current.active;
        viewPresetRef.current = 'free';
        setViewPreset('free');
        setCameraModeState(
          isOrtho(rigRef.current) ? 'ortho' : cameraModeForFov(rigRef.current.persp.fov)
        );
        needsRenderRef.current = true;
      }
    };
    return () => {
      viewApiRef.current = null;
    };
  }, [viewApiRef]);

  // Rotate the light rig around the model without touching the camera
  useEffect(() => {
    if (lightsGroupRef.current) {
      lightsGroupRef.current.rotation.y = (lightAngle * Math.PI) / 180;
    }
    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
    needsRenderRef.current = true;
  }, [lightAngle]);

  useEffect(() => {
    updateLighting(lightingPreset, lightsGroupRef.current);
    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
    needsRenderRef.current = true;
  }, [lightingPreset]);

  // Remove the outliner's selection outline from the scene and free its GPU buffers
  const clearSelectionBox = () => {
    const box = selectionBoxRef.current;
    if (!box) return;
    sceneRef.current?.remove(box);
    box.geometry?.dispose();
    box.material?.dispose();
    selectionBoxRef.current = null;
  };

  // Load Model Asset
  useEffect(() => {
    if (!asset || !sceneRef.current) return;

    let isMounted = true;
    setLoading(true);
    setLoadError(null);
    setLoadingMsg(`Loading ${asset.name}...`);
    setModelRoot(null);
    setSelectedObject(null);
    clearSelectionBox();

    // Clean previous model
    if (modelRef.current) {
      modelRef.current.traverse((child) => {
        if (child.userData.wireframeHelper) {
          child.userData.wireframeHelper.geometry?.dispose();
          child.userData.wireframeHelper.material?.dispose();
          child.remove(child.userData.wireframeHelper);
          child.userData.wireframeHelper = null;
        }
        if (child.userData.wireframeOccluderMat) child.userData.wireframeOccluderMat.dispose();
        if (child.userData.normalsMat) child.userData.normalsMat.dispose();
        if (child.userData.clayMat) child.userData.clayMat.dispose();
        if (child.userData.randomMat) child.userData.randomMat.dispose();
      });
      smoothCacheRef.current.forEach((levels) => {
        Object.values(levels).forEach((geometry) => geometry.dispose());
      });
      smoothCacheRef.current.clear();
      angleCacheRef.current.forEach((entry) => entry.geometry.dispose());
      angleCacheRef.current.clear();
      setSmoothInfo(null);
      sceneRef.current.remove(modelRef.current);
      modelRef.current = null;
    }
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    load3DModel(asset, (prog, msg) => {
      if (isMounted) setLoadingMsg(msg || `Loading... ${Math.round(prog * 100)}%`);
    })
      .then(({ root, animations: loadedAnims, stats: modelStats }) => {
        if (!isMounted) return;

        // Normalize scale and ground
        normalizeModel(root, 3.0);

        sceneRef.current.add(root);
        modelRef.current = root;
        setModelRoot(root);
        setStats(modelStats);

        // Perfectly focus and frame model
        if (controlsRef.current && rigRef.current) {
          viewPresetRef.current = 'free';
          setViewPreset('free');
          frameModel(rigRef.current, controlsRef.current, root);
          cameraRef.current = rigRef.current.active;
        }

        // Setup Animations
        if (loadedAnims && loadedAnims.length > 0) {
          const mixer = new THREE.AnimationMixer(root);
          mixerRef.current = mixer;
          setAnimations(loadedAnims);
          setCurrentAnimIndex(0);

          const action = mixer.clipAction(loadedAnims[0]);
          action.play();
          actionRef.current = action;
          setAnimDuration(loadedAnims[0].duration);
        } else {
          setAnimations([]);
        }

        setLoading(false);
        opened('3d', asset.path);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error loading 3D asset:', err);
        setLoadError(err.message || 'Failed to load 3D file.');
        setLoading(false);
        openFailed('3d', err.message);
      });

    return () => {
      isMounted = false;
    };
  }, [asset]);

  // Keyboard shortcuts: F to focus/frame model, Esc to close, O to show/hide the outliner (not in Quick Look),
  // 3 for smooth preview (like Maya), C for a random colour per mesh, U for the UV view,
  // numpad 1/3/7 for Front/Right/Top (Ctrl for Back/Left), numpad 5 to toggle orthographic
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'f' || e.key === 'F') {
        actionsRef.current.frameCurrentModel();
      } else if (e.key === 'Escape' && onClose) {
        onClose();
      } else if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !containerRef.current?.closest('.quick-look-body')) {
        setOutlinerOpen((open) => !open);
      } else if ((e.key === 'u' || e.key === 'U') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        setUvOpen((open) => !open);
      } else if (e.code === 'Digit3' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat) {
        setSmoothPreview((on) => !on);
      } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        setRandomColors((on) => !on);
      } else if (e.code === 'Numpad1') {
        e.preventDefault();
        actionsRef.current.snapView(e.ctrlKey ? 'back' : 'front');
      } else if (e.code === 'Numpad3') {
        e.preventDefault();
        actionsRef.current.snapView(e.ctrlKey ? 'left' : 'right');
      } else if (e.code === 'Numpad7' && !e.ctrlKey) {
        e.preventDefault();
        actionsRef.current.snapView('top');
      } else if (e.code === 'Numpad5') {
        e.preventDefault();
        actionsRef.current.toggleOrtho();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Show a note for a few seconds, for example when a model is too dense to smooth
  const flashSmoothNote = (text) => {
    clearTimeout(smoothNoteTimerRef.current);
    setSmoothNote(text);
    smoothNoteTimerRef.current = setTimeout(() => setSmoothNote(''), 4000);
  };

  // The geometry a mesh shows when Smooth preview is off: the file's own, or a copy with softened normals
  const getBaseGeometry = (mesh) => {
    const orig = mesh.userData.origGeometry || mesh.geometry;
    const angle = appliedAngleRef.current;
    if (angle === null || !mesh.isMesh || !orig.attributes?.position) return orig;
    let entry = angleCacheRef.current.get(orig);
    if (!entry || entry.angle !== angle) {
      entry?.geometry.dispose();
      angleCacheRef.current.delete(orig);
      const geometry = buildAngleNormalGeometry(orig, angle);
      if (!geometry) return orig;
      entry = { angle, geometry };
      angleCacheRef.current.set(orig, entry);
    }
    return entry.geometry;
  };

  // Soften / harden normals by angle: apply the slider value a moment after it stops moving
  const effectiveAngle = normalMode === 'angle' ? softenAngle : null;
  useEffect(() => {
    const id = setTimeout(() => setAppliedAngle(effectiveAngle), effectiveAngle === null ? 0 : 120);
    return () => clearTimeout(id);
  }, [effectiveAngle]);

  useEffect(() => {
    const root = modelRef.current;
    if (!root || smoothPreview) return; // Smooth preview has its own smooth normals

    const meshes = [];
    root.traverse((child) => {
      if (child.userData.isHelper || child.userData.isWireframeOverlay) return;
      if (child.isMesh && child.geometry?.attributes?.position) meshes.push(child);
    });

    if (appliedAngle !== null) {
      const totalTris = meshes.reduce(
        (sum, mesh) => sum + countGeometryTriangles(mesh.userData.origGeometry || mesh.geometry),
        0
      );
      if (totalTris > ANGLE_NORMALS_MAX_TRIANGLES) {
        setNormalMode('original');
        flashSmoothNote('Normals: model is too dense to change');
        return;
      }
    }

    try {
      let changed = false;
      meshes.forEach((mesh) => {
        if (appliedAngle === null && !mesh.userData.origGeometry) return;
        mesh.userData.origGeometry = mesh.userData.origGeometry || mesh.geometry;
        const base = getBaseGeometry(mesh);
        if (mesh.geometry !== base) {
          mesh.geometry = base;
          changed = true;
        }
      });
      if (changed) {
        setGeometryVersion((v) => v + 1);
        needsRenderRef.current = true;
        if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true;
      }
    } catch (err) {
      console.error('Soften normals failed:', err);
      setNormalMode('original');
      flashSmoothNote('Normals: could not change this model');
    }
  }, [appliedAngle, modelRoot]);

  // Smooth preview: swap each mesh's geometry for a subdivided copy, or back to the original.
  // The original geometry is kept on the mesh, so turning the preview off is instant.
  useEffect(() => {
    const root = modelRef.current;
    if (!root) return;

    const meshes = [];
    root.traverse((child) => {
      if (child.userData.isHelper || child.userData.isWireframeOverlay) return;
      if (child.isMesh && child.geometry) meshes.push(child);
    });

    const restore = () => {
      let changed = false;
      meshes.forEach((mesh) => {
        if (!mesh.userData.origGeometry) {
          if (appliedAngleRef.current === null) return;
          mesh.userData.origGeometry = mesh.geometry;
        }
        const base = getBaseGeometry(mesh);
        if (mesh.geometry !== base) {
          mesh.geometry = base;
          changed = true;
        }
      });
      setSmoothInfo(null);
      if (!changed) return;
      setGeometryVersion((v) => v + 1);
      needsRenderRef.current = true;
      if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true;
    };

    if (!smoothPreview) {
      restore();
      return;
    }

    const targets = meshes.filter(canSmoothMesh);
    const totalTris = targets.reduce(
      (sum, mesh) => sum + countGeometryTriangles(mesh.userData.origGeometry || mesh.geometry),
      0
    );
    if (targets.length === 0) {
      setSmoothPreview(false);
      flashSmoothNote('Smooth preview: nothing to smooth in this model');
      return;
    }
    const level = smoothLevelFor(totalTris);
    if (level === 0) {
      setSmoothPreview(false);
      flashSmoothNote('Smooth preview: model is too dense');
      return;
    }

    try {
      let outTris = 0;
      targets.forEach((mesh) => {
        const orig = mesh.userData.origGeometry || mesh.geometry;
        mesh.userData.origGeometry = orig;
        let levels = smoothCacheRef.current.get(orig);
        if (!levels) {
          levels = {};
          smoothCacheRef.current.set(orig, levels);
        }
        if (!levels[level]) levels[level] = buildSmoothGeometry(orig, level);
        if (mesh.geometry !== levels[level]) {
          mesh.geometry = levels[level];
        }
        outTris += countGeometryTriangles(levels[level]);
      });
      setSmoothInfo({ level, triangles: outTris });
      setGeometryVersion((v) => v + 1);
      needsRenderRef.current = true;
      if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true;
    } catch (err) {
      console.error('Smooth preview failed:', err);
      restore();
      setSmoothPreview(false);
      flashSmoothNote('Smooth preview failed');
    }
  }, [smoothPreview, modelRoot]);

  // Handle Render Style changes (Lit, Wireframe, Normals, Clay) & Wireframe Overlay
  useEffect(() => {
    if (!modelRef.current) return;

    const isWireframeActive = showWireframe || renderMode === 'wire_overlay' || renderMode === 'wireframe';

    const setMatPolygonOffset = (mat, enable) => {
      if (!mat) return;
      if (Array.isArray(mat)) {
        mat.forEach((m) => setMatPolygonOffset(m, enable));
        return;
      }
      mat.polygonOffset = enable;
      mat.polygonOffsetFactor = enable ? 1 : 0;
      mat.polygonOffsetUnits = enable ? 1 : 0;
      mat.needsUpdate = true;
    };

    // One steady colour per mesh, numbered in scene order so the colours do not change between toggles
    let meshNumber = 0;
    const getRandomColorMaterial = (mesh) => {
      if (!mesh.userData.randomMat) {
        const original = Array.isArray(mesh.userData.origMaterial)
          ? mesh.userData.origMaterial[0]
          : mesh.userData.origMaterial;
        mesh.userData.randomMat = new THREE.MeshStandardMaterial({
          color: randomMeshColor(mesh.userData.meshNumber),
          roughness: 0.6,
          metalness: 0.05,
          side: original?.side ?? THREE.FrontSide
        });
      }
      return mesh.userData.randomMat;
    };

    modelRef.current.traverse((child) => {
      // Strictly ignore any wireframe or helper overlays to prevent recursion
      if (child.userData.isHelper || child.userData.isWireframeOverlay) {
        return;
      }

      if (child.isMesh && child.geometry) {
        if (!child.userData.origMaterial) {
          child.userData.origMaterial = child.material;
        }
        if (child.userData.meshNumber === undefined) child.userData.meshNumber = meshNumber;
        meshNumber++;

        // 1. Base surface shading according to renderMode
        if (renderMode === 'wireframe') {
          // Dark silhouette occluder for pure wireframe mode
          if (!child.userData.wireframeOccluderMat) {
            child.userData.wireframeOccluderMat = new THREE.MeshBasicMaterial({
              color: 0x0c0c0c,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1
            });
          }
          child.material = child.userData.wireframeOccluderMat;
          setMatPolygonOffset(child.material, true);
        } else if (renderMode === 'normals') {
          if (!child.userData.normalsMat) {
            child.userData.normalsMat = new THREE.MeshNormalMaterial();
          }
          child.material = child.userData.normalsMat;
          setMatPolygonOffset(child.material, isWireframeActive);
        } else if (renderMode.startsWith(MATCAP_PREFIX)) {
          const matcapMat = getMatcapMaterial(renderMode.slice(MATCAP_PREFIX.length));
          child.material = matcapMat || child.userData.origMaterial;
          setMatPolygonOffset(child.material, isWireframeActive);
        } else if (randomColors && renderMode === 'clay') {
          child.material = getRandomColorMaterial(child);
          setMatPolygonOffset(child.material, isWireframeActive);
        } else if (renderMode === 'clay') {
          if (!child.userData.clayMat) {
            child.userData.clayMat = new THREE.MeshStandardMaterial({
              color: 0xd4d4d8,
              roughness: 0.65,
              metalness: 0.05
            });
          }
          child.material = child.userData.clayMat;
          setMatPolygonOffset(child.material, isWireframeActive);
        } else if (randomColors) {
          // Lit / Wireframe Overlay with one flat colour per mesh
          child.material = getRandomColorMaterial(child);
          setMatPolygonOffset(child.material, isWireframeActive);
        } else {
          // Lit / Standard or Wireframe Overlay
          child.material = child.userData.origMaterial;
          setMatPolygonOffset(child.material, isWireframeActive);
        }

        // 2. High performance wireframe overlay
        if (isWireframeActive) {
          const wireHelper = getOrCreateWireframeHelper(child);
          if (wireHelper) {
            wireHelper.visible = true;
            wireHelper.material.color.setHex(0x38bdf8);
          }
        } else {
          if (child.userData.wireframeHelper) {
            child.userData.wireframeHelper.visible = false;
          }
        }
      }
    });

    needsRenderRef.current = true;
  }, [renderMode, showWireframe, stats, randomColors, geometryVersion]);

  // Grid visibility
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
      needsRenderRef.current = true;
    }
  }, [showGrid]);

  // Animation Clip Switch
  const switchAnimation = (index) => {
    if (!mixerRef.current || !animations[index]) return;
    mixerRef.current.stopAllAction();
    const action = mixerRef.current.clipAction(animations[index]);
    action.play();
    actionRef.current = action;
    setCurrentAnimIndex(index);
    setAnimDuration(animations[index].duration);
    setIsPlaying(true);
  };

  // Lights only shape the result in the lit-style modes
  const lightsAffectShading =
    renderMode === 'lit' || renderMode === 'clay' || renderMode === 'wire_overlay';

  // Random colours replace the surface look in these modes only
  const colorsAffectShading =
    renderMode === 'lit' || renderMode === 'clay' || renderMode === 'wire_overlay';

  // Take Snapshot
  const captureSnapshot = async () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    try {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
      const baseName = asset?.name ? asset.name.replace(/\.[^/.]+$/, '') : 'model';
      const defaultFilename = `${baseName}_snapshot.png`;

      let saved = false;
      if (window.electronAPI?.saveImageFileDialog) {
        try {
          const res = await window.electronAPI.saveImageFileDialog(defaultFilename, dataUrl);
          if (res && res.success) {
            saved = true;
          } else if (res && res.cancelled) {
            return;
          }
        } catch (dialogErr) {
          console.warn('Native save dialog failed, using fallback:', dialogErr);
        }
      }

      if (!saved) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      setSnapshotFeedback(true);
      setTimeout(() => setSnapshotFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to capture 3D snapshot:', err);
    }
  };

  return (
    <div
      className={`viewport-wrapper v3d ${panelOpen && stats ? 'panel-open' : ''} ${outlinerOpen && modelRoot ? 'outliner-open' : ''}`}
    >
      <div ref={containerRef} className="canvas-container" />

      {/* Bottom dock: view toggles, look and light, camera, then actions. Pro adds Normals, UV, light angle and camera. */}
      <div className={`viewport-hud v3d-dock ${panelOpen ? 'with-panel' : ''}`}>
        <button
          className={`hud-btn ${turntable ? 'active' : ''}`}
          onClick={() => setTurntable(!turntable)}
          title="Auto Turntable Spin"
        >
          <RotateCw size={16} className={turntable ? 'spin-icon' : ''} />
          <span className="hud-label">Turntable</span>
        </button>

        <button
          className={`hud-btn ${showGrid ? 'active' : ''}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle Ground Grid"
        >
          <Grid size={16} />
          <span className="hud-label">Grid</span>
        </button>

        <button
          className={`hud-btn ${showWireframe || renderMode === 'wire_overlay' || renderMode === 'wireframe' ? 'active' : ''}`}
          onClick={() => {
            if (renderMode === 'wireframe' || renderMode === 'wire_overlay') {
              setRenderMode('lit');
              setShowWireframe(false);
            } else {
              setShowWireframe(!showWireframe);
            }
          }}
          title="Toggle Wireframe Overlay"
        >
          <Box size={16} />
          <span className="hud-label">Wireframe</span>
        </button>

        {/* Normals: soften / harden edges by angle, like Maya */}
        <button
          className={`hud-btn v3d-pro ${normalMode === 'angle' || normalsPanelOpen ? 'active' : ''}`}
          onClick={() => setNormalsPanelOpen(!normalsPanelOpen)}
          title="Normals: soften or harden edges by angle, like Maya. The file is not changed."
        >
          <SlidersHorizontal size={16} />
          <span className="hud-label">Normals</span>
        </button>

        {/* UV layout of the model or the object picked in the outliner (U key) */}
        <button
          className={`hud-btn v3d-pro ${uvOpen ? 'active' : ''}`}
          onClick={() => setUvOpen(!uvOpen)}
          title="UV view: show the UV layout (U key)"
        >
          <Grid2x2 size={16} />
          <span className="hud-label">UV</span>
        </button>

        {/* Smooth preview: subdivided display copy of the meshes (3 key, like Maya) */}
        <button
          className={`hud-btn ${smoothPreview ? 'active' : ''}`}
          onClick={() => setSmoothPreview(!smoothPreview)}
          title="Smooth preview: show the meshes smoothed, wireframe stays on the original cage (3 key, like Maya). The file is not changed."
        >
          <Spline size={16} />
          <span className="hud-label">Smooth</span>
        </button>

        <div className="hud-divider" />

        <DockPick
          caption="Look"
          title="Shading mode"
          value={renderMode}
          onChange={(e) => {
            const mode = e.target.value;
            setRenderMode(mode);
            if (mode === 'wire_overlay' || mode === 'wireframe') {
              setShowWireframe(true);
            }
          }}
        >
          <option value="lit" style={OPTION_STYLE}>Shaded</option>
          <option value="clay" style={OPTION_STYLE}>Clay</option>
          <option value="normals" style={OPTION_STYLE}>Normals</option>
          <option value="wire_overlay" style={OPTION_STYLE}>Wire overlay</option>
          <option value="wireframe" style={OPTION_STYLE}>Wireframe</option>
          <optgroup label="MatCap" style={OPTION_STYLE}>
            {MATCAP_OPTIONS.map((m) => (
              <option key={m.id} value={`${MATCAP_PREFIX}${m.id}`} style={OPTION_STYLE}>
                MatCap {m.label}
              </option>
            ))}
          </optgroup>
        </DockPick>

        <DockPick
          caption="Light"
          title="Lighting and environment rig"
          value={lightingPreset}
          onChange={(e) => setLightingPreset(e.target.value)}
          disabled={!lightsAffectShading}
        >
          <option value="studio" style={OPTION_STYLE}>Studio</option>
          <option value="neutral" style={OPTION_STYLE}>Neutral</option>
          <option value="high_contrast" style={OPTION_STYLE}>Sun</option>
          <option value="rim_only" style={OPTION_STYLE}>Rim</option>
        </DockPick>

        <span className="v3d-pro v3d-group">
          <DockPick
            caption="Camera"
            title="Camera lens: perspective focal lengths or orthographic (numpad 5 toggles)"
            value={cameraMode}
            onChange={(e) => changeCameraMode(e.target.value)}
          >
            {cameraMode === 'custom' && (
              <option value="custom" disabled style={OPTION_STYLE}>Custom lens</option>
            )}
            {CAMERA_MODES.map((m) => (
              <option key={m.id} value={m.id} style={OPTION_STYLE}>{m.label}</option>
            ))}
          </DockPick>

        </span>

        <div className="hud-divider" />

        <button className="hud-btn" onClick={frameCurrentModel} title="Focus / Frame Model (F key)">
          <Maximize2 size={16} />
          <span className="hud-label">Focus</span>
        </button>

        <button
          className={`hud-btn ${snapshotFeedback ? 'active' : ''}`}
          onClick={captureSnapshot}
          title="Capture Snapshot PNG"
        >
          {snapshotFeedback ? <Check size={16} color="#22c55e" /> : <Camera size={16} />}
          <span className="hud-label">{snapshotFeedback ? 'Saved' : 'Snapshot'}</span>
        </button>

        {onRevealInExplorer && (
          <button className="hud-btn" onClick={() => onRevealInExplorer(asset.path)} title="Reveal in Windows Explorer">
            <FolderSearch size={16} />
            <span className="hud-label">Reveal</span>
          </button>
        )}

        {onOpenExternal && (
          <button className="hud-btn accent" onClick={() => onOpenExternal(asset)} title="Open in its default app">
            <ExternalLink size={16} />
            <span className="hud-label">Open in app</span>
          </button>
        )}
      </div>

      {/* Top right: Model panel (Pro) and close */}
      <div className="v3d-corner">
        <button
          className={`v3d-corner-btn v3d-pro ${outlinerOpen ? 'active' : ''}`}
          onClick={() => setOutlinerOpen(!outlinerOpen)}
          title="Model outliner: prim tree with visibility toggles (O key)"
          aria-label="Outliner"
          aria-pressed={outlinerOpen}
        >
          <ListTree size={15} />
        </button>
        <button
          className={`v3d-corner-btn v3d-pro ${panelOpen ? 'active' : ''}`}
          onClick={() => setPanelOpen(!panelOpen)}
          title={panelOpen ? 'Hide the Model panel' : 'Show the Model panel'}
          aria-label="Model panel"
          aria-pressed={panelOpen}
        >
          <PanelRight size={15} />
        </button>
        {onClose && (
          <button className="v3d-corner-btn" onClick={onClose} title="Close View (Esc)" aria-label="Close view">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Normals panel: soften / harden by angle */}
      {normalsPanelOpen && (
        <div className="normals-panel">
          <div className="normals-panel-title">
            <span>Normals</span>
            <button className="uv-view-close" onClick={() => setNormalsPanelOpen(false)} title="Close">
              ✕
            </button>
          </div>
          <div className="normals-panel-presets">
            <button
              className={`hud-btn ${normalMode === 'original' ? 'active' : ''}`}
              onClick={() => setNormalMode('original')}
              title="Use the normals from the file"
            >
              Original
            </button>
            <button
              className={`hud-btn ${normalMode === 'angle' && softenAngle === 0 ? 'active' : ''}`}
              onClick={() => {
                setSoftenAngle(0);
                setNormalMode('angle');
              }}
              title="Harden all edges (faceted look)"
            >
              Hard
            </button>
            <button
              className={`hud-btn ${normalMode === 'angle' && softenAngle === 180 ? 'active' : ''}`}
              onClick={() => {
                setSoftenAngle(180);
                setNormalMode('angle');
              }}
              title="Soften all edges (smooth look)"
            >
              Soft
            </button>
          </div>
          <label className="normals-panel-angle" style={{ opacity: normalMode === 'angle' ? 1 : 0.6 }}>
            <span>Angle</span>
            <input
              type="range"
              className="scrubber-slider"
              min="0"
              max="180"
              step="1"
              value={softenAngle}
              onChange={(e) => {
                setSoftenAngle(Number(e.target.value));
                setNormalMode('angle');
              }}
              onDoubleClick={() => setSoftenAngle(30)}
            />
            <input
              type="number"
              min="0"
              max="180"
              step="1"
              value={softenAngle}
              onChange={(e) => {
                const v = Math.min(180, Math.max(0, Math.round(Number(e.target.value) || 0)));
                setSoftenAngle(v);
                setNormalMode('angle');
              }}
            />
            <span>°</span>
          </label>
          <div className="normals-panel-hint">
            Edges between faces that meet at less than this angle are soft. Others stay hard. Try the Normal Vectors shading mode to see the result.
          </div>
        </div>
      )}

      {/* UV view (U key) */}
      {uvOpen && modelRoot && (
        <UvView root={modelRoot} selected={selectedObject} onClose={() => setUvOpen(false)} />
      )}

      {/* Model panel (Pro): counts, size, materials and display switches */}
      {stats && panelOpen && (
        <aside className="v3d-panel v3d-pro" aria-label="Model">
          <div className="v3d-panel-head">
            <span className="v3d-panel-title">Model</span>
            {asset.extension && <span className="v3d-ext">{asset.extension.replace(/^\./, '').toUpperCase()}</span>}
          </div>
          <div className="v3d-panel-sub">
            {[asset.size ? formatBytes(asset.size) : null, asset.modified ? `Modified ${formatDate(asset.modified)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>

          <div className="v3d-tiles">
            <div className="v3d-tile" title={stats.triangles.toLocaleString()}>
              <b>{compactNumber(stats.triangles)}</b>
              <span>Triangles</span>
            </div>
            <div className="v3d-tile" title={stats.vertices.toLocaleString()}>
              <b>{compactNumber(stats.vertices)}</b>
              <span>Vertices</span>
            </div>
            <div className="v3d-tile">
              <b>{compactNumber(stats.meshes)}</b>
              <span>Meshes</span>
            </div>
            <div className="v3d-tile">
              <b>{compactNumber(stats.materials.length)}</b>
              <span>Materials</span>
            </div>
          </div>

          <div className="v3d-section">Size</div>
          <div className="v3d-row">
            <span>Bounds</span>
            <b>
              {stats.dimensions.x} × {stats.dimensions.y} × {stats.dimensions.z}
            </b>
          </div>
          {smoothInfo && (
            <div className="v3d-row">
              <span>Smooth preview</span>
              <b>
                Lv {smoothInfo.level} · {compactNumber(smoothInfo.triangles)} tris
              </b>
            </div>
          )}
          {smoothNote && <div className="v3d-note">{smoothNote}</div>}

          {stats.materials.length > 0 && (
            <>
              <div className="v3d-section">Materials</div>
              <div className="v3d-materials">
                {stats.materials.map((name, i) => (
                  <div key={`${name}-${i}`} className="v3d-row" title={name}>
                    <span className="v3d-material">{name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="v3d-section">View</div>
          <div className="v3d-views" role="group" aria-label="Snap the camera to a side">
            {[
              ['free', 'Free'],
              ['front', 'Front'],
              ['back', 'Back'],
              ['left', 'Left'],
              ['right', 'Right'],
              ['top', 'Top']
            ].map(([id, label]) => (
              <button
                key={id}
                className={viewPreset === id ? 'active' : ''}
                onClick={() => snapView(id)}
                title={id === 'free' ? 'Free view' : `${label} view (numpad 1 Front, 3 Right, 7 Top; Ctrl for Back / Left)`}
              >
                {label}
              </button>
            ))}
          </div>
          <label
            className={`v3d-row v3d-range ${lightsAffectShading ? '' : 'dim'}`}
            title={
              lightsAffectShading
                ? 'Rotate lights around the model (double-click to reset)'
                : 'Light rotation has no effect in this shading mode'
            }
          >
            <span>Light angle</span>
            <input
              type="range"
              min="0"
              max="360"
              step="1"
              value={lightAngle}
              onChange={(e) => setLightAngle(Number(e.target.value))}
              onDoubleClick={() => setLightAngle(0)}
            />
            <b>{lightAngle}°</b>
          </label>

          <div className="v3d-section">Display</div>
          <PanelToggle label="Smooth preview" on={smoothPreview} onChange={setSmoothPreview} title="Smooth preview (3 key)" />
          <PanelToggle
            label="Random mesh colors"
            on={randomColors}
            onChange={setRandomColors}
            dim={!colorsAffectShading}
            title={
              colorsAffectShading
                ? 'Random colour per mesh (C key)'
                : 'Random colours show in Shaded, Clay and Wireframe Overlay modes'
            }
          />
          <PanelToggle label="Ground grid" on={showGrid} onChange={setShowGrid} />

          <div className="v3d-panel-foot" title={asset.path}>
            <FolderSearch size={13} />
            <span>{asset.path}</span>
          </div>
        </aside>
      )}

      {/* Model outliner (O key); never opened in Quick Look, where the key and button are off */}
      {outlinerOpen && modelRoot && (
        <ModelOutliner
          root={modelRoot}
          selectedId={selectedObject?.uuid ?? null}
          onSelect={selectObject}
          onVisibilityChange={() => {
            needsRenderRef.current = true;
          }}
          onClose={() => setOutlinerOpen(false)}
        />
      )}

      {/* Animation Player Bar if model contains animations */}
      {animations.length > 0 && (
        <div className="anim-bar">
          <button
            className="icon-btn"
            style={{ width: 32, height: 32 }}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <select
            className="filter-btn"
            value={currentAnimIndex}
            onChange={(e) => switchAnimation(Number(e.target.value))}
            style={{ height: 32 }}
          >
            {animations.map((clip, i) => (
              <option key={clip.name || i} value={i}>
                {clip.name || `Clip ${i + 1}`} ({clip.duration.toFixed(1)}s)
              </option>
            ))}
          </select>

          <input
            type="range"
            className="scrubber-slider"
            min="0"
            max={animDuration || 1}
            step="0.01"
            value={animTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setAnimTime(val);
              if (actionRef.current) {
                actionRef.current.time = val;
              }
            }}
          />

          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: 40 }}>
            {animTime.toFixed(1)}s
          </span>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div style={{ fontSize: 14, fontWeight: 500 }}>{loadingMsg}</div>
        </div>
      )}

      {/* Error Overlay */}
      {loadError && (
        <div className="loading-overlay" style={{ background: 'rgba(15, 23, 42, 0.95)' }}>
          <div style={{ color: '#ef4444', fontSize: 16, fontWeight: 600 }}>Failed to Load 3D Asset</div>
          <div style={{ color: 'var(--text-secondary)', maxWidth: 450, textAlign: 'center', fontSize: 13 }}>
            {loadError}
          </div>
          <button className="btn-secondary" onClick={() => onRevealInExplorer(asset.path)}>
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  );
}
