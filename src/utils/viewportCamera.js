import * as THREE from 'three';
import { focusCameraOnModel } from './assetLoader';

// Camera rig for the 3D viewport: one perspective and one orthographic camera that
// share a position and target. Every viewport camera change goes through here, and
// getViewState / applyViewState give other features (for example synced compare) a
// small, serializable way to read and drive the view.

export const DEFAULT_FOV = 45;
// Lens presets use a 24 mm film height so they do not depend on the window shape.
const FILM_HEIGHT_MM = 24;

export const focalLengthToFov = (mm) =>
  (2 * Math.atan(FILM_HEIGHT_MM / 2 / mm) * 180) / Math.PI;

// id 'ortho' is the orthographic projection; every other id is a perspective lens.
export const CAMERA_MODES = [
  { id: 'default', label: 'Persp 45°', fov: DEFAULT_FOV },
  { id: '18mm', label: '18 mm', fov: focalLengthToFov(18) },
  { id: '35mm', label: '35 mm', fov: focalLengthToFov(35) },
  { id: '50mm', label: '50 mm', fov: focalLengthToFov(50) },
  { id: '85mm', label: '85 mm', fov: focalLengthToFov(85) },
  { id: '200mm', label: '200 mm', fov: focalLengthToFov(200) },
  { id: 'ortho', label: 'Ortho', fov: null }
];

// Blender-style axes: Front looks from +Z, Right from +X, Top from +Y.
export const VIEW_DIRECTIONS = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0)
};

const tanHalf = (fovDeg) => Math.tan((fovDeg * Math.PI) / 360);

export function createCameraRig(width, height) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const persp = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.1, 1000);
  const ortho = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 1000);
  return { persp, ortho, active: persp };
}

export const isOrtho = (rig) => rig.active === rig.ortho;

function setClip(camera, distance) {
  camera.near = Math.max(0.001, distance * 0.01);
  camera.far = Math.max(1000, distance * 100);
  camera.updateProjectionMatrix();
}

function setOrthoExtent(rig, halfHeight, aspect) {
  const o = rig.ortho;
  o.top = halfHeight;
  o.bottom = -halfHeight;
  o.left = -halfHeight * aspect;
  o.right = halfHeight * aspect;
  o.zoom = 1;
}

// OrbitControls keeps damping leftovers; apply them before a programmatic move so
// they do not shove the new view a moment later.
function flushControls(controls) {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}

export function resizeRig(rig, width, height) {
  if (!(width > 0 && height > 0)) return;
  const aspect = width / height;
  rig.persp.aspect = aspect;
  rig.persp.updateProjectionMatrix();
  const halfHeight = rig.ortho.top;
  rig.ortho.left = -halfHeight * aspect;
  rig.ortho.right = halfHeight * aspect;
  rig.ortho.updateProjectionMatrix();
}

function activateOrtho(rig, controls) {
  const { persp, ortho } = rig;
  const distance = persp.position.distanceTo(controls.target);
  ortho.position.copy(persp.position);
  ortho.quaternion.copy(persp.quaternion);
  setOrthoExtent(rig, distance * tanHalf(persp.fov), persp.aspect);
  setClip(ortho, distance);
  rig.active = ortho;
  controls.object = ortho;
}

function activatePersp(rig, controls) {
  const { persp, ortho } = rig;
  const visibleHalfHeight = ortho.top / ortho.zoom;
  const distance = visibleHalfHeight / tanHalf(persp.fov);
  const dir = ortho.position.clone().sub(controls.target).normalize();
  persp.position.copy(controls.target).addScaledVector(dir, distance);
  persp.quaternion.copy(ortho.quaternion);
  setClip(persp, distance);
  rig.active = persp;
  controls.object = persp;
}

// Switch to a lens preset or to orthographic. Changing the lens dollies the camera
// so the model keeps the same size on screen and only the perspective changes.
export function setCameraMode(rig, controls, modeId) {
  const mode = CAMERA_MODES.find((m) => m.id === modeId);
  if (!mode) return;
  flushControls(controls);

  if (mode.id === 'ortho') {
    if (!isOrtho(rig)) activateOrtho(rig, controls);
  } else {
    const { persp } = rig;
    if (isOrtho(rig)) {
      persp.fov = mode.fov;
      activatePersp(rig, controls);
    } else {
      const distance = persp.position.distanceTo(controls.target);
      const dir = persp.position.clone().sub(controls.target).normalize();
      const newDistance = (distance * tanHalf(persp.fov)) / tanHalf(mode.fov);
      persp.fov = mode.fov;
      persp.position.copy(controls.target).addScaledVector(dir, newDistance);
      setClip(persp, newDistance);
    }
  }
  controls.update();
}

// Snap the camera to Front / Back / Left / Right / Top, keeping target and distance.
export function snapCameraView(rig, controls, viewName) {
  const dir = VIEW_DIRECTIONS[viewName];
  if (!dir) return;
  flushControls(controls);
  const camera = rig.active;
  const distance = camera.position.distanceTo(controls.target);
  camera.position.copy(controls.target).addScaledVector(dir, distance);
  controls.update();
}

// Frame the whole model, in whichever projection is active.
export function frameModel(rig, controls, object3D) {
  if (!object3D) return;
  flushControls(controls);
  const wasOrtho = isOrtho(rig);
  if (wasOrtho) activatePersp(rig, controls);
  focusCameraOnModel(rig.persp, controls, object3D);
  if (wasOrtho) {
    activateOrtho(rig, controls);
    controls.update();
  }
}

export function getViewState(rig, controls) {
  const camera = rig.active;
  const ortho = isOrtho(rig);
  const distance = camera.position.distanceTo(controls.target);
  return {
    projection: ortho ? 'orthographic' : 'perspective',
    fov: rig.persp.fov,
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    // Visible height in world units at the target, comparable across both projections
    viewHeight: ortho
      ? (rig.ortho.top - rig.ortho.bottom) / rig.ortho.zoom
      : 2 * distance * tanHalf(rig.persp.fov)
  };
}

export function applyViewState(rig, controls, state) {
  if (!state) return;
  flushControls(controls);
  controls.target.fromArray(state.target);
  if (Number.isFinite(state.fov)) rig.persp.fov = state.fov;

  if (state.projection === 'orthographic') {
    if (!isOrtho(rig)) {
      rig.active = rig.ortho;
      controls.object = rig.ortho;
    }
    setOrthoExtent(rig, state.viewHeight / 2, rig.persp.aspect);
  } else if (isOrtho(rig)) {
    rig.active = rig.persp;
    controls.object = rig.persp;
  }

  const camera = rig.active;
  camera.position.fromArray(state.position);
  setClip(camera, camera.position.distanceTo(controls.target));
  controls.update();
}

// Id of the lens preset matching a field of view, or 'custom' when none does.
export function cameraModeForFov(fov) {
  const hit = CAMERA_MODES.find((m) => m.fov !== null && Math.abs(m.fov - fov) < 0.01);
  return hit ? hit.id : 'custom';
}
