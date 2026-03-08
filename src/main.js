/**
 * Magic Hand – main.js
 * インカメラ + MediaPipe Hands でジェスチャーを検知し、
 * Three.js でGLBモデルをオーバーレイ表示する。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─── DOM ───────────────────────────────────────────────────
const fileInput      = document.getElementById('file-input');
const uploadZone     = document.getElementById('upload-zone');
const startBtn       = document.getElementById('start-btn');
const arNote         = document.getElementById('ar-note');
const modelInfo      = document.getElementById('model-info');
const modelNameEl    = document.getElementById('model-name');
const modelSizeEl    = document.getElementById('model-size');
const landingScreen  = document.getElementById('landing-screen');
const arView         = document.getElementById('ar-view');
const cameraVideo    = document.getElementById('camera-video');
const threeCanvas    = document.getElementById('three-canvas');
const handCanvas     = document.getElementById('hand-canvas');
const hudDot         = document.getElementById('hud-dot');
const hudText        = document.getElementById('hud-text');
const hintText       = document.getElementById('hint-text');
const exitBtn        = document.getElementById('exit-btn');
const gestureFeedback= document.getElementById('gesture-feedback');
const feedbackEmoji  = document.getElementById('feedback-emoji');
const feedbackLabel  = document.getElementById('feedback-label');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText    = document.getElementById('loading-text');
const errorToast     = document.getElementById('error-toast');
const errorMsg       = document.getElementById('error-message');

// ─── State ─────────────────────────────────────────────────
let loadedGLTF    = null;
let mediaCamera   = null;
let mpHands       = null;
let stream        = null;
let isRunning     = false;

// Three.js
let renderer3     = null;
let scene3        = null;
let camera3       = null;
let modelGroup    = null;
let particles     = null;

// Gesture state
const BASE_MODEL_SIZE = 0.35;  // slightly bigger so it's easily visible
let   modelVisible= false;
let   exploded    = false;

// Pinch tracking
let   prevPinchDist = null;
let   pinchScale    = 1.0;

// Fist tracking
let   wasFist       = false;

// Particle state
const PARTICLE_COUNT = 500;
let   particleVelocities = [];
let   particleLife       = [];
let   particleActive     = false;

// Rotation
let   rotationY = 0;

// ─── Utility ───────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorToast.hidden = false;
  errorToast.classList.add('show');
  setTimeout(() => {
    errorToast.classList.remove('show');
    setTimeout(() => { errorToast.hidden = true; }, 400);
  }, 4000);
}
function showLoading(text = '読み込み中...') { loadingText.textContent = text; loadingOverlay.hidden = false; }
function hideLoading() { loadingOverlay.hidden = true; }
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

// ─── Feedback popup ────────────────────────────────────────
let feedbackTimer = null;
function showFeedback(emoji, label, durationMs = 2000) {
  feedbackEmoji.textContent = emoji;
  feedbackLabel.textContent = label;
  gestureFeedback.hidden = false;
  gestureFeedback.style.animation = 'none';
  requestAnimationFrame(() => {
    gestureFeedback.style.animation = 'feedbackIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both';
  });
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { gestureFeedback.hidden = true; }, durationMs);
}

// ─── Drag & Drop ───────────────────────────────────────────
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) loadGLBFile(f); });
uploadZone.addEventListener('click', e => { if (e.target !== document.getElementById('file-btn') && !document.getElementById('file-btn').contains(e.target)) fileInput.click(); });
fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadGLBFile(f); fileInput.value = ''; });

// ─── GLB Loading ───────────────────────────────────────────
function loadGLBFile(file) {
  if (!file.name.match(/\.(glb|gltf)$/i)) { showError('GLB または GLTF ファイルを選択してください'); return; }
  showLoading('モデルを読み込み中...');
  startBtn.disabled = true;

  const url = URL.createObjectURL(file);
  const loader = new GLTFLoader();
  loader.load(url, (gltf) => {
    loadedGLTF = gltf;
    URL.revokeObjectURL(url);

    // ── Normalize model: center it and fit largest dim = 1.0 ──
    const root = gltf.scene;

    // First compute original bounding box
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Create a wrapper group to do centering + uniform scale
    // This avoids mutating the gltf.scene itself (which breaks clones)
    const wrapper = new THREE.Group();
    wrapper.add(root);
    // Move root so that center of bbox is at origin
    root.position.sub(center);
    // Scale so max dimension = 1.0
    wrapper.scale.setScalar(1.0 / maxDim);

    // Store the wrapper as the scene we will clone
    gltf._normalizedScene = wrapper;

    console.log('[GLB] Loaded:', file.name, 'size:', size, 'maxDim:', maxDim);

    modelNameEl.textContent = file.name;
    modelSizeEl.textContent = formatBytes(file.size);
    modelInfo.hidden = false;
    startBtn.disabled = false;
    arNote.textContent = 'カメラを起動して手を検知します';
    hideLoading();
  }, undefined, (err) => {
    URL.revokeObjectURL(url);
    hideLoading();
    showError('ファイルの読み込みに失敗しました: ' + (err.message || '不明なエラー'));
    console.error(err);
  });
}

// ─── Three.js Setup ────────────────────────────────────────
function initThree() {
  scene3  = new THREE.Scene();

  const w = window.innerWidth;
  const h = window.innerHeight;

  camera3 = new THREE.PerspectiveCamera(60, w / h, 0.01, 200);
  camera3.position.set(0, 0, 2);

  renderer3 = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: true });
  renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3.setSize(w, h);
  renderer3.setClearColor(0x000000, 0);

  // ★ Critical for GLB PBR materials — without this models appear black
  renderer3.outputColorSpace = THREE.SRGBColorSpace;
  renderer3.toneMapping = THREE.ACESFilmicToneMapping;
  renderer3.toneMappingExposure = 1.5;

  // Lighting — strong enough to see any model
  const ambient = new THREE.AmbientLight(0xffffff, 2.0);
  scene3.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 3.0);
  dir.position.set(3, 6, 4);
  scene3.add(dir);

  const dir2 = new THREE.DirectionalLight(0xffd6b0, 1.5);
  dir2.position.set(-4, -2, 3);
  scene3.add(dir2);

  const hemi = new THREE.HemisphereLight(0xa0c8ff, 0x444444, 1.5);
  scene3.add(hemi);

  console.log('[Three] Initialized, canvas:', w, 'x', h);
}

function buildModelGroup() {
  if (modelGroup) {
    scene3.remove(modelGroup);
    modelGroup = null;
  }
  if (!loadedGLTF || !loadedGLTF._normalizedScene) {
    console.error('[Model] No normalized scene!');
    return;
  }

  modelGroup = new THREE.Group();
  const clone = loadedGLTF._normalizedScene.clone(true);
  modelGroup.add(clone);
  modelGroup.scale.setScalar(BASE_MODEL_SIZE);
  // Start visible at center for debug — will be hidden after first frame
  modelGroup.visible = false;
  scene3.add(modelGroup);

  console.log('[Model] Built group, scale:', BASE_MODEL_SIZE, 'children:', clone.children.length);
}

// ─── Particle System ───────────────────────────────────────
function buildParticles() {
  if (particles) { scene3.remove(particles); particles.geometry.dispose(); particles.material.dispose(); particles = null; }

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors    = new Float32Array(PARTICLE_COUNT * 3);

  particleVelocities = [];
  particleLife       = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i*3]   = 0;
    positions[i*3+1] = 0;
    positions[i*3+2] = 0;

    const v = new THREE.Vector3(
      (Math.random()-0.5)*2.5,
      (Math.random()-0.3)*2.0,
      (Math.random()-0.5)*2.5
    );
    particleVelocities.push(v);
    particleLife.push(1.0);

    const t = Math.random();
    if (t < 0.33)      { colors[i*3]=0.38; colors[i*3+1]=0.39; colors[i*3+2]=0.95; }
    else if (t < 0.66) { colors[i*3]=0.02; colors[i*3+1]=0.71; colors[i*3+2]=0.83; }
    else               { colors[i*3]=0.54; colors[i*3+1]=0.36; colors[i*3+2]=0.96; }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.03,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  particles = new THREE.Points(geo, mat);
  particles.visible = false;
  scene3.add(particles);
}

// ─── Gesture Detection Helpers ─────────────────────────────
const handCtx = handCanvas.getContext('2d');

function isPalmFacingCamera(landmarks) {
  // Cross product of (wrist→index_mcp) × (wrist→pinky_mcp)
  // For a right hand with palm facing camera: cross > 0
  // For a left hand with palm facing camera: cross < 0
  const wrist = landmarks[0];
  const idx   = landmarks[5];
  const pnk   = landmarks[17];

  const v1x = idx.x - wrist.x;
  const v1y = idx.y - wrist.y;
  const v2x = pnk.x - wrist.x;
  const v2y = pnk.y - wrist.y;

  return v1x * v2y - v1y * v2x;  // positive = one orientation, negative = other
}

function isHandOpen(landmarks) {
  // Check if 4 fingers are extended (tip.y < pip.y in image space)
  // PIP joints: index=6, middle=10, ring=14, pinky=18
  let extended = 0;
  const pairs = [[8,6], [12,10], [16,14], [20,18]];
  for (const [tip, pip] of pairs) {
    if (landmarks[tip].y < landmarks[pip].y - 0.02) extended++;
  }
  return extended >= 3;
}

function isHandFist(landmarks) {
  // All finger tips close to or below their MCP y
  // MCP joints: index=5, middle=9, ring=13, pinky=17
  let curled = 0;
  const pairs = [[8,5], [12,9], [16,13], [20,17]];
  for (const [tip, mcp] of pairs) {
    if (landmarks[tip].y > landmarks[mcp].y - 0.02) curled++;
  }
  return curled >= 3;
}

function getPalmCenter(landmarks) {
  const ids = [0, 5, 9, 13, 17];
  let x=0, y=0;
  for (const id of ids) { x += landmarks[id].x; y += landmarks[id].y; }
  return { x: x/ids.length, y: y/ids.length };
}

function getThumbIndexDist(landmarks) {
  const t = landmarks[4], i = landmarks[8];
  return Math.sqrt((t.x-i.x)**2 + (t.y-i.y)**2);
}

// ─── AR Session ────────────────────────────────────────────
startBtn.addEventListener('click', startAR);
exitBtn.addEventListener('click', () => stopAR());

async function startAR() {
  showLoading('カメラを起動中...');

  try {
    // Request front camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    cameraVideo.srcObject = stream;
    await new Promise(res => cameraVideo.onloadeddata = res);

    // Show AR view FIRST so canvas has layout
    landingScreen.hidden = true;
    arView.hidden = false;

    // Init Three.js (now canvas is visible and has dimensions)
    initThree();
    buildModelGroup();
    buildParticles();

    // Init MediaPipe Hands
    mpHands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    mpHands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    mpHands.onResults(onHandResults);

    // Camera utility
    mediaCamera = new Camera(cameraVideo, {
      onFrame: async () => {
        if (!isRunning || !mpHands) return;
        try { await mpHands.send({ image: cameraVideo }); } catch (e) { /* ignore */ }
      },
      width: 1280, height: 720
    });
    mediaCamera.start();
    isRunning = true;

    // Resize canvases to proper size
    resizeCanvases();

    hideLoading();

    hudDot.className = 'hud-dot';
    hudText.textContent = '手を検知中...';
    hintText.textContent = '右手のひらをカメラに向けてください';

    // IMPORTANT: start render loop AFTER everything is ready
    renderer3.setAnimationLoop(renderLoop);

    console.log('[AR] Started successfully');

  } catch (err) {
    hideLoading();
    showError('カメラの起動に失敗しました: ' + (err.message || String(err)));
    console.error(err);
    await stopAR();
  }
}

async function stopAR() {
  isRunning = false;
  if (mediaCamera) { mediaCamera.stop(); mediaCamera = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  await new Promise(r => setTimeout(r, 300));
  if (mpHands) { try { mpHands.close(); } catch(e) { /* */ } mpHands = null; }
  if (renderer3) { renderer3.setAnimationLoop(null); }
  landingScreen.hidden = false;
  arView.hidden = true;
  modelVisible = false;
  exploded = false;
  pinchScale = 1.0;
  prevPinchDist = null;
  wasFist = false;
}

// ─── Hand Results ───────────────────────────────────────────
function onHandResults(results) {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    prevPinchDist = null;
    // No hands: hide model if it was showing
    if (modelVisible && !exploded) {
      modelVisible = false;
      if (modelGroup) modelGroup.visible = false;
      hudDot.className = 'hud-dot';
      hudText.textContent = '手を検知中...';
      hintText.textContent = '右手のひらをカメラに向けてください';
    }
    return;
  }

  // Draw hand skeletons
  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const lm = results.multiHandLandmarks[i];
    drawConnectors(handCtx, lm, HAND_CONNECTIONS, { color: 'rgba(99,102,241,0.45)', lineWidth: 2 });
    drawLandmarks(handCtx, lm, { color: 'rgba(6,182,212,0.8)', lineWidth: 1, radius: 3 });
  }

  // ── Identify hands ──
  // MediaPipe legacy CDN labels hands from the MODEL's perspective.
  // In a selfie/front camera: Label "Left" = user's RIGHT hand.
  let rightHand = null;
  let leftHand  = null;

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const label = results.multiHandedness[i].label;
    if (label === 'Left')  rightHand = results.multiHandLandmarks[i]; // user's right
    if (label === 'Right') leftHand  = results.multiHandLandmarks[i]; // user's left
  }

  // If only one hand detected, use it as right hand (simpler UX)
  if (results.multiHandLandmarks.length === 1 && !rightHand) {
    rightHand = results.multiHandLandmarks[0];
  }

  // ── RIGHT HAND: detect open palm → show model on palm ──
  if (rightHand && !exploded) {
    const cross = isPalmFacingCamera(rightHand);
    const open  = isHandOpen(rightHand);

    // Show model if hand is (roughly) open and palm faces camera
    // We check: open hand OR cross product is notably positive
    // Simplified: just show if open hand is detected
    if (open) {
      const palm = getPalmCenter(rightHand);
      positionModelOnPalm(palm);

      if (!modelVisible) {
        modelVisible = true;
        showModelAnim();
        hudDot.className = 'hud-dot active';
        hudText.textContent = 'モデル表示中';
        hintText.textContent = '左手でサイズや状態を操作';
        showFeedback('✋', 'モデルを召喚！');
        console.log('[Gesture] Right hand open → show model, cross:', cross.toFixed(3));
      }
    } else {
      if (modelVisible) {
        modelVisible = false;
        hideModelAnim();
        hudDot.className = 'hud-dot';
        hudText.textContent = '手を検知中...';
        hintText.textContent = '右手のひらをカメラに向けてください';
      }
    }
  }

  // ── LEFT HAND: pinch-out / fist / open ──
  if (leftHand) {
    const fist = isHandFist(leftHand);
    const open = isHandOpen(leftHand);

    // FIST → explode
    if (fist && !wasFist && !exploded && modelVisible) {
      wasFist = true;
      exploded = true;
      modelVisible = false;
      triggerExplosion();
      showFeedback('💥', 'モデルが爆発！');
      hintText.textContent = '左手を開くと再召喚';
      console.log('[Gesture] Left fist → explode');
    }
    // OPEN → reassemble (only if exploded)
    else if (open && exploded) {
      wasFist = false;
      exploded = false;
      modelVisible = true;
      reassembleModel();
      showFeedback('🌟', '再召喚！');
      hintText.textContent = '左手ピンチアウトで拡大';
      console.log('[Gesture] Left open → reassemble');
    }
    // PINCH-OUT → scale model
    else if (!exploded && modelVisible) {
      if (!fist) wasFist = false;
      const dist = getThumbIndexDist(leftHand);
      if (prevPinchDist !== null) {
        const delta = dist - prevPinchDist;
        if (Math.abs(delta) > 0.003) {
          pinchScale = Math.max(0.3, Math.min(6.0, pinchScale * (1 + delta * 4.0)));
          updateModelScale();
        }
      }
      prevPinchDist = dist;
    } else {
      if (!fist) wasFist = false;
    }
  } else {
    prevPinchDist = null;
    if (!exploded) wasFist = false;
  }
}

// ─── Model positioning & show/hide ─────────────────────────
function positionModelOnPalm(palmCenter) {
  if (!modelGroup) return;
  const aspect = window.innerWidth / window.innerHeight;
  const fovRad = THREE.MathUtils.degToRad(60);
  const dist   = camera3.position.z;
  const viewH  = 2 * dist * Math.tan(fovRad / 2);
  const viewW  = viewH * aspect;

  // MediaPipe x: 0=left, 1=right (raw camera frame before CSS mirror)
  // CSS scaleX(-1) mirrors the video visually, so we invert x for Three.js
  const sceneX = (0.5 - palmCenter.x) * viewW;
  const sceneY = (0.5 - palmCenter.y) * viewH;

  const target = new THREE.Vector3(sceneX, sceneY, 0);
  modelGroup.position.lerp(target, 0.2);
}

function showModelAnim() {
  if (!modelGroup) return;
  modelGroup.visible = true;
  let t = 0;
  const animate = () => {
    if (!modelGroup) return;
    t = Math.min(1, t + 0.08);
    const ease = easeOutBack(t);
    modelGroup.scale.setScalar(BASE_MODEL_SIZE * pinchScale * ease);
    if (t < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function hideModelAnim() {
  if (!modelGroup) return;
  let t = 1;
  const animate = () => {
    if (!modelGroup) return;
    t = Math.max(0, t - 0.12);
    modelGroup.scale.setScalar(BASE_MODEL_SIZE * pinchScale * t);
    if (t > 0) requestAnimationFrame(animate);
    else modelGroup.visible = false;
  };
  requestAnimationFrame(animate);
}

function updateModelScale() {
  if (!modelGroup || !modelGroup.visible) return;
  modelGroup.scale.setScalar(BASE_MODEL_SIZE * pinchScale);
}

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ─── Explosion / Reassemble ────────────────────────────────
function triggerExplosion() {
  if (!modelGroup) return;
  const origin = modelGroup.position.clone();
  modelGroup.visible = false;

  const posAttr = particles.geometry.attributes.position;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    posAttr.setXYZ(i,
      origin.x + (Math.random()-0.5)*0.05,
      origin.y + (Math.random()-0.5)*0.05,
      origin.z + (Math.random()-0.5)*0.05
    );
    particleLife[i] = 1.0;
    particleVelocities[i].set(
      (Math.random()-0.5)*2.0,
      (Math.random()-0.4)*1.8,
      (Math.random()-0.5)*2.0
    );
  }
  posAttr.needsUpdate = true;
  particles.material.opacity = 1;
  particles.visible = true;
  particleActive = true;
}

function reassembleModel() {
  particleActive = false;
  particles.visible = false;
  pinchScale = 1.0;
  if (!modelGroup) return;
  modelGroup.visible = true;
  showModelAnim();
}

// ─── Render Loop ───────────────────────────────────────────
let lastTime = 0;

function renderLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);  // cap to avoid huge jumps
  lastTime = timestamp;

  // Rotate model
  if (modelGroup && modelGroup.visible) {
    rotationY += dt * 0.6;
    modelGroup.rotation.y = rotationY;
    modelGroup.rotation.x = Math.sin(timestamp * 0.0004) * 0.06;
  }

  // Update particles
  if (particleActive && particles && particles.visible) {
    const posAttr = particles.geometry.attributes.position;
    let allDead = true;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleLife[i] = Math.max(0, particleLife[i] - dt * 0.5);
      if (particleLife[i] > 0) {
        allDead = false;
        const v = particleVelocities[i];
        posAttr.setXYZ(i,
          posAttr.getX(i) + v.x * dt,
          posAttr.getY(i) + v.y * dt - dt * 0.4,
          posAttr.getZ(i) + v.z * dt
        );
        v.multiplyScalar(0.98);
      }
    }
    posAttr.needsUpdate = true;
    const avgLife = particleLife.reduce((a,b) => a+b, 0) / PARTICLE_COUNT;
    particles.material.opacity = avgLife * 2;
    if (allDead) { particles.visible = false; particleActive = false; }
  }

  renderer3.render(scene3, camera3);
}

// ─── Resize ────────────────────────────────────────────────
function resizeCanvases() {
  const w = window.innerWidth, h = window.innerHeight;
  handCanvas.width  = w; handCanvas.height  = h;
  // Don't set threeCanvas width/height directly — let renderer handle it
  if (renderer3) {
    renderer3.setSize(w, h);
    camera3.aspect = w / h;
    camera3.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resizeCanvases);

// ─── Fallback notice ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    arNote.textContent = '⚠ このブラウザはカメラに対応していません';
    arNote.style.color = '#f59e0b';
  }
});
