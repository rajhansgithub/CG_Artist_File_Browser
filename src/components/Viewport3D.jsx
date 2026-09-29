import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { load3DModel, normalizeModel, focusCameraOnModel } from '../utils/assetLoader';
import {
  RotateCw,
  Eye,
  Grid,
  Sun,
  Camera,
  Play,
  Pause,
  Maximize2,
  Box,
  Layers,
  Sparkles,
  Info,
  Sliders,
  ChevronDown,
  Check,
  ExternalLink
} from 'lucide-react';

// Optimized wireframe LineSegments overlay generator
function getOrCreateWireframeHelper(mesh) {
  if (mesh.userData.wireframeHelper) {
    return mesh.userData.wireframeHelper;
  }

  const geom = mesh.geometry;
  if (!geom || !geom.attributes?.position) return null;

  const posAttr = geom.attributes.position;
  const totalVerts = posAttr.count;
  const isIndexed = !!geom.index;
  const totalTris = Math.floor(isIndexed ? geom.index.count / 3 : totalVerts / 3);

  if (totalTris <= 0) return null;

  // Ultra-fast typed array generation for wireframe indices.
  // Pre-allocates a contiguous Uint32Array (no V8 array reallocations / 1.5GB heap spikes).
  // Supports up to 2.5 million triangles at 1:1 fidelity (under 12ms build time).
  const maxSafeTris = 2500000;
  const step = totalTris > maxSafeTris ? Math.ceil(totalTris / maxSafeTris) : 1;
  const sampledTris = Math.ceil(totalTris / step);

  const lineIndices = new Uint32Array(sampledTris * 6);
  let writeIdx = 0;

  if (isIndexed) {
    const src = geom.index.array;
    for (let i = 0; i < totalTris; i += step) {
      const idx = i * 3;
      const a = src[idx];
      const b = src[idx + 1];
      const c = src[idx + 2];
      lineIndices[writeIdx++] = a;
      lineIndices[writeIdx++] = b;
      lineIndices[writeIdx++] = b;
      lineIndices[writeIdx++] = c;
      lineIndices[writeIdx++] = c;
      lineIndices[writeIdx++] = a;
    }
  } else {
    for (let i = 0; i < totalTris; i += step) {
      const a = i * 3;
      const b = a + 1;
      const c = a + 2;
      lineIndices[writeIdx++] = a;
      lineIndices[writeIdx++] = b;
      lineIndices[writeIdx++] = b;
      lineIndices[writeIdx++] = c;
      lineIndices[writeIdx++] = c;
      lineIndices[writeIdx++] = a;
    }
  }

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

export default function Viewport3D({
  asset,
  onClose,
  onRevealInExplorer
}) {
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
  const [stats, setStats] = useState(null);

  // Animation State
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const [animations, setAnimations] = useState([]);
  const [currentAnimIndex, setCurrentAnimIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animTime, setAnimTime] = useState(0);
  const [animDuration, setAnimDuration] = useState(0);

  // Three.js internal references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const gridRef = useRef(null);
  const lightsGroupRef = useRef(null);
  const mixerRef = useRef(null);
  const actionRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const needsRenderRef = useRef(true);

  // Refs to avoid stale closures in render loop
  const turntableRef = useRef(false);
  const turntableSpeedRef = useRef(1.0);
  const isPlayingRef = useRef(true);
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

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(3, 2.5, 4);
    cameraRef.current = camera;

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

    const controls = new OrbitControls(camera, renderer.domElement);
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
      if (!entries[0] || !rendererRef.current || !cameraRef.current) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      rendererRef.current.shadowMap.needsUpdate = true;
    });

    resizeObserver.observe(containerRef.current);

    // Render loop with smart render-on-demand
    let animFrameId;
    const requestRender = () => { needsRenderRef.current = true; };
    controls.addEventListener('change', requestRender);

    const canvas = renderer.domElement;
    const handleContextLost = (e) => {
      e.preventDefault();
      console.warn('WebGL context lost! Waiting for restoration...');
      cancelAnimationFrame(animFrameId);
    };

    const handleContextRestored = () => {
      console.log('WebGL context restored! Re-rendering scene...');
      if (containerRef.current && rendererRef.current && cameraRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
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
        renderer.render(scene, camera);
        needsRenderRef.current = false;
      }
    };

    animate();

    return () => {
      controls.removeEventListener('change', requestRender);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameId);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    updateLighting(lightingPreset, lightsGroupRef.current);
    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
    needsRenderRef.current = true;
  }, [lightingPreset]);

  // Load Model Asset
  useEffect(() => {
    if (!asset || !sceneRef.current) return;

    let isMounted = true;
    setLoading(true);
    setLoadError(null);
    setLoadingMsg(`Loading ${asset.name}...`);

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
      });
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
        setStats(modelStats);

        // Perfectly focus and frame model
        if (controlsRef.current && cameraRef.current) {
          focusCameraOnModel(cameraRef.current, controlsRef.current, root);
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
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error loading 3D asset:', err);
        setLoadError(err.message || 'Failed to load 3D file.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [asset]);

  // Keyboard shortcut: F to focus/frame model, Esc to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'f' || e.key === 'F') {
        if (cameraRef.current && controlsRef.current && modelRef.current) {
          focusCameraOnModel(cameraRef.current, controlsRef.current, modelRef.current);
          needsRenderRef.current = true;
        }
      } else if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Handle Render Style changes (Lit, Wireframe, Normals, Clay) & Wireframe Overlay
  useEffect(() => {
    if (!modelRef.current) return;

    const isWireframeActive = showWireframe || renderMode === 'wire_overlay' || renderMode === 'wireframe';
    const isPureWireframe = renderMode === 'wireframe';

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

    modelRef.current.traverse((child) => {
      // Strictly ignore any wireframe or helper overlays to prevent recursion
      if (child.userData.isHelper || child.userData.isWireframeOverlay) {
        return;
      }

      if (child.isMesh && child.geometry) {
        if (!child.userData.origMaterial) {
          child.userData.origMaterial = child.material;
        }

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
  }, [renderMode, showWireframe, stats]);

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
    <div className="viewport-wrapper">
      <div ref={containerRef} className="canvas-container" />

      {/* Floating HUD Toolbar */}
      <div className="viewport-hud">
        {/* Turntable */}
        <button
          className={`hud-btn ${turntable ? 'active' : ''}`}
          onClick={() => setTurntable(!turntable)}
          title="Auto Turntable Spin"
        >
          <RotateCw size={14} className={turntable ? 'spin-icon' : ''} />
          <span className="hud-label">Turntable</span>
        </button>

        {/* Grid Toggle */}
        <button
          className={`hud-btn ${showGrid ? 'active' : ''}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle Ground Grid"
        >
          <Grid size={14} />
          <span className="hud-label">Grid</span>
        </button>

        {/* Wireframe Overlay Toggle */}
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
          <Box size={14} />
          <span className="hud-label">Wireframe</span>
        </button>

        <div className="hud-divider" />

        {/* Shading Mode */}
        <select
          className="hud-btn"
          value={renderMode}
          onChange={(e) => {
            const mode = e.target.value;
            setRenderMode(mode);
            if (mode === 'wire_overlay' || mode === 'wireframe') {
              setShowWireframe(true);
            }
          }}
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)' }}
          title="Shading Mode"
        >
          <option value="lit" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Shaded (PBR Material)</option>
          <option value="clay" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Clay Studio</option>
          <option value="normals" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Normal Vectors</option>
          <option value="wire_overlay" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Wireframe Overlay</option>
          <option value="wireframe" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Pure Wireframe</option>
        </select>

        {/* Lighting & Environment Presets */}
        <select
          className="hud-btn"
          value={lightingPreset}
          onChange={(e) => setLightingPreset(e.target.value)}
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)' }}
          title="Lighting & Environment Rig"
        >
          <option value="studio" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Studio Softbox</option>
          <option value="neutral" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Neutral White</option>
          <option value="high_contrast" style={{ color: '#000000', backgroundColor: '#ffffff' }}>High Contrast Sun</option>
          <option value="rim_only" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Rim / Silhouette</option>
        </select>

        <div className="hud-divider" />

        {/* Focus / Frame Camera */}
        <button
          className="hud-btn"
          onClick={() => {
            if (cameraRef.current && controlsRef.current && modelRef.current) {
              focusCameraOnModel(cameraRef.current, controlsRef.current, modelRef.current);
            }
          }}
          title="Focus / Frame Model (F key)"
        >
          <Maximize2 size={14} />
          <span className="hud-label">Focus</span>
        </button>

        {/* Screenshot */}
        <button
          className={`hud-btn ${snapshotFeedback ? 'active' : ''}`}
          onClick={captureSnapshot}
          title="Capture Snapshot PNG"
        >
          {snapshotFeedback ? <Check size={14} color="#22c55e" /> : <Camera size={14} />}
          <span className="hud-label">{snapshotFeedback ? 'Saved!' : 'Snapshot'}</span>
        </button>

        {onRevealInExplorer && (
          <button
            className="hud-btn"
            onClick={() => onRevealInExplorer(asset.path)}
            title="Reveal in Windows Explorer"
          >
            <ExternalLink size={13} />
            <span className="hud-label">Explorer</span>
          </button>
        )}

        {onClose && (
          <button className="hud-btn" onClick={onClose} style={{ marginLeft: 6 }} title="Close View (Esc)">
            ✕
          </button>
        )}
      </div>

      {/* Model Stats HUD (Triangles, Vertices, Meshes, Dimensions) */}
      {stats && (
        <div className="viewport-stats-overlay">
          <div style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
            {asset.name}
          </div>
          <div className="stat-row">
            <span>Triangles:</span>
            <span className="stat-value">{stats.triangles.toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span>Vertices:</span>
            <span className="stat-value">{stats.vertices.toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span>Meshes:</span>
            <span className="stat-value">{stats.meshes}</span>
          </div>
          <div className="stat-row">
            <span>Materials:</span>
            <span className="stat-value">{stats.materials.length}</span>
          </div>
          <div className="stat-row">
            <span>Dimensions:</span>
            <span className="stat-value">
              {stats.dimensions.x} × {stats.dimensions.y} × {stats.dimensions.z}
            </span>
          </div>
        </div>
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
