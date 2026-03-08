/**
 * Magic Hand – main.js
 * インカメラ + MediaPipe Hands でジェスチャーを検知し、
 * Three.js でGLBモデルをオーバーレイ表示する。
 *
 * ジェスチャー:
 *   右手のひら上向き   → モデル召喚
 *   左手ピンチアウト   → モデル拡大
 *   左手を握る         → パーティクル爆発
 *   左手を開く         → モデル再召喚
 *   モデルは常に回転
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
let loadedGLTF    = null;   // GLTFResult
let mediaCamera   = null;   // MediaPipe Camera
let mpHands       = null;   // MediaPipe Hands instance
let stream        = null;   // getUserMedia stream

// Three.js
let renderer3     = null;
let scene3        = null;
let camera3       = null;
let modelGroup    = null; // root of the placed model
let particles     = null; // particle system (THREE.Points)

// Gesture state
let modelScale    = 1.0;    // base scale factor (gesture controls this)
const BASE_MODEL_SIZE = 0.18; // meters equivalent in scene units (palm size)
let   modelVisible= false;
let   exploded    = false;  // whether model is in exploded state
let   rightPalmUp = false;

// Pinch tracking
let   prevPinchDist = null; // previous frame left-hand pinch distance
let   pinchScale    = 1.0;  // accumulated scale from pinch

// Fist tracking
let   wasFist       = false;
let   wasOpen       = false;

// Particle state
const PARTICLE_COUNT = 600;
let   particleVelocities = []; // Float32Array style
let   particleLife       = []; // float, 0..1
let   particleActive     = false;
let   particleTimer      = 0;

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

    // Normalize scale so largest dimension = 1.0
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) gltf.scene.scale.setScalar(1.0 / maxDim);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(1.0 / maxDim);
    gltf.scene.position.sub(center);

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
  camera3 = new THREE.PerspectiveCamera(60, threeCanvas.clientWidth / threeCanvas.clientHeight, 0.001, 100);
  camera3.position.set(0, 0, 2);

  renderer3 = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: true });
  renderer3.setPixelRatio(window.devicePixelRatio);
  renderer3.setSize(threeCanvas.clientWidth, threeCanvas.clientHeight);
  renderer3.setClearColor(0x000000, 0);

  // Lighting
  scene3.add(new THREE.AmbientLight(0xffffff, 1.5));
  const dir = new THREE.DirectionalLight(0xffffff, 2.5);
  dir.position.set(3, 6, 4);
  scene3.add(dir);
  const hemi = new THREE.HemisphereLight(0xa0c8ff, 0x555544, 1.2);
  scene3.add(hemi);
  const fill = new THREE.DirectionalLight(0xffd6b0, 1.0);
  fill.position.set(-4, -2, 3);
  scene3.add(fill);
}

function buildModelGroup() {
  if (modelGroup) { scene3.remove(modelGroup); modelGroup = null; }
  modelGroup = new THREE.Group();
  const clone = loadedGLTF.scene.clone(true);
  modelGroup.add(clone);
  modelGroup.visible = false;
  modelGroup.scale.setScalar(BASE_MODEL_SIZE);
  scene3.add(modelGroup);
}

// ─── Particle System ───────────────────────────────────────
function buildParticles() {
  if (particles) { scene3.remove(particles); particles.geometry.dispose(); particles.material.dispose(); particles = null; }

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors    = new Float32Array(PARTICLE_COUNT * 3);
  const sizes     = new Float32Array(PARTICLE_COUNT);

  particleVelocities = [];
  particleLife       = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i*3]   = (Math.random()-0.5)*0.01;
    positions[i*3+1] = (Math.random()-0.5)*0.01;
    positions[i*3+2] = (Math.random()-0.5)*0.01;

    // random velocity outward
    const v = new THREE.Vector3(
      (Math.random()-0.5)*2.5,
      (Math.random()-0.5)*2.5 + 0.5,
      (Math.random()-0.5)*2.5
    );
    particleVelocities.push(v);
    particleLife.push(1.0);

    // color: warm palette
    const t = Math.random();
    if (t < 0.33) { colors[i*3]=0.38; colors[i*3+1]=0.39; colors[i*3+2]=0.95; }      // indigo
    else if (t < 0.66) { colors[i*3]=0.02; colors[i*3+1]=0.71; colors[i*3+2]=0.83; } // cyan
    else { colors[i*3]=0.54; colors[i*3+1]=0.36; colors[i*3+2]=0.96; }               // violet

    sizes[i] = 3 + Math.random() * 6;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    size: 0.025,
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

// ─── MediaPipe Hands ───────────────────────────────────────
const handCtx = handCanvas.getContext('2d');

/**
 * Classify a hand as:
 *   'palmUp'   – 右手のひら上向き
 *   'fist'     – 握り拳
 *   'open'     – 開いた手
 *   'pinch'    – ピンチ（親指＋人差し指）
 *   'other'
 */
function classifyHand(landmarks) {
  // Tip IDs: thumb=4, index=8, middle=12, ring=16, pinky=20
  // MCP IDs: index=5, middle=9, ring=13, pinky=17
  const wrist   = landmarks[0];
  const thumbTip= landmarks[4];
  const idxTip  = landmarks[8];
  const midTip  = landmarks[12];
  const rngTip  = landmarks[16];
  const pnkTip  = landmarks[20];
  const idxMcp  = landmarks[5];
  const midMcp  = landmarks[9];

  // Fingers extended or not (tip.y < mcp.y means extended in image space)
  const fingerExtended = (tipIdx, mcpIdx) => landmarks[tipIdx].y < landmarks[mcpIdx].y - 0.04;

  const idxExt = fingerExtended(8, 5);
  const midExt = fingerExtended(12, 9);
  const rngExt = fingerExtended(16, 13);
  const pnkExt = fingerExtended(20, 17);
  const extCount = [idxExt, midExt, rngExt, pnkExt].filter(Boolean).length;

  // Pinch distance (thumb tip to index tip)
  const pinchDx = thumbTip.x - idxTip.x;
  const pinchDy = thumbTip.y - idxTip.y;
  const pinchDist = Math.sqrt(pinchDx*pinchDx + pinchDy*pinchDy);

  // Palm normal direction: wrist.z vs middle finger MCP z
  // In front-cam (mirrored) when palm faces up, z values invert
  // We use a simpler heuristic: wrist.z > midMcp.z → palm facing camera (up)
  const palmUp = wrist.z < midMcp.z - 0.05;

  if (extCount <= 1) return 'fist';
  if (extCount >= 4) return 'open';
  if (pinchDist < 0.06 && !idxExt) return 'pinch';
  return 'other';
}

function getPalmCenter(landmarks) {
  // Average of wrist and finger MCPs
  const ids = [0, 5, 9, 13, 17];
  let x=0, y=0, z=0;
  for (const id of ids) { x+=landmarks[id].x; y+=landmarks[id].y; z+=landmarks[id].z; }
  return { x: x/ids.length, y: y/ids.length, z: z/ids.length };
}

function isPalmFacingUp(landmarks) {
  // Heuristic: wrist z < MCP z (hand tilted so palm faces camera/upward)
  const wrist  = landmarks[0];
  const midMcp = landmarks[9];
  return wrist.z < midMcp.z - 0.04;
}

function getThumbIndexDist(landmarks) {
  const t = landmarks[4], i = landmarks[8];
  return Math.sqrt((t.x-i.x)**2 + (t.y-i.y)**2);
}

// ─── AR Session ────────────────────────────────────────────
startBtn.addEventListener('click', startAR);
exitBtn.addEventListener('click', stopAR);

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

    // Resize canvases
    resizeCanvases();

    // Init Three.js
    initThree();
    buildModelGroup();
    buildParticles();

    // Init MediaPipe Hands
    mpHands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    mpHands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });
    mpHands.onResults(onHandResults);

    // Use MediaPipe Camera util
    mediaCamera = new Camera(cameraVideo, {
      onFrame: async () => { await mpHands.send({ image: cameraVideo }); },
      width: 1280, height: 720
    });
    mediaCamera.start();

    // Show AR view
    landingScreen.hidden = true;
    arView.hidden = false;
    hideLoading();

    hudDot.className = 'hud-dot';
    hudText.textContent = '手を検知中...';
    hintText.textContent = '右手のひらを上向きにしてください';

    // Start render loop
    renderer3.setAnimationLoop(onFrame);

  } catch (err) {
    hideLoading();
    showError('カメラの起動に失敗しました: ' + (err.message || String(err)));
    console.error(err);
    stopAR();
  }
}

function stopAR() {
  if (mediaCamera) { mediaCamera.stop(); mediaCamera = null; }
  if (mpHands)     { mpHands.close(); mpHands = null; }
  if (stream)      { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (renderer3)   { renderer3.setAnimationLoop(null); }
  landingScreen.hidden = false;
  arView.hidden = true;
  modelVisible = false;
  exploded = false;
  pinchScale = 1.0;
  prevPinchDist = null;
  rightPalmUp = false;
}

// ─── Hand Results ───────────────────────────────────────────
function onHandResults(results) {
  // Clear hand canvas
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    // No hands detected
    prevPinchDist = null;
    return;
  }

  // Draw skeleton
  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const landmarks = results.multiHandLandmarks[i];
    drawConnectors(handCtx, landmarks, HAND_CONNECTIONS, { color: 'rgba(99,102,241,0.5)', lineWidth: 2 });
    drawLandmarks(handCtx, landmarks, { color: 'rgba(6,182,212,0.85)', lineWidth: 1, radius: 3 });
  }

  // Determine which is left/right (MediaPipe gives "Left"/"Right" from user's perspective,
  // but since we mirror the video, we swap the labels)
  let rightHand = null; // will hold landmark array for right hand (user's right = camera left)
  let leftHand  = null;

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const label = results.multiHandedness[i].label; // "Left" or "Right" (mirror corrected)
    if (label === 'Right') rightHand = results.multiHandLandmarks[i];
    if (label === 'Left')  leftHand  = results.multiHandLandmarks[i];
  }

  // ── Right hand: palm-up check → show/position model ──
  if (rightHand) {
    const palmUp = isPalmFacingUp(rightHand);
    if (palmUp && !exploded) {
      const palmCenter = getPalmCenter(rightHand);
      positionModelOnPalm(palmCenter);

      if (!modelVisible) {
        modelVisible = true;
        showModel();
        hudDot.className = 'hud-dot active';
        hudText.textContent = '手のひらにモデルを表示中';
        hintText.textContent = '左手でサイズや状態を操作できます';
        showFeedback('✋', '手のひらにモデルを召喚！');
      }
    } else if (!exploded) {
      // Palm not up → hide (but only if not exploded)
      if (modelVisible) {
        modelVisible = false;
        hideModel();
        hudDot.className = 'hud-dot';
        hudText.textContent = '手を検知中...';
        hintText.textContent = '右手のひらを上向きにしてください';
      }
    }
  } else {
    // No right hand
    if (modelVisible && !exploded) {
      modelVisible = false;
      hideModel();
      hintText.textContent = '右手のひらを上向きにしてください';
    }
  }

  // ── Left hand: pinch / fist / open ──
  if (leftHand) {
    const gesture = classifyHand(leftHand);

    if (gesture === 'fist' && !wasFist && !exploded && modelVisible) {
      // Explode!
      wasFist = true;
      wasOpen = false;
      exploded = true;
      modelVisible = false;
      triggerExplosion();
      showFeedback('💥', 'モデルが爆発！');
      hintText.textContent = '左手を開くと再召喚できます';
    } else if (gesture === 'open' && exploded) {
      // Reassemble
      wasOpen = true;
      wasFist = false;
      exploded = false;
      modelVisible = true;
      reassembleModel();
      showFeedback('🌟', 'モデルが再召喚された！');
      hintText.textContent = '左手ピンチアウトで拡大できます';
    } else if (!exploded && modelVisible) {
      wasFist = false;
      const currentPinchDist = getThumbIndexDist(leftHand);
      if (prevPinchDist !== null) {
        const delta = currentPinchDist - prevPinchDist;
        if (Math.abs(delta) > 0.002) {
          const factor = 1 + delta * 5.0;
          pinchScale = Math.max(0.3, Math.min(8.0, pinchScale * factor));
          updateModelScale();
          if (delta > 0.005) {
            hintText.textContent = '拡大中';
          }
        }
      }
      prevPinchDist = currentPinchDist;
    } else {
      if (gesture !== 'fist') wasFist = false;
    }
  } else {
    prevPinchDist = null;
    if (!exploded) { wasFist = false; }
  }
}

// ─── Model positioning & show/hide ─────────────────────────
function positionModelOnPalm(palmCenter) {
  if (!modelGroup) return;
  // Map normalized MediaPipe coords (0..1) to Three.js scene coords.
  // palmCenter.x is 0=left, 1=right (mirrored), palmCenter.y is 0=top, 1=bottom
  // Since we flipped the video with css scaleX(-1), but MediaPipe works on raw feed,
  // we need to mirror X: scene_x = (0.5 - palmCenter.x) * viewWidth
  const aspect = threeCanvas.clientWidth / threeCanvas.clientHeight;
  const fovRad = THREE.MathUtils.degToRad(60);
  const dist   = camera3.position.z;
  const viewH  = 2 * dist * Math.tan(fovRad / 2);
  const viewW  = viewH * aspect;

  const sceneX = (0.5 - palmCenter.x) * viewW;
  const sceneY = (0.5 - palmCenter.y) * viewH;
  const sceneZ = 0;

  modelGroup.position.lerp(new THREE.Vector3(sceneX, sceneY, sceneZ), 0.15);
}

function showModel() {
  if (!modelGroup) return;
  modelGroup.visible = true;
  // Animate in with scale
  let t = 0;
  const animIn = () => {
    t = Math.min(1, t + 0.06);
    const s = BASE_MODEL_SIZE * pinchScale * easeOutBack(t);
    modelGroup.scale.setScalar(s);
    if (t < 1) requestAnimationFrame(animIn);
  };
  requestAnimationFrame(animIn);
}

function hideModel() {
  if (!modelGroup) return;
  let t = 1;
  const animOut = () => {
    t = Math.max(0, t - 0.1);
    const s = BASE_MODEL_SIZE * pinchScale * t;
    if (modelGroup) modelGroup.scale.setScalar(s);
    if (t > 0) requestAnimationFrame(animOut);
    else if (modelGroup) modelGroup.visible = false;
  };
  requestAnimationFrame(animOut);
}

function updateModelScale() {
  if (!modelGroup) return;
  const s = BASE_MODEL_SIZE * pinchScale;
  modelGroup.scale.setScalar(s);
}

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ─── Explosion / Reassemble ────────────────────────────────
function triggerExplosion() {
  if (!modelGroup) return;
  modelGroup.visible = false;

  // Store current model position for particle origin
  const origin = modelGroup.position.clone();

  // Reset particles at model position
  const posAttr = particles.geometry.attributes.position;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    posAttr.setXYZ(i, origin.x + (Math.random()-0.5)*0.02, origin.y + (Math.random()-0.5)*0.02, origin.z + (Math.random()-0.5)*0.02);
    particleLife[i] = 1.0;
    particleVelocities[i].set(
      (Math.random()-0.5)*1.8,
      (Math.random()-0.4)*1.8 + 0.2,
      (Math.random()-0.5)*1.8
    );
  }
  posAttr.needsUpdate = true;
  particles.material.opacity = 1;
  particles.visible = true;
  particleActive = true;
  particleTimer = 0;
}

function reassembleModel() {
  particleActive = false;
  particles.visible = false;

  // Reset pinchScale
  pinchScale = 1.0;

  if (!modelGroup) return;
  modelGroup.visible = true;
  // Animate in
  let t = 0;
  const animIn = () => {
    t = Math.min(1, t + 0.05);
    const s = BASE_MODEL_SIZE * easeOutBack(t);
    if (modelGroup) modelGroup.scale.setScalar(s);
    if (t < 1) requestAnimationFrame(animIn);
  };
  requestAnimationFrame(animIn);
}

// ─── Render Loop ───────────────────────────────────────────
const clock = new THREE.Clock();

function onFrame() {
  const dt = clock.getDelta();

  // Rotate model
  if (modelGroup && modelGroup.visible) {
    rotationY += dt * 0.6;
    modelGroup.rotation.y = rotationY;
    // Gentle bob
    modelGroup.rotation.x = Math.sin(clock.elapsedTime * 0.4) * 0.06;
  }

  // Update particles
  if (particleActive && particles && particles.visible) {
    particleTimer += dt;
    const posAttr = particles.geometry.attributes.position;
    let allDead = true;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleLife[i] = Math.max(0, particleLife[i] - dt * 0.55);
      if (particleLife[i] > 0) {
        allDead = false;
        const v = particleVelocities[i];
        const x = posAttr.getX(i) + v.x * dt;
        const y = posAttr.getY(i) + v.y * dt - 0.5 * dt * dt; // gravity
        const z = posAttr.getZ(i) + v.z * dt;
        posAttr.setXYZ(i, x, y, z);
        // Dampen velocity
        v.multiplyScalar(0.985);
      }
    }
    posAttr.needsUpdate = true;
    particles.material.opacity = Math.max(0, particleLife.reduce((a,b)=>a+b,0)/PARTICLE_COUNT * 2);
    if (allDead) {
      particles.visible = false;
      particleActive = false;
    }
  }

  renderer3.render(scene3, camera3);
}

// ─── Resize ────────────────────────────────────────────────
function resizeCanvases() {
  const w = window.innerWidth, h = window.innerHeight;
  handCanvas.width  = w; handCanvas.height  = h;
  threeCanvas.width = w; threeCanvas.height = h;
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
