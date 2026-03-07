/**
 * WebAR Viewer – main.js
 * Three.js + WebXR Device API (immersive-ar + hit-test)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─── DOM Elements ──────────────────────────────────────────
const fileInput       = document.getElementById('file-input');
const uploadZone      = document.getElementById('upload-zone');
const arBtn           = document.getElementById('ar-btn');
const arNote          = document.getElementById('ar-note');
const modelInfo       = document.getElementById('model-info');
const modelName       = document.getElementById('model-name');
const modelSize       = document.getElementById('model-size');
const arCanvas        = document.getElementById('ar-canvas');
const arHud           = document.getElementById('ar-hud');
const landingScreen   = document.getElementById('landing-screen');
const uiOverlay       = document.getElementById('ui-overlay');
const exitArBtn       = document.getElementById('exit-ar-btn');
const resetBtn        = document.getElementById('reset-btn');
const hudDot          = document.querySelector('.hud-dot');
const hudStatusText   = document.getElementById('hud-status-text');
const hintText        = document.getElementById('hint-text');
const tapLabel        = document.getElementById('tap-label');
const loadingOverlay  = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');
const errorToast      = document.getElementById('error-toast');
const errorMessage    = document.getElementById('error-message');

// ─── State ─────────────────────────────────────────────────
let loadedGLTF       = null;   // loaded Three.js object
let xrSession        = null;
let xrRefSpace       = null;
let xrHitTestSource  = null;
let renderer         = null;
let scene            = null;
let camera           = null;
let reticle          = null;
let placedModels     = [];
let hitTestAvailable = false;

// ─── Utilities ─────────────────────────────────────────────
function showError(msg) {
  errorMessage.textContent = msg;
  errorToast.hidden = false;
  errorToast.classList.add('show');
  setTimeout(() => {
    errorToast.classList.remove('show');
    setTimeout(() => { errorToast.hidden = true; }, 400);
  }, 4000);
}

function showLoading(text = 'モデルを読み込んでいます...') {
  loadingText.textContent = text;
  loadingOverlay.hidden = false;
}

function hideLoading() {
  loadingOverlay.hidden = true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ─── Drag & Drop ───────────────────────────────────────────
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadGLBFile(file);
});

uploadZone.addEventListener('click', (e) => {
  if (e.target !== document.getElementById('file-btn') &&
      !document.getElementById('file-btn').contains(e.target)) {
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadGLBFile(file);
  fileInput.value = '';   // reset so same file can be re-selected
});

// ─── GLB Loading ───────────────────────────────────────────
function loadGLBFile(file) {
  if (!file.name.match(/\.(glb|gltf)$/i)) {
    showError('GLB または GLTF ファイルを選択してください');
    return;
  }

  showLoading('モデルを読み込み中...');
  arBtn.disabled = true;

  const url = URL.createObjectURL(file);
  const loader = new GLTFLoader();

  loader.load(
    url,
    (gltf) => {
      // Dispose previous model if any
      if (loadedGLTF) {
        loadedGLTF.scene.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => m.dispose());
          }
        });
      }

      loadedGLTF = gltf;
      URL.revokeObjectURL(url);

      // Normalize model scale/position
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 0.4 / maxDim; // Fit into ~40cm
        gltf.scene.scale.setScalar(scale);
      }
      const center = box.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center.multiplyScalar(gltf.scene.scale.x));

      // Update UI
      modelName.textContent = file.name;
      modelSize.textContent = formatBytes(file.size);
      modelInfo.hidden = false;
      arBtn.disabled = false;
      arNote.textContent = 'ARカメラを起動してモデルを設置しましょう';
      hideLoading();
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        loadingText.textContent = `読み込み中... ${pct}%`;
      }
    },
    (err) => {
      URL.revokeObjectURL(url);
      hideLoading();
      showError('ファイルの読み込みに失敗しました: ' + (err.message || '不明なエラー'));
      console.error(err);
    }
  );
}

// ─── Three.js Setup ────────────────────────────────────────
function initThreeJS() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

  renderer = new THREE.WebGLRenderer({
    canvas: arCanvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x000000, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);

  // Reticle (hit-test indicator)
  reticle = createReticle();
  reticle.visible = false;
  scene.add(reticle);
}

function createReticle() {
  const group = new THREE.Group();

  // Outer ring
  const outerGeo = new THREE.RingGeometry(0.12, 0.14, 36);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x6366f1,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = -Math.PI / 2;
  group.add(outer);

  // Inner dot
  const innerGeo = new THREE.CircleGeometry(0.03, 24);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.001;
  group.add(inner);

  return group;
}

// ─── AR Session ────────────────────────────────────────────
arBtn.addEventListener('click', startAR);
exitArBtn.addEventListener('click', endAR);
resetBtn.addEventListener('click', clearPlacedModels);

async function startAR() {
  if (!navigator.xr) {
    showError('このブラウザはWebXRに対応していません（Chrome for Android を推奨）');
    return;
  }

  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    showError('このデバイスはARセッションに対応していません');
    return;
  }

  try {
    initThreeJS();

    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'light-estimation'],
      domOverlay: { root: document.body },
    });

    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(xrSession);

    xrRefSpace = await xrSession.requestReferenceSpace('viewer');
    xrHitTestSource = await xrSession.requestHitTestSource({ space: xrRefSpace });
    hitTestAvailable = true;

    xrSession.addEventListener('end', onARSessionEnd);
    arCanvas.addEventListener('click', onArTap);

    // UI
    landingScreen.classList.remove('active');
    arCanvas.style.display = 'block';
    arHud.hidden = false;

    // Start render loop
    renderer.setAnimationLoop(onXRFrame);

  } catch (err) {
    hideLoading();
    showError('ARの起動に失敗しました: ' + (err.message || String(err)));
    console.error(err);
    cleanupXR();
  }
}

function endAR() {
  if (xrSession) {
    xrSession.end();
  }
}

function onARSessionEnd() {
  cleanupXR();
  // Restore UI
  arCanvas.style.display = 'none';
  arHud.hidden = true;
  landingScreen.classList.add('active');
  reticle.visible = false;
  hudDot.className = 'hud-dot scanning';
  hudStatusText.textContent = '平面を探しています...';
  hintText.textContent = 'カメラを床や机に向けてください';
  tapLabel.hidden = true;
  hitTestAvailable = false;
}

function cleanupXR() {
  if (renderer) renderer.setAnimationLoop(null);
  xrHitTestSource = null;
  xrRefSpace = null;
  xrSession = null;
  placedModels = [];
  if (scene) {
    // Keep lights/reticle; remove placed clones
    scene.children
      .filter(c => c.userData.isPlaced)
      .forEach(c => scene.remove(c));
  }
  arCanvas.removeEventListener('click', onArTap);
}

function clearPlacedModels() {
  if (scene) {
    const toRemove = scene.children.filter(c => c.userData.isPlaced);
    toRemove.forEach(c => {
      c.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.dispose());
        }
      });
      scene.remove(c);
    });
    placedModels = [];
  }
}

// ─── Tap to Place ──────────────────────────────────────────
function onArTap() {
  if (!loadedGLTF || !reticle.visible) return;

  const clone = loadedGLTF.scene.clone(true);
  clone.userData.isPlaced = true;
  clone.position.setFromMatrixPosition(reticle.matrix);
  clone.quaternion.setFromRotationMatrix(reticle.matrix);
  scene.add(clone);
  placedModels.push(clone);

  // Brief visual flash
  reticle.visible = false;
  setTimeout(() => { reticle.visible = true; }, 150);
}

// ─── XR Render Loop ────────────────────────────────────────
let frameCount = 0;

function onXRFrame(timestamp, frame) {
  if (!frame) return;

  frameCount++;
  const session = frame.session;

  if (hitTestAvailable && xrHitTestSource) {
    const hitTestResults = frame.getHitTestResults(xrHitTestSource);

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const refSpace = renderer.xr.getReferenceSpace();
      const pose = hit.getPose(refSpace);

      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        reticle.matrix.decompose(reticle.position, reticle.quaternion, reticle.scale);

        // Animate reticle
        reticle.children.forEach((child, i) => {
          child.material.opacity = 0.7 + 0.3 * Math.sin(frameCount * 0.05 + i);
        });

        // Update HUD
        hudDot.className = 'hud-dot found';
        hudStatusText.textContent = '平面を検出しました';
        hintText.textContent = `${placedModels.length > 0 ? 'タップして追加配置' : 'タップしてモデルを配置'}`;
        tapLabel.hidden = false;
      }
    } else {
      reticle.visible = false;
      hudDot.className = 'hud-dot scanning';
      hudStatusText.textContent = '平面を探しています...';
      hintText.textContent = 'カメラをゆっくり動かしてください';
      tapLabel.hidden = true;
    }
  }

  renderer.render(scene, camera);
}

// ─── Resize handler ───────────────────────────────────────
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (camera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
});

// ─── WebXR not available – desktop fallback notice ────────
window.addEventListener('DOMContentLoaded', () => {
  if (!navigator.xr) {
    arNote.textContent = '⚠ このブラウザはWebXR非対応です（Android Chrome推奨）';
    arNote.style.color = '#f59e0b';
  }
});
