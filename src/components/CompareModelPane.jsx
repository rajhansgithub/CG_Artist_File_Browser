import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { load3DModel, normalizeModel, focusCameraOnModel } from '../utils/assetLoader';

// One lightweight 3D pane for the Compare view. Two of these run side by side; the
// parent forwards camera moves from one pane to the other so LOD0 / LOD1 (or any two
// versions of a model) are always seen from exactly the same angle.
const CompareModelPane = forwardRef(function CompareModelPane(
  { asset, renderMode = 'lit', onCameraChange, onStatus },
  ref
) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const needsRenderRef = useRef(true);
  const suppressRef = useRef(false);
  const renderModeRef = useRef(renderMode);
  const onCameraChangeRef = useRef(onCameraChange);
  const onStatusRef = useRef(onStatus);

  renderModeRef.current = renderMode;
  onCameraChangeRef.current = onCameraChange;
  onStatusRef.current = onStatus;

  useImperativeHandle(ref, () => ({
    getCamera() {
      const cam = cameraRef.current;
      const controls = controlsRef.current;
      if (!cam || !controls) return null;
      return {
        position: cam.position.toArray(),
        target: controls.target.toArray()
      };
    },
    applyCamera(state) {
      const cam = cameraRef.current;
      const controls = controlsRef.current;
      if (!cam || !controls || !state) return;
      suppressRef.current = true;
      cam.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      controls.update();
      suppressRef.current = false;
      needsRenderRef.current = true;
    },
    frame() {
      if (cameraRef.current && controlsRef.current && modelRef.current) {
        // The parent copies the framed camera to the other pane itself
        suppressRef.current = true;
        focusCameraOnModel(cameraRef.current, controlsRef.current, modelRef.current);
        suppressRef.current = false;
        needsRenderRef.current = true;
      }
    }
  }));

  // Scene, renderer, controls and render-on-demand loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0c);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(3, 2.5, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rendererRef.current = renderer;
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controls.target.set(0, 1.0, 0);
    controlsRef.current = controls;

    const grid = new THREE.GridHelper(10, 20, 0x555555, 0x222222);
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1c1c1c, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 8, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa0a0a0, 0.8);
    fill.position.set(-5, 4, -4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(0, 5, -6);
    scene.add(rim);

    const handleControlsChange = () => {
      needsRenderRef.current = true;
      if (!suppressRef.current && onCameraChangeRef.current) {
        onCameraChangeRef.current({
          position: camera.position.toArray(),
          target: controls.target.toArray()
        });
      }
    };
    controls.addEventListener('change', handleControlsChange);

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // Render right away so the canvas never shows blank for a frame while resizing
      renderer.render(scene, camera);
    });
    resizeObserver.observe(container);

    const canvas = renderer.domElement;
    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const moving = controls.update();
      if (moving || needsRenderRef.current) {
        renderer.render(scene, camera);
        needsRenderRef.current = false;
      }
    };
    animate();

    const handleContextLost = (e) => {
      e.preventDefault();
      cancelAnimationFrame(frameId);
    };
    const handleContextRestored = () => {
      needsRenderRef.current = true;
      animate();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      disposeModel(modelRef.current);
      modelRef.current = null;
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    };
  }, []);

  // Load the model whenever the asset changes
  useEffect(() => {
    if (!asset || !sceneRef.current) return;

    let isMounted = true;
    onStatusRef.current?.({ loading: true, error: null, stats: null });

    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      disposeModel(modelRef.current);
      modelRef.current = null;
      needsRenderRef.current = true;
    }

    load3DModel(asset)
      .then(({ root, stats }) => {
        if (!isMounted) {
          disposeModel(root);
          return;
        }
        normalizeModel(root, 3.0);
        sceneRef.current.add(root);
        modelRef.current = root;
        applyRenderMode(root, renderModeRef.current);
        suppressRef.current = true;
        focusCameraOnModel(cameraRef.current, controlsRef.current, root);
        suppressRef.current = false;
        needsRenderRef.current = true;
        onStatusRef.current?.({ loading: false, error: null, stats, loaded: true });
      })
      .catch((err) => {
        if (!isMounted) return;
        onStatusRef.current?.({
          loading: false,
          error: err?.message || 'Failed to load 3D file.',
          stats: null
        });
      });

    return () => {
      isMounted = false;
    };
  }, [asset?.path]);

  useEffect(() => {
    if (modelRef.current) {
      applyRenderMode(modelRef.current, renderMode);
      needsRenderRef.current = true;
    }
  }, [renderMode]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
});

// Swap surface shading for the whole model. Original materials are kept so Lit can restore them.
function applyRenderMode(root, mode) {
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (!child.userData.origMaterial) child.userData.origMaterial = child.material;

    if (mode === 'wire') {
      if (!child.userData.wireMat) {
        child.userData.wireMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
      }
      child.material = child.userData.wireMat;
    } else if (mode === 'normals') {
      if (!child.userData.normalsMat) child.userData.normalsMat = new THREE.MeshNormalMaterial();
      child.material = child.userData.normalsMat;
    } else if (mode === 'clay') {
      if (!child.userData.clayMat) {
        child.userData.clayMat = new THREE.MeshStandardMaterial({
          color: 0xd4d4d8,
          roughness: 0.65,
          metalness: 0.05
        });
      }
      child.material = child.userData.clayMat;
    } else {
      child.material = child.userData.origMaterial;
    }
  });
}

function disposeModel(root) {
  if (!root) return;
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    child.userData.wireMat?.dispose();
    child.userData.normalsMat?.dispose();
    child.userData.clayMat?.dispose();
  });
}

export default CompareModelPane;
