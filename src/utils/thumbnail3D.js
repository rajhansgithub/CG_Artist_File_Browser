import * as THREE from 'three';
import { load3DModel } from './assetLoader.js';

// Reusable offscreen 3D renderer for high-quality, focused model previews on dark background
let offscreen3DRenderer = null;
let offscreen3DScene = null;
let offscreen3DCamera = null;

function getOffscreen3DRenderer() {
  if (!offscreen3DRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 160;
    offscreen3DRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    offscreen3DRenderer.setSize(320, 160, false);
    offscreen3DRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    offscreen3DRenderer.toneMappingExposure = 1.3;

    offscreen3DScene = new THREE.Scene();
    offscreen3DScene.background = new THREE.Color(0x0a0a0a); // Pure dark background

    offscreen3DCamera = new THREE.PerspectiveCamera(45, 320 / 160, 0.01, 1000);

    // Studio Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x181818, 0.9);
    offscreen3DScene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 5);
    offscreen3DScene.add(key);

    const fill = new THREE.DirectionalLight(0x888888, 1.0);
    fill.position.set(-5, 4, -4);
    offscreen3DScene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(0, 5, -6);
    offscreen3DScene.add(rim);
  }
  return { renderer: offscreen3DRenderer, scene: offscreen3DScene, camera: offscreen3DCamera };
}

// Render offscreen 3D thumbnail with auto-framing on dark background
export async function renderOffscreen3DThumbnail(item) {
  const { renderer, scene, camera } = getOffscreen3DRenderer();

  const { root } = await load3DModel(item);
  if (!root) throw new Error('No root object returned from load3DModel');

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) throw new Error('Invalid model dimensions');

  // Center model at origin
  root.position.sub(center);
  root.updateMatrixWorld(true);

  // If model has no materials or pure black, apply neutral studio clay material
  let hasValidMaterial = false;
  root.traverse((child) => {
    if (child.isMesh && child.material) {
      hasValidMaterial = true;
    }
  });

  if (!hasValidMaterial) {
    const defaultMat = new THREE.MeshStandardMaterial({
      color: 0x909090,
      roughness: 0.35,
      metalness: 0.15
    });
    root.traverse((child) => {
      if (child.isMesh) child.material = defaultMat;
    });
  }

  scene.add(root);

  // Position camera so model fills the frame comfortably
  const fovRad = camera.fov * (Math.PI / 180);
  let dist = (maxDim / 2) / Math.tan(fovRad / 2);
  dist *= 1.35; // optimal 35% margin

  camera.position.set(dist * 0.75, dist * 0.45, dist * 0.85);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.001, dist * 0.01);
  camera.far = Math.max(1000, dist * 100);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.88);

  scene.remove(root);
  return dataUrl;
}
