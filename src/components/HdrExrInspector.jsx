import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadHdrTexture, isLayerCached, getCachedLayerCount } from '../utils/assetLoader';
import {
  SunMedium,
  Sliders,
  Globe,
  Maximize2,
  Camera,
  Layers,
  Sparkles,
  RotateCcw,
  Eye,
  ArrowUpDown,
  Pipette,
  Columns,
  Thermometer,
  Activity,
  Copy,
  Check,
  Lock,
  Unlock,
  Crosshair,
  BarChart3,
  Loader2,
  ExternalLink
} from 'lucide-react';

const SPHERE_SIZES = {
  big_bada: { id: 'big_bada', name: 'Big bada sphere = 300 meters', radius: 150, meters: 300 },
  large: { id: 'large', name: 'Large = 150 meters', radius: 75, meters: 150 },
  medium: { id: 'medium', name: 'Medium = 80 meters', radius: 40, meters: 80 },
  small: { id: 'small', name: 'Small = 60 meters', radius: 30, meters: 60 }
};

// Kelvin to RGB conversion (Tanner Helland Planckian locus algorithm)
function kelvinToRgb(kelvin) {
  const temp = Math.max(2000, Math.min(10000, kelvin)) / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return [
    Math.max(0, Math.min(255, r)) / 255,
    Math.max(0, Math.min(255, g)) / 255,
    Math.max(0, Math.min(255, b)) / 255
  ];
}

// Neutral D65 reference at 6500K
const D65_RGB = kelvinToRgb(6500);

function getWhiteBalanceMultiplier(kelvin) {
  const rgb = kelvinToRgb(kelvin);
  return [
    rgb[0] / D65_RGB[0],
    rgb[1] / D65_RGB[1],
    rgb[2] / D65_RGB[2]
  ];
}

export default function HdrExrInspector({
  asset,
  onClose,
  onRevealInExplorer
}) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [textureInfo, setTextureInfo] = useState(null);

  // Inspector Parameters
  const [ev, setEv] = useState(0.0); // Exposure EV: -60 to +60
  const [toneMapping, setToneMapping] = useState('aces'); // 'aces', 'agx', 'reinhard', 'cineon', 'linear'
  const [channel, setChannel] = useState('rgb'); // 'rgb', 'r', 'g', 'b', 'a', 'lum'
  const [falseColor, setFalseColor] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false); // Vertical flip orientation
  const [viewMode, setViewMode] = useState('flat'); // 'flat' or 'pano' (360 sphere)
  const [sphereSize, setSphereSize] = useState('large'); // 'big_bada', 'large', 'medium', 'small'
  const [selectedLayer, setSelectedLayer] = useState(null);
  const prevViewModeRef = useRef(viewMode);

  // White Balance & Tint
  const [kelvin, setKelvin] = useState(6500); // 2000K to 10000K (default 6500K D65)
  const [tint, setTint] = useState(0); // -50 (magenta) to +50 (green)

  // 360 Reference Spheres (Chrome, 50% Gray Matte, White Specular)
  const [showProbes, setShowProbes] = useState(true);

  // Split-Screen Wipe / Curtain Comparison
  const [wipeActive, setWipeActive] = useState(false);
  const [wipePos, setWipePos] = useState(0.5); // 0.0 to 1.0 (divider horizontal position)
  const [wipeMode, setWipeMode] = useState(0); // 0: Tonemapped vs Raw Linear, 1: Tonemapped vs False Color
  const isDraggingWipeRef = useRef(false);

  // Precision 32-bit Float Eyedropper / Color Probe
  const [probeData, setProbeData] = useState(null);
  const [isProbePinned, setIsProbePinned] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const pinnedUvRef = useRef(null);

  // Real-Time Dynamic Range Luminance Histogram
  const histogramCanvasRef = useRef(null);
  const [histStats, setHistStats] = useState({
    headroomEv: '0.0 EV',
    maxLum: '1.00',
    blackClipPct: '0.0',
    highlightClipPct: '0.0'
  });

  // Three.js internal references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const meshRef = useRef(null);
  const probeRigRef = useRef(null);
  const probeSceneRef = useRef(null);
  const probeCameraRef = useRef(null);
  const probeBallsRef = useRef(null);
  const currentTextureRef = useRef(null);
  const shaderMaterialRef = useRef(null);

  // Setup Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 0, 2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = Math.pow(2, ev);
    renderer.autoClear = false;
    rendererRef.current = renderer;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    // Custom shader for channel isolation, white balance, false color & split wipe
    const customMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uExposure: { value: 1.0 },
        uChannel: { value: 0 }, // 0: RGB, 1: R, 2: G, 3: B, 4: A, 5: Lum
        uFalseColor: { value: 0 },
        uToneMapping: { value: 0 }, // 0: ACES, 1: Reinhard/AgX, 2: Linear, 3: Cineon
        uAspect: { value: 1.0 },
        uFlipY: { value: 0 },
        uTempRgb: { value: new THREE.Vector3(1, 1, 1) },
        uTint: { value: 0.0 },
        uWipeActive: { value: 0 },
        uWipePos: { value: 0.5 },
        uWipeMode: { value: 0 } // 0: Tonemapped vs Raw Linear, 1: Tonemapped vs False Color
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform float uExposure;
        uniform int uChannel;
        uniform int uFalseColor;
        uniform int uToneMapping;
        uniform int uFlipY;
        uniform vec3 uTempRgb;
        uniform float uTint;
        uniform int uWipeActive;
        uniform float uWipePos;
        uniform int uWipeMode;
        varying vec2 vUv;

        // Monochrome-friendly dynamic range heatmap
        vec3 falseColorPalette(float t) {
          t = clamp(t, 0.0, 1.0);
          return clamp(vec3(
            1.5 * t - 0.2,
            4.0 * t * (1.0 - t),
            1.5 * (1.0 - t) - 0.2
          ), 0.0, 1.0);
        }

        // ACES Filmic Tone Mapping formula
        vec3 acesFilmic(vec3 color) {
          vec3 x = max(vec3(0.0), color);
          vec3 a = vec3(2.51);
          vec3 b = vec3(0.03);
          vec3 c = vec3(2.43);
          vec3 d = vec3(0.59);
          vec3 e = vec3(0.14);
          vec3 mapped = clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
          return pow(mapped, vec3(1.0 / 2.2)); // Linear to sRGB gamma curve
        }

        // Reinhard Tone Mapping
        vec3 reinhard(vec3 color) {
          vec3 mapped = color / (color + vec3(1.0));
          return pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2));
        }

        // Cineon Tone Mapping
        vec3 cineonTone(vec3 color) {
          vec3 x = max(vec3(0.0), color - 0.004);
          vec3 mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
          return clamp(mapped, 0.0, 1.0);
        }

        // Linear / Raw
        vec3 linearTone(vec3 color) {
          return pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));
        }

        void main() {
          vec2 uvCoords = vUv;
          if (uFlipY == 1) {
            uvCoords.y = 1.0 - uvCoords.y;
          }

          vec4 rawTex = texture2D(uTexture, uvCoords);

          // Apply White Balance (Kelvin) & Tint before tone mapping
          vec3 balanced = rawTex.rgb * uTempRgb;
          balanced.g *= (1.0 + uTint);
          balanced = max(vec3(0.0), balanced);

          // Apply Exposure multiplier
          vec3 exposed = balanced * uExposure;

          // Channel isolation
          vec3 isolatedColor = exposed;
          if (uChannel == 1) isolatedColor = vec3(exposed.r);
          else if (uChannel == 2) isolatedColor = vec3(exposed.g);
          else if (uChannel == 3) isolatedColor = vec3(exposed.b);
          else if (uChannel == 4) isolatedColor = vec3(rawTex.a);
          else if (uChannel == 5) {
            float lum = dot(exposed, vec3(0.2126, 0.7152, 0.0722));
            isolatedColor = vec3(lum);
          }

          // False Color Heatmap (if activated without split wipe)
          if (uFalseColor == 1 && uWipeActive == 0) {
            float lum = dot(isolatedColor, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor = vec4(falseColorPalette(lum), 1.0);
            return;
          }

          // Compute Tonemapped result
          vec3 tonemapped;
          if (uToneMapping == 1) tonemapped = reinhard(isolatedColor);
          else if (uToneMapping == 2) tonemapped = linearTone(isolatedColor);
          else if (uToneMapping == 3) tonemapped = cineonTone(isolatedColor);
          else tonemapped = acesFilmic(isolatedColor);

          // Split-Screen Wipe Curtain Divider
          if (uWipeActive == 1) {
            float splitX = uWipePos;
            // 2px divider line
            if (abs(uvCoords.x - splitX) < 0.0018) {
              gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
              return;
            }
            // Right side of wipe divider
            if (uvCoords.x > splitX) {
              if (uWipeMode == 1) {
                // False Color Heatmap
                float lum = dot(isolatedColor, vec3(0.2126, 0.7152, 0.0722));
                gl_FragColor = vec4(falseColorPalette(lum), 1.0);
                return;
              } else {
                // Raw Linear (Untoned sRGB curve)
                gl_FragColor = vec4(linearTone(isolatedColor), 1.0);
                return;
              }
            }
          }

          gl_FragColor = vec4(tonemapped, 1.0);
        }
      `,
      side: THREE.DoubleSide
    });

    shaderMaterialRef.current = customMaterial;

    // Setup 360° Studio Lighting Reference Spheres with OrthographicCamera
    // Eliminates camera FOV perspective distortion: spheres are 100% mathematically perfect round spheres!
    // Clean floating spheres - completely removed the dark base plate/pedestal and stems.
    const probeScene = new THREE.Scene();
    probeSceneRef.current = probeScene;

    const probeCamera = new THREE.OrthographicCamera(
      -width / 2, width / 2, height / 2, -height / 2, 0.1, 1000
    );
    probeCamera.position.set(0, 0, 500);
    probeCameraRef.current = probeCamera;

    const probeGroup = new THREE.Group();
    probeGroup.name = 'lightingProbeRig';
    probeScene.add(probeGroup);
    probeRigRef.current = probeGroup;
    probeGroup.visible = false;

    const sphereRadius = 36;
    const sphereGeom = new THREE.SphereGeometry(sphereRadius, 64, 32);

    // Ball 1: Chrome Mirror Ball (Left) - Light sources & specular reflection sharpness
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.0
    });
    const chromeBall = new THREE.Mesh(sphereGeom, chromeMat);
    probeGroup.add(chromeBall);

    // Ball 2: 50% Gray Matte Ball (Center) - Diffuse wrap & shadow softness
    const grayMat = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.95,
      metalness: 0.0
    });
    const grayBall = new THREE.Mesh(sphereGeom, grayMat);
    probeGroup.add(grayBall);

    // Ball 3: White Specular Ball (Right) - Highlight roll-off & color balance
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.16,
      metalness: 0.04
    });
    const whiteBall = new THREE.Mesh(sphereGeom, whiteMat);
    probeGroup.add(whiteBall);

    probeBallsRef.current = { chrome: chromeBall, gray: grayBall, white: whiteBall };

    const updateProbePositions = (w, h) => {
      const r = 36;
      const spacing = 86;
      const marginX = 28;
      const marginY = 28;
      const baseX = w / 2 - marginX - r;
      const baseY = -h / 2 + marginY + r;

      whiteBall.position.set(baseX, baseY, 0);
      grayBall.position.set(baseX - spacing, baseY, 0);
      chromeBall.position.set(baseX - 2 * spacing, baseY, 0);
    };

    updateProbePositions(width, height);

    // Smooth responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0] || !rendererRef.current || !cameraRef.current) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);

      if (probeCameraRef.current) {
        probeCameraRef.current.left = -w / 2;
        probeCameraRef.current.right = w / 2;
        probeCameraRef.current.top = h / 2;
        probeCameraRef.current.bottom = -h / 2;
        probeCameraRef.current.updateProjectionMatrix();
        updateProbePositions(w, h);
      }
    });

    resizeObserver.observe(containerRef.current);

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      renderer.clear();
      renderer.render(scene, camera);

      if (probeSceneRef.current && probeCameraRef.current && probeRigRef.current?.visible) {
        renderer.clearDepth();
        // Keep probeCamera stationary facing the HUD spheres so spheres never disappear or warp:
        probeCameraRef.current.rotation.set(0, 0, 0);
        // Rotate the environment reflection in sync with the skybox camera rotation:
        if (probeSceneRef.current.environmentRotation) {
          probeSceneRef.current.environmentRotation.setFromQuaternion(camera.quaternion);
        }
        renderer.render(probeSceneRef.current, probeCameraRef.current);
      }
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  // Update Geometry based on Flat vs 360 Panoramic and Sphere Size
  useEffect(() => {
    if (!sceneRef.current || !shaderMaterialRef.current) return;

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      meshRef.current = null;
    }

    if (viewMode === 'pano') {
      // 360 Inside Sphere with selected radius
      const radius = SPHERE_SIZES[sphereSize]?.radius || (sphereSize === 'mid' ? 40 : 75);
      const geom = new THREE.SphereGeometry(radius, 64, 32);
      geom.scale(-1, 1, 1); // Invert to view from inside
      const mesh = new THREE.Mesh(geom, shaderMaterialRef.current);
      sceneRef.current.add(mesh);
      meshRef.current = mesh;

      if (cameraRef.current && controlsRef.current) {
        controlsRef.current.maxDistance = radius * 0.95;
        controlsRef.current.minDistance = 0.01;

        if (prevViewModeRef.current !== 'pano') {
          cameraRef.current.position.set(0, 0, 0.1);
          cameraRef.current.rotation.set(0, 0, 0);
          controlsRef.current.target.set(0, 0, -1);
          controlsRef.current.enableRotate = true;
          controlsRef.current.enablePan = false;
          controlsRef.current.enableZoom = true;
          controlsRef.current.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
          };
          controlsRef.current.update();
        } else {
          if (cameraRef.current.position.length() >= radius * 0.9) {
            cameraRef.current.position.setLength(radius * 0.4);
            controlsRef.current.update();
          }
        }
      }
    } else {
      // Flat 2D View: Strictly locked 2D plane (NO 3D perspective tilt or skewing)
      const aspect = textureInfo ? textureInfo.width / textureInfo.height : 2.0;
      const geom = new THREE.PlaneGeometry(aspect * 2, 2);
      const mesh = new THREE.Mesh(geom, shaderMaterialRef.current);
      sceneRef.current.add(mesh);
      meshRef.current = mesh;

      if (cameraRef.current && controlsRef.current) {
        controlsRef.current.enableRotate = false;
        controlsRef.current.enablePan = true;
        controlsRef.current.enableZoom = true;
        controlsRef.current.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };

        const fovRad = (cameraRef.current.fov || 60) * (Math.PI / 180);
        const containerW = containerRef.current?.clientWidth || window.innerWidth;
        const containerH = containerRef.current?.clientHeight || window.innerHeight;
        const viewAspect = (containerW && containerH) ? containerW / containerH : 1.77;

        const planeH = 2.0;
        const planeW = 2.0 * aspect;

        const distH = (planeH / 2) / Math.tan(fovRad / 2);
        const distW = (planeW / 2) / (viewAspect * Math.tan(fovRad / 2));
        const fitDist = Math.max(distH, distW) * 1.08;

        cameraRef.current.position.set(0, 0, fitDist);
        cameraRef.current.rotation.set(0, 0, 0);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    }

    prevViewModeRef.current = viewMode;
  }, [viewMode, textureInfo, sphereSize]);

  // Sync 360 Reference Spheres Visibility
  useEffect(() => {
    if (probeRigRef.current) {
      probeRigRef.current.visible = viewMode === 'pano' && showProbes;
    }
  }, [viewMode, showProbes]);

  // Load HDR/EXR Asset
  useEffect(() => {
    if (!asset || !shaderMaterialRef.current) return;

    let isMounted = true;
    setLoading(true);
    setLoadError(null);

    loadHdrTexture(asset, () => {}, selectedLayer)
      .then((info) => {
        if (!isMounted) return;
        currentTextureRef.current = info.texture;
        setTextureInfo(info);
        if (info.selectedLayer && !selectedLayer) {
          setSelectedLayer(info.selectedLayer);
        }

        const defaultFlip = !!info.isHdr;
        setFlipVertical(defaultFlip);

        shaderMaterialRef.current.uniforms.uTexture.value = info.texture;
        shaderMaterialRef.current.uniforms.uAspect.value = info.width / info.height;
        shaderMaterialRef.current.uniforms.uFlipY.value = defaultFlip ? 1 : 0;
        shaderMaterialRef.current.needsUpdate = true;

        // Apply environment lighting for 360 reference probe balls
        if (sceneRef.current) {
          sceneRef.current.environment = info.texture;
        }
        if (probeSceneRef.current) {
          probeSceneRef.current.environment = info.texture;
        }

        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error loading HDR/EXR:', err);
        setLoadError(err.message || 'Failed to load HDR/EXR file.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [asset]);

  const [cachedLayerCount, setCachedLayerCount] = useState(0);

  // Track cached layers count
  useEffect(() => {
    if (!asset) return;
    setCachedLayerCount(getCachedLayerCount(asset.path));

    const onLayerCached = (e) => {
      if (e.detail?.filePath === asset.path) {
        setCachedLayerCount(e.detail.cachedCount || getCachedLayerCount(asset.path));
      }
    };

    window.addEventListener('exr-layer-cached', onLayerCached);
    return () => {
      window.removeEventListener('exr-layer-cached', onLayerCached);
    };
  }, [asset]);

  // Reset selected layer when asset changes
  useEffect(() => {
    setSelectedLayer(null);
  }, [asset]);

  // Change multi-pass / multi-layer EXR layer
  const handleLayerChange = async (newLayer) => {
    if (!asset || !newLayer || newLayer === selectedLayer) return;
    setSelectedLayer(newLayer);

    const isCached = isLayerCached(asset.path, newLayer);
    if (!isCached) {
      setLoading(true);
      // Yield to browser event loop so React renders the loading indicator immediately
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    try {
      const info = await loadHdrTexture(asset, () => {}, newLayer);
      currentTextureRef.current = info.texture;
      setTextureInfo(info);
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uTexture.value = info.texture;
        shaderMaterialRef.current.uniforms.uAspect.value = info.width / info.height;
        shaderMaterialRef.current.needsUpdate = true;
      }
      if (sceneRef.current) {
        sceneRef.current.environment = info.texture;
      }
      if (probeSceneRef.current) {
        probeSceneRef.current.environment = info.texture;
      }
    } catch (err) {
      console.error('Error switching EXR layer:', err);
    } finally {
      if (!isCached) {
        setLoading(false);
      }
    }
  };

  // Sync Flip Vertical Orientation
  useEffect(() => {
    if (shaderMaterialRef.current) {
      shaderMaterialRef.current.uniforms.uFlipY.value = flipVertical ? 1 : 0;
    }
  }, [flipVertical]);

  // Update Exposure & Tone Mapping
  useEffect(() => {
    if (!rendererRef.current || !shaderMaterialRef.current) return;

    const linearExposure = Math.pow(2, ev);
    shaderMaterialRef.current.uniforms.uExposure.value = linearExposure;

    let modeVal = 0;
    if (toneMapping === 'reinhard' || toneMapping === 'agx') modeVal = 1;
    else if (toneMapping === 'linear') modeVal = 2;
    else if (toneMapping === 'cineon') modeVal = 3;
    shaderMaterialRef.current.uniforms.uToneMapping.value = modeVal;

    if (toneMapping === 'aces') rendererRef.current.toneMapping = THREE.ACESFilmicToneMapping;
    else if (toneMapping === 'agx') rendererRef.current.toneMapping = THREE.AgXToneMapping;
    else if (toneMapping === 'reinhard') rendererRef.current.toneMapping = THREE.ReinhardToneMapping;
    else if (toneMapping === 'cineon') rendererRef.current.toneMapping = THREE.CineonToneMapping;
    else rendererRef.current.toneMapping = THREE.LinearToneMapping;

    rendererRef.current.toneMappingExposure = linearExposure;
  }, [ev, toneMapping]);

  // Update White Balance & Tint
  useEffect(() => {
    if (!shaderMaterialRef.current) return;
    const [wbR, wbG, wbB] = getWhiteBalanceMultiplier(kelvin);
    shaderMaterialRef.current.uniforms.uTempRgb.value.set(wbR, wbG, wbB);
    shaderMaterialRef.current.uniforms.uTint.value = tint / 100.0;
  }, [kelvin, tint]);

  // Update Split-Screen Wipe Uniforms
  useEffect(() => {
    if (!shaderMaterialRef.current) return;
    shaderMaterialRef.current.uniforms.uWipeActive.value = wipeActive ? 1 : 0;
    shaderMaterialRef.current.uniforms.uWipePos.value = wipePos;
    shaderMaterialRef.current.uniforms.uWipeMode.value = wipeMode;
  }, [wipeActive, wipePos, wipeMode]);

  // Update Channel Selection & False Color
  useEffect(() => {
    if (!shaderMaterialRef.current) return;
    const channelMap = { rgb: 0, r: 1, g: 2, b: 3, a: 4, lum: 5 };
    shaderMaterialRef.current.uniforms.uChannel.value = channelMap[channel] ?? 0;
    shaderMaterialRef.current.uniforms.uFalseColor.value = falseColor ? 1 : 0;
  }, [channel, falseColor]);

  // Real-Time Dynamic Range Luminance Histogram Computation & Drawing
  useEffect(() => {
    if (!textureInfo || !textureInfo.rawData || !histogramCanvasRef.current) return;

    const canvas = histogramCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rawData, width, height } = textureInfo;
    const totalPixels = width * height;
    const BINS = 128;
    const rBins = new Uint32Array(BINS);
    const gBins = new Uint32Array(BINS);
    const bBins = new Uint32Array(BINS);
    const lumBins = new Uint32Array(BINS);

    const step = Math.max(1, Math.floor(totalPixels / 40000)); // Sample ~40k pixels for instant <1ms computation
    const channels = (rawData.length === totalPixels * 4) ? 4 : 3;

    const [wbR, wbG, wbB] = getWhiteBalanceMultiplier(kelvin);
    const tintMult = 1.0 + (tint / 100.0);
    const exposure = Math.pow(2, ev);

    let blackClip = 0;
    let highlightClip = 0;
    let maxLum = 0.0;
    let samples = 0;

    for (let i = 0; i < totalPixels; i += step) {
      const idx = i * channels;
      const rRaw = rawData[idx] ?? 0;
      const gRaw = rawData[idx + 1] ?? 0;
      const bRaw = rawData[idx + 2] ?? 0;

      const r = Math.max(0, rRaw * wbR * exposure);
      const g = Math.max(0, gRaw * wbG * tintMult * exposure);
      const b = Math.max(0, bRaw * wbB * exposure);

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum > maxLum) maxLum = lum;

      if (lum < 0.001) blackClip++;
      if (lum >= 1.0) highlightClip++;

      // Gamma-compressed index to distribute bins across human visual range
      const rBin = Math.min(BINS - 1, Math.max(0, Math.floor(Math.pow(Math.min(1.0, r), 1 / 2.2) * (BINS - 1))));
      const gBin = Math.min(BINS - 1, Math.max(0, Math.floor(Math.pow(Math.min(1.0, g), 1 / 2.2) * (BINS - 1))));
      const bBin = Math.min(BINS - 1, Math.max(0, Math.floor(Math.pow(Math.min(1.0, b), 1 / 2.2) * (BINS - 1))));
      const lBin = Math.min(BINS - 1, Math.max(0, Math.floor(Math.pow(Math.min(1.0, lum), 1 / 2.2) * (BINS - 1))));

      rBins[rBin]++;
      gBins[gBin]++;
      bBins[bBin]++;
      lumBins[lBin]++;
      samples++;
    }

    // Determine max frequency for curve scaling (exclude pure 0 and max bins to prevent squash)
    let maxFreq = 1;
    for (let b = 1; b < BINS - 1; b++) {
      if (lumBins[b] > maxFreq) maxFreq = lumBins[b];
      if (rBins[b] > maxFreq) maxFreq = rBins[b];
      if (gBins[b] > maxFreq) maxFreq = gBins[b];
      if (bBins[b] > maxFreq) maxFreq = bBins[b];
    }

    setHistStats({
      headroomEv: maxLum > 1.0 ? `+${Math.log2(maxLum).toFixed(1)} EV` : '0.0 EV',
      maxLum: maxLum.toFixed(2),
      blackClipPct: samples > 0 ? ((blackClip / samples) * 100).toFixed(1) : '0.0',
      highlightClipPct: samples > 0 ? ((highlightClip / samples) * 100).toFixed(1) : '0.0'
    });

    // Draw Histogram onto Canvas
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Dark sleek background
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);

    // 18% Mid-Gray Reference Line (0.18^(1/2.2) ≈ 0.458 of width)
    const midGrayX = Math.round(w * Math.pow(0.18, 1 / 2.2));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(midGrayX, 0);
    ctx.lineTo(midGrayX, h);
    ctx.stroke();

    // 1.0 Highlight Clipping Line
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.beginPath();
    ctx.moveTo(w - 1, 0);
    ctx.lineTo(w - 1, h);
    ctx.stroke();

    const binWidth = w / BINS;

    const drawChannel = (bins, strokeColor, fillColor) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < BINS; i++) {
        const normY = Math.min(1.0, bins[i] / maxFreq);
        const y = h - normY * (h - 4);
        const x = i * binWidth;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // Red Channel curve
    drawChannel(rBins, 'rgba(239, 68, 68, 0.85)', 'rgba(239, 68, 68, 0.12)');
    // Green Channel curve
    drawChannel(gBins, 'rgba(34, 197, 94, 0.85)', 'rgba(34, 197, 94, 0.12)');
    // Blue Channel curve
    drawChannel(bBins, 'rgba(59, 130, 246, 0.85)', 'rgba(59, 130, 246, 0.12)');
    // Luminance curve
    drawChannel(lumBins, 'rgba(255, 255, 255, 0.95)', null);

    // Canvas labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '8px monospace';
    ctx.fillText('18%', midGrayX - 7, 9);
    ctx.fillText('0', 3, h - 3);
    ctx.fillText('1.0', w - 16, h - 3);
  }, [textureInfo, ev, kelvin, tint]);

  // Precision 32-bit Float Pixel Sampling Logic
  const samplePixelAtUv = useCallback((uv) => {
    if (!textureInfo || !textureInfo.rawData) return null;
    const { rawData, width, height } = textureInfo;
    const u = Math.max(0, Math.min(1, uv.x));
    const v = flipVertical ? (1.0 - uv.y) : uv.y;
    const vClamped = Math.max(0, Math.min(1, v));
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(vClamped * height)));
    const stride = (rawData.length === width * height * 4) ? 4 : 3;
    const idx = (py * width + px) * stride;

    const rLin = rawData[idx] ?? 0;
    const gLin = rawData[idx + 1] ?? 0;
    const bLin = rawData[idx + 2] ?? 0;
    const aLin = stride === 4 ? (rawData[idx + 3] ?? 1) : 1;

    // Apply White Balance & Tint
    const [wbR, wbG, wbB] = getWhiteBalanceMultiplier(kelvin);
    const tintMult = 1.0 + (tint / 100.0);
    const rWb = rLin * wbR;
    const gWb = gLin * wbG * tintMult;
    const bWb = bLin * wbB;

    // Apply Exposure
    const exposure = Math.pow(2, ev);
    const rExp = rWb * exposure;
    const gExp = gWb * exposure;
    const bExp = bWb * exposure;

    // Radiometric Luminance & IRE
    const lumLin = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    const lumExp = 0.2126 * rExp + 0.7152 * gExp + 0.0722 * bExp;
    const ire = Math.round(lumExp * 100);

    // ACES Filmic tonemapping for live hex swatch
    const tonemap = (val) => {
      const x = Math.max(0, val);
      const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      const mapped = Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
      return Math.round(Math.pow(mapped, 1 / 2.2) * 255);
    };

    const rByte = tonemap(rExp);
    const gByte = tonemap(gExp);
    const bByte = tonemap(bExp);
    const hex = `#${((1 << 24) + (rByte << 16) + (gByte << 8) + bByte).toString(16).slice(1).toUpperCase()}`;

    return {
      x: px,
      y: py,
      uPct: (u * 100).toFixed(1),
      vPct: (vClamped * 100).toFixed(1),
      rLin: rLin.toFixed(3),
      gLin: gLin.toFixed(3),
      bLin: bLin.toFixed(3),
      aLin: aLin.toFixed(3),
      rExp: rExp.toFixed(2),
      gExp: gExp.toFixed(2),
      bExp: bExp.toFixed(2),
      lumLin: lumLin.toFixed(3),
      lumExp: lumExp.toFixed(2),
      ire,
      hex,
      evFormatted: ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1)
    };
  }, [textureInfo, flipVertical, kelvin, tint, ev]);

  // Recalculate pinned probe if parameters change
  useEffect(() => {
    if (isProbePinned && pinnedUvRef.current) {
      const updated = samplePixelAtUv(pinnedUvRef.current);
      if (updated) setProbeData(updated);
    }
  }, [samplePixelAtUv, isProbePinned, ev, kelvin, tint]);

  // Pointer move probe detection
  const handlePointerMove = (e) => {
    if (isDraggingWipeRef.current) {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const pos = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
        setWipePos(pos);
      }
      return;
    }

    if (isProbePinned) return; // Locked probe point

    if (!containerRef.current || !rendererRef.current || !cameraRef.current || !meshRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
    const intersects = raycaster.intersectObject(meshRef.current);

    if (intersects.length > 0 && intersects[0].uv && currentTextureRef.current) {
      const data = samplePixelAtUv(intersects[0].uv);
      if (data) setProbeData(data);
    } else {
      if (!isProbePinned) setProbeData(null);
    }
  };

  // Canvas click to pin / unpin eyedropper probe
  const handleCanvasClick = (e) => {
    if (isDraggingWipeRef.current) return;
    if (e.target.closest('.viewport-hud') || e.target.closest('.hdr-controls-panel') || e.target.closest('.pixel-probe-hud') || e.target.closest('.hdr-inspector-sidebar')) {
      return;
    }

    if (!containerRef.current || !rendererRef.current || !cameraRef.current || !meshRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
    const intersects = raycaster.intersectObject(meshRef.current);

    if (intersects.length > 0 && intersects[0].uv) {
      pinnedUvRef.current = intersects[0].uv;
      const data = samplePixelAtUv(intersects[0].uv);
      if (data) setProbeData(data);
      setIsProbePinned(true);
    } else if (isProbePinned) {
      setIsProbePinned(false);
      pinnedUvRef.current = null;
    }
  };

  const handlePointerUp = () => {
    isDraggingWipeRef.current = false;
  };

  const copyProbeValues = async () => {
    if (!probeData) return;
    const text = `R: ${probeData.rLin}, G: ${probeData.gLin}, B: ${probeData.bLin} (Lum: ${probeData.lumLin}, Hex: ${probeData.hex})`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement('textarea');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 1500);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const handleFitView = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    if (viewMode === 'flat') {
      const aspect = textureInfo ? textureInfo.width / textureInfo.height : 2.0;
      const fovRad = (cameraRef.current.fov || 60) * (Math.PI / 180);
      const containerW = containerRef.current?.clientWidth || window.innerWidth;
      const containerH = containerRef.current?.clientHeight || window.innerHeight;
      const viewAspect = (containerW && containerH) ? containerW / containerH : 1.77;

      const planeH = 2.0;
      const planeW = 2.0 * aspect;

      const distH = (planeH / 2) / Math.tan(fovRad / 2);
      const distW = (planeW / 2) / (viewAspect * Math.tan(fovRad / 2));
      const fitDist = Math.max(distH, distW) * 1.08;

      cameraRef.current.position.set(0, 0, fitDist);
      cameraRef.current.rotation.set(0, 0, 0);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    } else {
      cameraRef.current.position.set(0, 0, 0.1);
      cameraRef.current.rotation.set(0, 0, 0);
      controlsRef.current.target.set(0, 0, -1);
      controlsRef.current.update();
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'Escape') {
        if (onClose) onClose();
      } else if (e.key === 'v' || e.key === 'V') {
        setFlipVertical((prev) => !prev);
      } else if (e.key === 'f' || e.key === 'F') {
        handleFitView();
      } else if (e.key === 'w' || e.key === 'W') {
        setWipeActive((prev) => !prev);
      } else if (e.key === 'p' || e.key === 'P') {
        setShowProbes((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, viewMode, textureInfo]);

  const captureSnapshot = async () => {
    if (!rendererRef.current) return;
    try {
      if (sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
      const baseName = asset?.name ? asset.name.replace(/\.[^/.]+$/, '') : 'hdri';
      const defaultFilename = `${baseName}_tonemapped.png`;

      if (window.electronAPI?.saveImageFileDialog) {
        const res = await window.electronAPI.saveImageFileDialog(defaultFilename, dataUrl);
        if (res && res.success) {
          setSnapshotFeedback(true);
          setTimeout(() => setSnapshotFeedback(false), 2000);
        }
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = defaultFilename;
        a.click();
        setSnapshotFeedback(true);
        setTimeout(() => setSnapshotFeedback(false), 2000);
      }
    } catch (err) {
      console.error('Failed to export tonemapped snapshot:', err);
    }
  };


  return (
    <div
      className="viewport-wrapper"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleCanvasClick}
    >
      <div ref={containerRef} className="canvas-container" />

      {/* Split-Screen Wipe Viewport Overlay Line & Handle */}
      {wipeActive && (
        <div
          className="wipe-overlay-divider"
          style={{ left: `${wipePos * 100}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            isDraggingWipeRef.current = true;
          }}
        >
          <div className="wipe-line" />
          <div className="wipe-handle" title="Drag to slide A/B comparison curtain">
            <Columns size={12} color="#000000" />
          </div>
        </div>
      )}

      {/* Split-Screen Wipe Comparison Badges */}
      {wipeActive && (
        <>
          <div className="wipe-badge-left">
            <span style={{ fontWeight: 700, color: '#ffffff' }}>A: TONEMAPPED</span>
            <span style={{ opacity: 0.7, fontSize: 10, textTransform: 'uppercase' }}>({toneMapping})</span>
          </div>
          <div className="wipe-badge-right">
            <span style={{ fontWeight: 700, color: '#ffffff' }}>
              B: {wipeMode === 1 ? 'FALSE COLOR' : 'RAW LINEAR'}
            </span>
            <span style={{ opacity: 0.7, fontSize: 10 }}>({wipeMode === 1 ? 'Heatmap' : 'Untoned'})</span>
          </div>
        </>
      )}

      {/* Floating Viewport HUD Toolbar */}
      <div className="viewport-hud">
        {/* Flat 2D vs 360 Panoramic Sphere */}
        <button
          className={`hud-btn ${viewMode === 'flat' ? 'active' : ''}`}
          onClick={() => setViewMode('flat')}
          title="Flat 2D Image View"
        >
          <Sliders size={14} />
          <span>Flat View</span>
        </button>
        <button
          className={`hud-btn ${viewMode === 'pano' ? 'active' : ''}`}
          onClick={() => setViewMode('pano')}
          title="360° Interactive Equirectangular Dome"
        >
          <Globe size={14} />
          <span>360° Skybox</span>
        </button>

        {viewMode === 'pano' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                (sphere sizes):
              </span>
              <select
                className="filter-btn"
                value={sphereSize}
                onChange={(e) => setSphereSize(e.target.value)}
                title="360 Skybox Preview Sphere Size in Meters"
                style={{
                  height: 28,
                  fontSize: 11,
                  padding: '0 8px',
                  color: '#ffffff',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 4
                }}
              >
                <option value="big_bada" style={{ color: '#000000', backgroundColor: '#ffffff' }}>big bada sphere = 300 meters</option>
                <option value="large" style={{ color: '#000000', backgroundColor: '#ffffff' }}>large = 150 meters</option>
                <option value="medium" style={{ color: '#000000', backgroundColor: '#ffffff' }}>medium = 80 meters</option>
                <option value="small" style={{ color: '#000000', backgroundColor: '#ffffff' }}>small = 60 meters</option>
              </select>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                ({SPHERE_SIZES[sphereSize]?.meters || 150}m)
              </span>
            </div>

            {/* 360 Studio Lighting Reference Spheres Toggle */}
            <button
              className={`hud-btn ${showProbes ? 'active' : ''}`}
              onClick={() => setShowProbes(!showProbes)}
              title="Toggle 360 Studio Lighting Reference Spheres (Chrome, 50% Gray, White Specular) [P]"
            >
              <Sparkles size={14} />
              <span>Studio Probes</span>
            </button>
          </>
        )}

        {/* Fit to View */}
        <button
          className="hud-btn"
          onClick={handleFitView}
          title={viewMode === 'flat' ? 'Fit Image to Window (F)' : 'Reset 360 View (F)'}
        >
          <Maximize2 size={14} />
          <span>Fit View</span>
        </button>

        {/* Flip Vertical Orientation */}
        <button
          className={`hud-btn ${flipVertical ? 'active' : ''}`}
          onClick={() => setFlipVertical((v) => !v)}
          title="Flip Vertical Orientation (Hot-key: V)"
        >
          <ArrowUpDown size={13} />
          <span>{flipVertical ? 'Flipped' : 'Flip V'}</span>
        </button>

        <div className="hud-divider" />

        {/* Quick Exposure Step in HUD */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <SunMedium size={13} color="#ffffff" />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 46, textAlign: 'center', color: '#ffffff' }}>
            {ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1)} EV
          </span>
          <button
            className="icon-btn"
            style={{ width: 18, height: 18, fontSize: 11, padding: 0 }}
            onClick={() => setEv((prev) => Math.round((prev - 1) * 10) / 10)}
            title="-1 EV"
          >
            -
          </button>
          <button
            className="icon-btn"
            style={{ width: 18, height: 18, fontSize: 11, padding: 0 }}
            onClick={() => setEv((prev) => Math.round((prev + 1) * 10) / 10)}
            title="+1 EV"
          >
            +
          </button>
          {ev !== 0 && (
            <button
              className="icon-btn"
              style={{ width: 18, height: 18, fontSize: 9, padding: 0 }}
              onClick={() => setEv(0.0)}
              title="Reset EV to 0"
            >
              0
            </button>
          )}
        </div>

        <div className="hud-divider" />

        {/* Split-Screen Wipe Toggle */}
        <button
          className={`hud-btn ${wipeActive ? 'active' : ''}`}
          onClick={() => setWipeActive(!wipeActive)}
          title="Split-Screen Wipe / Curtain Comparison [W]"
        >
          <Columns size={14} />
          <span>A/B Wipe</span>
        </button>

        {/* False Color Heatmap */}
        <button
          className={`hud-btn ${falseColor ? 'active' : ''}`}
          onClick={() => setFalseColor(!falseColor)}
          title="Dynamic Range / False Color Heatmap"
        >
          <Eye size={14} />
          <span>False Color</span>
        </button>

        <div className="hud-divider" />

        {/* Snapshot */}
        <button
          className={`hud-btn ${snapshotFeedback ? 'active' : ''}`}
          onClick={captureSnapshot}
          title="Export Tonemapped PNG"
        >
          {snapshotFeedback ? <Check size={14} color="#22c55e" /> : <Camera size={14} />}
          <span>{snapshotFeedback ? 'Saved!' : 'Export PNG'}</span>
        </button>

        {onRevealInExplorer && (
          <button
            className="hud-btn"
            onClick={() => onRevealInExplorer(asset.path)}
            title="Reveal in Windows Explorer"
          >
            <ExternalLink size={13} />
            <span>Explorer</span>
          </button>
        )}

        {onClose && (
          <button className="hud-btn" onClick={onClose} style={{ marginLeft: 6 }}>
            ✕
          </button>
        )}
      </div>

      {/* HDR / EXR Studio Inspector Floating Right Sidebar */}
      <div className="hdr-inspector-sidebar">
        <div className="hdr-controls-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
              <SunMedium size={16} color="#ffffff" />
              <span>HDR / EXR STUDIO</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {textureInfo?.format || asset.extension}
            </span>
          </div>

          {/* 1. Real-Time Dynamic Range Luminance Histogram */}
          <div className="hdr-histogram-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>
                <BarChart3 size={12} color="#ffffff" />
                <span>DYNAMIC RANGE HISTOGRAM</span>
              </div>
              <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#22c55e', fontWeight: 600 }}>
                {histStats.headroomEv} HDR
              </span>
            </div>

            <div style={{ position: 'relative' }}>
              <canvas
                ref={histogramCanvasRef}
                width={260}
                height={64}
                className="hdr-histogram-canvas"
              />
            </div>

            <div className="hdr-histogram-stats">
              <span title="Pure black clipping (< 0.001)">
                Black: <strong style={{ color: Number(histStats.blackClipPct) > 5 ? '#ef4444' : '#ffffff' }}>{histStats.blackClipPct}%</strong>
              </span>
              <span title="18% Photography Mid-Gray Standard">
                Mid: <strong style={{ color: '#ffffff' }}>18%</strong>
              </span>
              <span title="Standard LDR Highlight Clipping (> 1.0)">
                Clip: <strong style={{ color: Number(histStats.highlightClipPct) > 5 ? '#ef4444' : '#ffffff' }}>{histStats.highlightClipPct}%</strong>
              </span>
              <span title="Peak Luminance Value">
                Peak: <strong style={{ color: '#ffffff' }}>{histStats.maxLum}</strong>
              </span>
            </div>
          </div>

          {/* 2. Render Pass / AOV Selector */}
          <div className="control-group">
            <div className="control-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Render Pass / AOV
                {loading && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                {textureInfo?.availableLayers && textureInfo.availableLayers.length > 1
                  ? (cachedLayerCount >= textureInfo.availableLayers.length
                      ? <span style={{ color: '#10b981', fontWeight: 600 }}>✓ All {textureInfo.availableLayers.length} Instant</span>
                      : `${cachedLayerCount}/${textureInfo.availableLayers.length} Passes Ready`)
                  : (textureInfo?.pixelType || '32-bit Float')}
              </span>
            </div>

            {/* Collapsed Passes Dropdown (e.g. Combined, Mist, Normal, Depth, etc.) */}
            {textureInfo?.availableLayers && textureInfo.availableLayers.length > 1 ? (
              <select
                className="filter-btn"
                disabled={loading && !isLayerCached(asset?.path, selectedLayer)}
                value={selectedLayer || textureInfo.selectedLayer || ''}
                onChange={(e) => handleLayerChange(e.target.value)}
                style={{
                  width: '100%',
                  height: 28,
                  color: '#ffffff',
                  background: 'var(--bg-tertiary)',
                  fontSize: 11,
                  opacity: (loading && !isLayerCached(asset?.path, selectedLayer)) ? 0.6 : 1,
                  cursor: 'pointer'
                }}
              >
                {textureInfo.availableLayers.map((l) => {
                  let label = l;
                  const dot = l.lastIndexOf('.');
                  if (dot !== -1) {
                    label = l.substring(dot + 1);
                  }
                  if (/combined/i.test(label) || /beauty/i.test(label)) {
                    label = `${label} (Beauty / RGB)`;
                  }
                  const cached = isLayerCached(asset?.path, l);
                  return (
                    <option key={l} value={l} style={{ color: '#000000', backgroundColor: '#ffffff' }}>
                      {cached ? `⚡ ${label}` : label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  padding: '6px 8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)'
                }}
              >
                {textureInfo?.isHdr ? 'Radiance HDR (Combined RGB)' : 'Beauty / Combined (Full Render)'}
              </div>
            )}

            {/* Below Options Controlling Each Pass: RGB, R, G, B, A, LUM */}
            <div className="channel-btn-group" style={{ marginTop: 6 }}>
              {['rgb', 'r', 'g', 'b', 'a', 'lum'].map((ch) => (
                <button
                  key={ch}
                  className={`channel-btn ${channel === ch ? 'active' : ''}`}
                  onClick={() => setChannel(ch)}
                  title={`Isolate ${ch.toUpperCase()} channel of active pass`}
                >
                  {ch.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

        {/* 3. Exposure EV Slider & Direct Number Input */}
        <div className="control-group">
          <div className="control-label">
            <span>Exposure (EV)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                step="0.5"
                min="-60"
                max="60"
                value={Number.isFinite(ev) ? ev : 0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setEv(isNaN(val) ? 0 : Math.max(-60, Math.min(60, val)));
                }}
                style={{
                  width: 58,
                  height: 22,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 3,
                  color: '#ffffff',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'right',
                  paddingRight: 4
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#888888' }}>EV</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              className="range-slider"
              min="-24.0"
              max="24.0"
              step="0.1"
              value={Math.max(-24, Math.min(24, ev))}
              onChange={(e) => setEv(parseFloat(e.target.value))}
            />
            <button
              className="icon-btn"
              style={{ width: 26, height: 26, flexShrink: 0 }}
              onClick={() => setEv(0.0)}
              title="Reset Exposure to 0 EV"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          {/* Quick EV Presets */}
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {[-8, -4, -2, -1, 0, 1, 2, 4, 8, 12].map((preset) => (
              <button
                key={preset}
                className="filter-btn"
                style={{
                  flex: 1,
                  padding: '2px 0',
                  fontSize: 9,
                  textAlign: 'center',
                  background: ev === preset ? '#ffffff' : 'var(--bg-tertiary)',
                  color: ev === preset ? '#000000' : 'var(--text-main)',
                  fontWeight: ev === preset ? 700 : 400
                }}
                onClick={() => setEv(preset)}
                title={`Set exposure to ${preset > 0 ? `+${preset}` : preset} EV`}
              >
                {preset > 0 ? `+${preset}` : preset}
              </button>
            ))}
          </div>
        </div>

        {/* 4. White Balance & Tint Sliders */}
        <div className="control-group">
          <div className="control-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Thermometer size={12} color="#ffffff" />
              <span>White Balance</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ffffff' }}>
              {kelvin}K {tint !== 0 ? `(${tint > 0 ? `+${tint}` : tint} Tint)` : ''}
            </span>
          </div>

          {/* Kelvin Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9.5, color: '#ff9d42', fontFamily: 'var(--font-mono)', width: 34 }}>2000K</span>
            <input
              type="range"
              className="kelvin-slider"
              min="2000"
              max="10000"
              step="50"
              value={kelvin}
              onChange={(e) => setKelvin(parseInt(e.target.value, 10))}
            />
            <span style={{ fontSize: 9.5, color: '#a0c4ff', fontFamily: 'var(--font-mono)', width: 40, textAlign: 'right' }}>10000K</span>
            <button
              className="icon-btn"
              style={{ width: 22, height: 22, flexShrink: 0 }}
              onClick={() => { setKelvin(6500); setTint(0); }}
              title="Reset White Balance to 6500K / 0 Tint"
            >
              <RotateCcw size={11} />
            </button>
          </div>

          {/* Green / Magenta Tint Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 9.5, color: '#e879f9', fontFamily: 'var(--font-mono)', width: 34 }}>-50 M</span>
            <input
              type="range"
              className="tint-slider"
              min="-50"
              max="50"
              step="1"
              value={tint}
              onChange={(e) => setTint(parseInt(e.target.value, 10))}
            />
            <span style={{ fontSize: 9.5, color: '#4ade80', fontFamily: 'var(--font-mono)', width: 40, textAlign: 'right' }}>+50 G</span>
          </div>

          {/* White Balance Presets */}
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {[
              { k: 3200, label: '3200K Tung' },
              { k: 4500, label: '4500K Fluor' },
              { k: 5500, label: '5500K Sun' },
              { k: 6500, label: '6500K D65' },
              { k: 7500, label: '7500K Shade' }
            ].map((p) => (
              <button
                key={p.k}
                className="filter-btn"
                style={{
                  flex: 1,
                  padding: '2px 0',
                  fontSize: 8.5,
                  textAlign: 'center',
                  background: kelvin === p.k ? '#ffffff' : 'var(--bg-tertiary)',
                  color: kelvin === p.k ? '#000000' : 'var(--text-main)',
                  fontWeight: kelvin === p.k ? 700 : 400
                }}
                onClick={() => setKelvin(p.k)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 5. Tone Mapping Operator */}
        <div className="control-group">
          <div className="control-label">
            <span>Tone Mapping</span>
          </div>
          <select
            className="filter-btn"
            value={toneMapping}
            onChange={(e) => setToneMapping(e.target.value)}
            style={{ width: '100%', height: 30, color: 'var(--text-main)', background: 'var(--bg-tertiary)' }}
          >
            <option value="aces" style={{ color: '#000000', backgroundColor: '#ffffff' }}>ACES Filmic (VFX Standard)</option>
            <option value="agx" style={{ color: '#000000', backgroundColor: '#ffffff' }}>AgX (Blender 4/5 Standard)</option>
            <option value="reinhard" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Reinhard (Smooth Highlight)</option>
            <option value="cineon" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Cineon Film Response</option>
            <option value="linear" style={{ color: '#000000', backgroundColor: '#ffffff' }}>Linear (Raw Un-mapped)</option>
          </select>
        </div>

        {/* 6. Split-Screen Wipe Controls */}
        <div className="control-group">
          <div className="control-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Columns size={12} color="#ffffff" />
              <span>A/B Curtain Wipe</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: wipeActive ? '#ffffff' : '#888888' }}>
              {wipeActive ? `${Math.round(wipePos * 100)}% Split` : 'Off'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`filter-btn ${wipeActive ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '5px 0',
                fontSize: 10.5,
                background: wipeActive ? '#ffffff' : 'var(--bg-tertiary)',
                color: wipeActive ? '#000000' : 'var(--text-main)',
                fontWeight: wipeActive ? 700 : 400
              }}
              onClick={() => setWipeActive(!wipeActive)}
            >
              {wipeActive ? 'Wipe Active' : 'Enable Wipe'}
            </button>
            {wipeActive && (
              <select
                className="filter-btn"
                value={wipeMode}
                onChange={(e) => setWipeMode(parseInt(e.target.value, 10))}
                style={{ flex: 1.5, height: 28, fontSize: 10.5, background: 'var(--bg-tertiary)', color: '#ffffff' }}
              >
                <option value={0} style={{ color: '#000', backgroundColor: '#fff' }}>vs Raw Linear</option>
                <option value={1} style={{ color: '#000', backgroundColor: '#fff' }}>vs False Color</option>
              </select>
            )}
          </div>
        </div>

        {/* File Specs & EXR Header */}
        {textureInfo && (
          <div
            style={{
              background: 'var(--bg-tertiary)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Dimensions:</span>
              <span style={{ color: 'var(--text-main)' }}>
                {textureInfo.width} × {textureInfo.height}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Channels:</span>
              <span style={{ color: 'var(--text-main)' }}>
                {textureInfo.channels?.join(', ') || 'RGBA'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Compression:</span>
              <span style={{ color: 'var(--text-main)' }}>
                {textureInfo.compression || (textureInfo.isHdr ? 'RLE RGBE' : 'None')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Orientation:</span>
              <span style={{ color: flipVertical ? '#ffffff' : 'var(--text-main)' }}>
                {flipVertical ? 'Flipped (V)' : 'Standard'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Precision 32-bit Float Pixel Eyedropper Card - Attached right under Inspector */}
      {probeData && (
        <div className="pixel-probe-hud">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--text-main)' }}>
              <Pipette size={13} color="#ffffff" />
              <span>32-BIT COLOR PROBE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20, padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsProbePinned(!isProbePinned);
                }}
                title={isProbePinned ? 'Unpin Eyedropper' : 'Pin Eyedropper'}
              >
                {isProbePinned ? <Lock size={11} color="#ffffff" /> : <Unlock size={11} color="#888888" />}
              </button>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20, padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  copyProbeValues();
                }}
                title="Copy Linear Values to Clipboard"
              >
                {copiedFeedback ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
              </button>
            </div>
          </div>

          {/* Color swatch & Hex */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                backgroundColor: probeData.hex,
                border: '1px solid rgba(255, 255, 255, 0.25)',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffffff' }}>
                {probeData.hex}
              </span>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                {probeData.x} × {probeData.y} px ({probeData.uPct}%, {probeData.vPct}%)
              </span>
            </div>
          </div>

          {/* Linear 32-bit Radiometric Float values */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 4, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Radiometric Linear Float (Raw 32-bit):
            </div>
            <div style={{ display: 'flex', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <span style={{ color: '#ef4444' }}>R: {probeData.rLin}</span>
              <span style={{ color: '#22c55e' }}>G: {probeData.gLin}</span>
              <span style={{ color: '#3b82f6' }}>B: {probeData.bLin}</span>
            </div>
          </div>

          {/* Exposed Values */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>
            <span>Exposed ({probeData.evFormatted} EV):</span>
            <span style={{ color: '#ffffff' }}>
              {probeData.rExp}, {probeData.gExp}, {probeData.bExp}
            </span>
          </div>

          {/* Luminance & IRE Rating */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Luminance / IRE:</span>
            <span style={{ color: probeData.ire > 100 ? '#eab308' : '#ffffff', fontWeight: 600 }}>
              {probeData.lumLin} ({probeData.ire}% IRE)
            </span>
          </div>

          <div style={{ fontSize: 8.5, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
            {isProbePinned ? '● Pinned (Click image to move/unpin)' : 'Hover to sample • Click to pin'}
          </div>
        </div>
      )}
    </div>

      {/* 360 Studio Lighting Reference Spheres Legend (in 360 mode) */}
      {viewMode === 'pano' && showProbes && (
        <div className="lighting-probe-legend">
          <div style={{ fontWeight: 700, fontSize: 11, color: '#ffffff', marginBottom: 2 }}>
            360° STUDIO PROBES
          </div>
          <div className="probe-legend-item">
            <span className="probe-legend-dot chrome" />
            <span>Chrome: Specular & Light Positions</span>
          </div>
          <div className="probe-legend-item">
            <span className="probe-legend-dot gray" />
            <span>50% Gray: Diffuse Wrap & Shadows</span>
          </div>
          <div className="probe-legend-item">
            <span className="probe-legend-dot white" />
            <span>White: Highlight Roll-off</span>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div style={{ fontSize: 14, fontWeight: 500 }}>Decoding {asset.name}...</div>
        </div>
      )}

      {/* Error */}
      {loadError && (
        <div className="loading-overlay">
          <div style={{ color: '#ef4444', fontSize: 16, fontWeight: 600 }}>Failed to Load HDR/EXR</div>
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
