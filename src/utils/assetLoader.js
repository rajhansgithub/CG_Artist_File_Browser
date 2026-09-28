import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from './exrLoaderExtended.js';

// Convert local file path to app-asset streaming URL
export function toStreamUrl(filePath) {
  if (!filePath) return '';
  if (window.electronAPI?.toAssetUrl) {
    return window.electronAPI.toAssetUrl(filePath);
  }
  // Browser fallback
  return filePath;
}

// Calculate comprehensive geometry stats
export function computeModelStats(object3D) {
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();

  object3D.traverse((child) => {
    if (child.isMesh) {
      meshes++;
      const geom = child.geometry;
      if (geom) {
        if (geom.index) {
          triangles += geom.index.count / 3;
        } else if (geom.attributes?.position) {
          triangles += geom.attributes.position.count / 3;
        }

        if (geom.attributes?.position) {
          vertices += geom.attributes.position.count;
        }
      }

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m && materials.add(m.name || 'Material'));
        } else {
          materials.add(child.material.name || 'Material');
        }
      }
    }
  });

  const bbox = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  return {
    vertices,
    triangles: Math.round(triangles),
    meshes,
    materials: Array.from(materials),
    dimensions: {
      x: parseFloat(size.x.toFixed(2)),
      y: parseFloat(size.y.toFixed(2)),
      z: parseFloat(size.z.toFixed(2))
    },
    maxDim: Math.max(size.x, size.y, size.z)
  };
}

// Center and normalize model size for comfortable viewing
export function normalizeModel(object3D, targetSize = 3.0) {
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 0) {
    const scale = targetSize / maxDimension;
    object3D.scale.setScalar(scale);
    object3D.updateMatrixWorld(true);

    // Re-calculate box after scale
    const scaledBox = new THREE.Box3().setFromObject(object3D);
    const scaledCenter = new THREE.Vector3();
    scaledBox.getCenter(scaledCenter);

    // Center in X and Z, place bottom at Y = 0
    object3D.position.x -= scaledCenter.x;
    object3D.position.y -= scaledBox.min.y;
    object3D.position.z -= scaledCenter.z;
    object3D.updateMatrixWorld(true);
  }
}

// Calculate perfect camera focus distance and position for ANY model (big or small)
export function focusCameraOnModel(camera, controls, object3D) {
  if (!camera || !object3D) return;
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  const fovRad = (camera.fov || 50) * (Math.PI / 180);
  let distance = (maxDim / 2) / Math.tan(fovRad / 2);
  distance *= 1.35; // 35% margin for comfortable framing

  camera.position.set(
    center.x + distance * 0.75,
    center.y + distance * 0.45,
    center.z + distance * 0.85
  );
  camera.near = Math.max(0.001, distance * 0.01);
  camera.far = Math.max(1000, distance * 100);
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

// Main 3D model loader supporting all requested formats
export async function load3DModel(fileItem, onProgress = () => {}) {
  const ext = (fileItem.extension || '').toLowerCase();
  const filePath = fileItem.path;

  // Handle Alembic (.abc) or complex USD (.usd, .usda, .usdc) via Blender background converter
  if (ext === '.abc' || ext === '.usd' || ext === '.usda' || ext === '.usdc') {
    if (!window.electronAPI?.convertAsset) {
      throw new Error('Alembic/USD conversion requires the desktop app environment.');
    }

    onProgress(0.2, 'Converting with Blender in background...');
    const result = await window.electronAPI.convertAsset(filePath);

    if (!result.success) {
      throw new Error(`Failed to convert ${ext} with Blender: ${result.error || 'Unknown error'}`);
    }

    onProgress(0.7, 'Loading converted 3D scene...');
    const streamUrl = toStreamUrl(result.glbPath);
    return loadGlbFile(streamUrl, onProgress);
  }

  const streamUrl = toStreamUrl(filePath);

  switch (ext) {
    case '.gltf':
    case '.glb':
      return loadGlbFile(streamUrl, onProgress);

    case '.obj':
      return loadObjFile(streamUrl, filePath, onProgress);

    case '.fbx':
      return loadFbxFile(streamUrl, onProgress);

    case '.stl':
      return loadStlFile(streamUrl, onProgress);

    case '.ply':
      return loadPlyFile(streamUrl, onProgress);

    case '.usdz':
      return loadUsdzFile(streamUrl, onProgress);

    default:
      throw new Error(`Unsupported 3D file format: ${ext}`);
  }
}

function loadGlbFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        root.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve({
          root,
          animations: gltf.animations || [],
          stats: computeModelStats(root)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Downloading...');
      },
      reject
    );
  });
}

async function loadObjFile(url, fullPath, onProgress) {
  // Check for MTL companion
  let materials = null;
  const mtlPath = fullPath.replace(/\.obj$/i, '.mtl');

  try {
    const mtlUrl = toStreamUrl(mtlPath);
    const mtlLoader = new MTLLoader();
    materials = await new Promise((resolve) => {
      mtlLoader.load(mtlUrl, (mats) => {
        mats.preload();
        resolve(mats);
      }, undefined, () => resolve(null));
    });
  } catch (e) {
    materials = null;
  }

  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    if (materials) loader.setMaterials(materials);

    loader.load(
      url,
      (obj) => {
        obj.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                roughness: 0.5,
                metalness: 0.1
              });
            }
          }
        });
        resolve({
          root: obj,
          animations: [],
          stats: computeModelStats(obj)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading OBJ...');
      },
      reject
    );
  });
}

function loadFbxFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve({
          root: fbx,
          animations: fbx.animations || [],
          stats: computeModelStats(fbx)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading FBX...');
      },
      reject
    );
  });
}

function loadStlFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new STLLoader();
    loader.load(
      url,
      (geom) => {
        geom.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: 0x88aacc,
          roughness: 0.35,
          metalness: 0.2
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const group = new THREE.Group();
        group.add(mesh);
        resolve({
          root: group,
          animations: [],
          stats: computeModelStats(group)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading STL...');
      },
      reject
    );
  });
}

function loadPlyFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new PLYLoader();
    loader.load(
      url,
      (geom) => {
        geom.computeVertexNormals();
        const group = new THREE.Group();
        if (geom.index || geom.attributes.normal) {
          const mat = new THREE.MeshStandardMaterial({
            color: 0x99bbdd,
            roughness: 0.4,
            metalness: 0.1
          });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        } else {
          // Point cloud
          const mat = new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: !!geom.attributes.color
          });
          const points = new THREE.Points(geom, mat);
          group.add(points);
        }
        resolve({
          root: group,
          animations: [],
          stats: computeModelStats(group)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading PLY...');
      },
      reject
    );
  });
}

function loadUsdzFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new USDZLoader();
    loader.load(
      url,
      (usdGroup) => {
        usdGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve({
          root: usdGroup,
          animations: [],
          stats: computeModelStats(usdGroup)
        });
      },
      (xhr) => {
        if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading USDZ...');
      },
      reject
    );
  });
}

// In-memory ArrayBuffer cache for active HDR/EXR file to allow instant multi-layer switching without re-reading disk
const activeExrBufferCache = new Map();

// In-memory decoded layer texture cache: key = `${filePath}:${layerName}` -> decoded result
// Ensures that once a pass/layer is decoded, switching back to it is 100% instantaneous (0ms)
const layerTextureCache = new Map();
let currentCachedPath = null;
let activeExrLoader = null;
let preloadAbortController = null;

export function isLayerCached(filePath, layerName) {
  if (!filePath) return false;
  return layerTextureCache.has(`${filePath}:${layerName || '__default__'}`);
}

export function getCachedLayerCount(filePath) {
  if (!filePath) return 0;
  let count = 0;
  for (const key of layerTextureCache.keys()) {
    if (key.startsWith(`${filePath}:`)) count++;
  }
  return count;
}

function cancelBackgroundLayerPreload() {
  if (preloadAbortController) {
    preloadAbortController.aborted = true;
    preloadAbortController = null;
  }
}

async function startBackgroundLayerPreload(filePath, buffer, loader, availableLayers) {
  cancelBackgroundLayerPreload();
  const controller = { aborted: false };
  preloadAbortController = controller;

  // Let initial render complete and controls settle
  await new Promise((r) => setTimeout(r, 160));
  if (controller.aborted) return;

  for (const layerName of availableLayers) {
    if (controller.aborted) break;
    const cacheKey = `${filePath}:${layerName}`;
    if (layerTextureCache.has(cacheKey)) continue;

    try {
      loader.setLayer(layerName);
      const texData = loader.parse(buffer);
      if (controller.aborted) break;

      const texture = new THREE.DataTexture(
        texData.data,
        texData.width,
        texData.height,
        texData.format || THREE.RGBAFormat,
        texData.type || THREE.FloatType
      );
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.needsUpdate = true;

      const parsedChannels = texData.header?.channels
        ? texData.header.channels.map((c) => c.name)
        : ['R', 'G', 'B', 'A'];

      const res = {
        texture,
        rawData: texData.data,
        width: texData.width,
        height: texData.height,
        header: texData.header,
        channels: parsedChannels,
        availableLayers: texData.availableLayers || [],
        selectedLayer: layerName,
        compression: texData.header?.compression || 'ZIP / PIZ',
        format: 'OpenEXR (.exr)',
        pixelType: texData.type === THREE.FloatType ? '32-bit Float' : '16-bit Half-Float',
        isHdr: false,
        isExr: true
      };

      layerTextureCache.set(cacheKey, res);

      // Notify UI of background progress
      window.dispatchEvent(
        new CustomEvent('exr-layer-cached', {
          detail: {
            filePath,
            layerName,
            cachedCount: getCachedLayerCount(filePath),
            total: availableLayers.length
          }
        })
      );
    } catch (e) {
      console.warn(`Background pre-decode for layer "${layerName}" skipped:`, e);
    }

    // Yield back to event loop for 60ms between layers so 60fps rendering and UI never stutter
    await new Promise((r) => setTimeout(r, 60));
  }
}

// HDR and EXR Loaders
export async function loadHdrTexture(fileItem, onProgress = () => {}, selectedLayer = null) {
  const ext = (fileItem.extension || '').toLowerCase();

  // Reset cache if user switched to a completely different file
  if (currentCachedPath !== fileItem.path) {
    layerTextureCache.clear();
    cancelBackgroundLayerPreload();
    if (activeExrLoader) {
      activeExrLoader.clearBlockCache?.();
      activeExrLoader = null;
    }
    currentCachedPath = fileItem.path;
  }

  const cacheKey = `${fileItem.path}:${selectedLayer || '__default__'}`;
  if (layerTextureCache.has(cacheKey)) {
    return layerTextureCache.get(cacheKey);
  }

  // Try direct binary buffer loading first via Electron IPC (fastest, most reliable)
  if (window.electronAPI?.readFileBuffer) {
    try {
      let buffer = activeExrBufferCache.get(fileItem.path);
      if (!buffer) {
        const rawBuf = await window.electronAPI.readFileBuffer(fileItem.path);
        // Ensure we have a clean, standalone ArrayBuffer
        if (rawBuf instanceof ArrayBuffer) {
          buffer = rawBuf;
        } else if (rawBuf && rawBuf.buffer instanceof ArrayBuffer) {
          buffer = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
        } else {
          buffer = rawBuf;
        }
        if (activeExrBufferCache.size > 1) activeExrBufferCache.clear();
        activeExrBufferCache.set(fileItem.path, buffer);
      }

      if (ext === '.hdr') {
        const loader = new RGBELoader();
        loader.setDataType(THREE.FloatType);
        const texData = loader.parse(buffer);
        const texture = new THREE.DataTexture(
          texData.data,
          texData.width,
          texData.height,
          THREE.RGBAFormat,
          THREE.FloatType
        );
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        const res = {
          texture,
          rawData: texData.data,
          width: texData.width,
          height: texData.height,
          channels: ['R', 'G', 'B'],
          format: 'RGBE (.hdr)',
          pixelType: '32-bit Float RGBE',
          isHdr: true,
          isExr: false
        };
        layerTextureCache.set(cacheKey, res);
        return res;
      } else if (ext === '.exr') {
        if (!activeExrLoader) {
          activeExrLoader = new EXRLoader();
          activeExrLoader.setDataType(THREE.FloatType);
        }
        const loader = activeExrLoader;
        if (selectedLayer) {
          loader.setLayer(selectedLayer);
        }
        const texData = loader.parse(buffer);
        const texture = new THREE.DataTexture(
          texData.data,
          texData.width,
          texData.height,
          texData.format || THREE.RGBAFormat,
          texData.type || THREE.FloatType
        );
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        const parsedChannels = texData.header?.channels
          ? texData.header.channels.map((c) => c.name)
          : ['R', 'G', 'B', 'A'];
        const res = {
          texture,
          rawData: texData.data,
          width: texData.width,
          height: texData.height,
          header: texData.header,
          channels: parsedChannels,
          availableLayers: texData.availableLayers || [],
          selectedLayer: texData.selectedLayer || null,
          compression: texData.header?.compression || 'ZIP / PIZ',
          format: 'OpenEXR (.exr)',
          pixelType: texData.type === THREE.FloatType ? '32-bit Float' : '16-bit Half-Float',
          isHdr: false,
          isExr: true
        };
        layerTextureCache.set(cacheKey, res);
        if (texData.selectedLayer) {
          layerTextureCache.set(`${fileItem.path}:${texData.selectedLayer}`, res);
        }

        // Trigger non-blocking background pre-decode for remaining layers
        if (texData.availableLayers && texData.availableLayers.length > 1) {
          startBackgroundLayerPreload(fileItem.path, buffer, loader, texData.availableLayers);
        }

        return res;
      }
    } catch (err) {
      console.warn('Direct buffer loading failed, falling back to streamUrl:', err);
    }
  }

  const streamUrl = toStreamUrl(fileItem.path);

  return new Promise((resolve, reject) => {
    if (ext === '.hdr') {
      const loader = new RGBELoader();
      loader.setDataType(THREE.FloatType);
      loader.load(
        streamUrl,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.needsUpdate = true;
          const res = {
            texture,
            rawData: texture.image?.data || null,
            width: texture.image?.width || 2048,
            height: texture.image?.height || 1024,
            channels: ['R', 'G', 'B'],
            format: 'RGBE (.hdr)',
            pixelType: '32-bit Float RGBE',
            isHdr: true,
            isExr: false
          };
          layerTextureCache.set(cacheKey, res);
          resolve(res);
        },
        (xhr) => {
          if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading HDR...');
        },
        reject
      );
    } else if (ext === '.exr') {
      const loader = new EXRLoader();
      loader.setDataType(THREE.FloatType);
      if (selectedLayer) {
        loader.setLayer(selectedLayer);
      }
      loader.load(
        streamUrl,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.needsUpdate = true;
          const res = {
            texture,
            rawData: texture.image?.data || null,
            width: texture.image?.width || 2048,
            height: texture.image?.height || 1024,
            channels: ['R', 'G', 'B', 'A'],
            format: 'OpenEXR (.exr)',
            pixelType: '32-bit Float',
            isHdr: false,
            isExr: true
          };
          layerTextureCache.set(cacheKey, res);
          resolve(res);
        },
        (xhr) => {
          if (xhr.lengthComputable) onProgress(xhr.loaded / xhr.total, 'Loading EXR...');
        },
        reject
      );
    } else {
      reject(new Error(`Unsupported HDR format: ${ext}`));
    }
  });
}
