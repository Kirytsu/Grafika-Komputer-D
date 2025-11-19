// Helicopter Simultion

// Parameter Default: 
// mass=2000kg
// R=4.5m
// Ω=23.5rad/s

// Constants:
// Ct=0.13
// ρ=1.225kg/m³

// Physic Calculations: 
// W = m × g
// T = Ct × ρ × π × R² × (Ω × R)²
// F=T-W
// a=F/m

import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/FBXLoader.js";

const container = document.getElementById("canvas-container") || document.getElementById("app");
const infoPanelWidth = window.innerWidth * 0.4;
const canvasWidth = window.innerWidth - infoPanelWidth;

// Setup renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(canvasWidth, window.innerHeight);
if ("outputColorSpace" in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
container.appendChild(renderer.domElement);

// Setup scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// Setup camera
const camera = new THREE.PerspectiveCamera(60, canvasWidth / window.innerHeight, 0.1, 2000);
camera.position.set(25, 12, 35);

// Setup controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

const MIN_CAMERA_Y = 0.2;
controls.addEventListener("change", () => {
  if (camera.position.y < MIN_CAMERA_Y) camera.position.y = MIN_CAMERA_Y;
});

// Setup lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x8d7c6b, 0.8);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(50, 50, 30);
dir.castShadow = true;
dir.shadow.mapSize.width = 2048;
dir.shadow.mapSize.height = 2048;
dir.shadow.camera.left = -100;
dir.shadow.camera.right = 100;
dir.shadow.camera.top = 100;
dir.shadow.camera.bottom = -100;
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 200;
scene.add(dir);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Scene structure
const sceneRoot = new THREE.Group();
scene.add(sceneRoot);

const environmentGroup = new THREE.Group();
sceneRoot.add(environmentGroup);

let ground;
const helicopterGroup = new THREE.Group();
sceneRoot.add(helicopterGroup);

// Loaders
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

function loadGLTF(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
}

function loadFBX(url) {
  return new Promise((resolve, reject) => fbxLoader.load(url, resolve, undefined, reject));
}

// Model objects
let helicopterModel = null;
let mainRotor = null;

// Fisika helikopter
const physics = {
  liftForce: 0,
  rotorSpeed: 0,
  mass: 2000,
  a: 0,
  desiredA: 0,
  bladeRadius: 4.5,
};

const BASE_MASS = 2000;
const AIR_DENSITY = 1.225;
const THRUST_COEFF = 0.13;
const MAX_ROTOR_SPEED = 50;

let suppressHandlers = false;
let verticalVelocity = 0;
let restY = 0;
let helicopterLoaded = false;

// HTML slider controls
const liftSlider = document.getElementById('lift-slider');
const rotorSlider = document.getElementById('rotor-slider');
const radiusSlider = document.getElementById('radius-slider');
const accelSlider = document.getElementById('accel-slider');
const massSlider = document.getElementById('mass-slider');

// Get value display elements
const liftValue = document.getElementById('lift-value');
const rotorValue = document.getElementById('rotor-value');
const radiusValue = document.getElementById('radius-value');
const accelValue = document.getElementById('accel-value');
const massValue = document.getElementById('mass-value');

// Slider event handlers
liftSlider.addEventListener('input', (e) => {
  if (suppressHandlers) return;
  suppressHandlers = true;
  
  const v = parseFloat(e.target.value);
  liftValue.textContent = Math.round(v);
  
  const T = v <= 0 ? 0 : v;
  const R = physics.bladeRadius;
  const A = Math.PI * R * R;
  const denom = THRUST_COEFF * AIR_DENSITY * A;
  let omegaReq = 0;
  if (denom > 0 && R > 0) {
    omegaReq = Math.sqrt(Math.max(0, T / denom)) / R;
  }
  let omega = omegaReq;
  if (omegaReq > MAX_ROTOR_SPEED) {
    omega = MAX_ROTOR_SPEED;
    const vtip = omega * R;
    const achievableT = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
    physics.liftForce = achievableT;
    liftSlider.value = achievableT;
    liftValue.textContent = Math.round(achievableT);
  } else {
    physics.liftForce = T;
  }
  physics.rotorSpeed = omega;
  rotorSlider.value = omega;
  rotorValue.textContent = omega.toFixed(1);
  
  physics.a = (physics.liftForce - physics.mass * 9.8) / physics.mass;
  accelSlider.value = physics.a;
  accelValue.textContent = physics.a.toFixed(1);
  physics.desiredA = physics.a;
  
  suppressHandlers = false;
});

rotorSlider.addEventListener('input', (e) => {
  if (suppressHandlers) return;
  suppressHandlers = true;
  
  const v = parseFloat(e.target.value);
  rotorValue.textContent = v.toFixed(1);
  physics.rotorSpeed = v;
  
  const R = physics.bladeRadius;
  const A = Math.PI * R * R;
  const vtip = v * R;
  const T = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
  physics.liftForce = T;
  liftSlider.value = T;
  liftValue.textContent = Math.round(T);
  
  physics.a = (T - physics.mass * 9.8) / physics.mass;
  accelSlider.value = physics.a;
  accelValue.textContent = physics.a.toFixed(1);
  physics.desiredA = physics.a;
  
  suppressHandlers = false;
});

radiusSlider.addEventListener('input', (e) => {
  if (suppressHandlers) return;
  suppressHandlers = true;
  
  const v = parseFloat(e.target.value);
  radiusValue.textContent = v.toFixed(1);
  
  const R = v;
  physics.bladeRadius = R;
  const A = Math.PI * R * R;
  const omega = physics.rotorSpeed;
  const vtip = omega * R;
  const T = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
  physics.liftForce = T;
  liftSlider.value = T;
  liftValue.textContent = Math.round(T);
  
  physics.a = (T - physics.mass * 9.8) / physics.mass;
  accelSlider.value = physics.a;
  accelValue.textContent = physics.a.toFixed(1);
  physics.desiredA = physics.a;
  
  // Update visual rotor scale
  if (mainRotor && mainRotor.userData && mainRotor.userData.baseRadius) {
    const baseR = mainRotor.userData.baseRadius || 1;
    const baseScale = mainRotor.userData.baseScale || new THREE.Vector3(1, 1, 1);
    const scaleFactor = R / baseR;
    mainRotor.scale.set(
      baseScale.x * scaleFactor,
      baseScale.y,
      baseScale.z * scaleFactor
    );
  }
  
  suppressHandlers = false;
});

accelSlider.addEventListener('input', (e) => {
  if (suppressHandlers) return;
  suppressHandlers = true;
  
  const v = parseFloat(e.target.value);
  accelValue.textContent = v.toFixed(1);
  physics.desiredA = v;
  
  const desiredA = v;
  const requiredT = physics.mass * (desiredA + 9.8);
  const R = physics.bladeRadius;
  const A = Math.PI * R * R;
  let omega = 0;
  if (THRUST_COEFF * AIR_DENSITY * A * (R * R) > 0) {
    omega = Math.sqrt(requiredT / (THRUST_COEFF * AIR_DENSITY * A)) / R;
  }
  if (omega > MAX_ROTOR_SPEED) omega = MAX_ROTOR_SPEED;
  physics.rotorSpeed = Math.max(0, Math.min(MAX_ROTOR_SPEED, omega));
  rotorSlider.value = physics.rotorSpeed;
  rotorValue.textContent = physics.rotorSpeed.toFixed(1);
  
  const vtip = physics.rotorSpeed * R;
  physics.liftForce = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
  liftSlider.value = physics.liftForce;
  liftValue.textContent = Math.round(physics.liftForce);
  
  suppressHandlers = false;
});

massSlider.addEventListener('input', (e) => {
  if (suppressHandlers) return;
  suppressHandlers = true;
  
  const v = parseFloat(e.target.value);
  massValue.textContent = Math.round(v);
  
  const newMass = v <= 0 ? 1 : v;
  physics.mass = newMass;
  
  physics.a = (physics.liftForce - physics.mass * 9.8) / physics.mass;
  accelSlider.value = physics.a;
  accelValue.textContent = physics.a.toFixed(1);
  physics.desiredA = physics.a;
  
  suppressHandlers = false;
});

// Load 3D models
Promise.allSettled([
  loadGLTF("./model/grass_texture.glb"),
  loadFBX("./model/MD 902 Explorer.fbx"),
])
  .then((results) => {
    const gltfResult = results[0];
    const fbxResult = results[1];

    const groundWidth = 500;
    const groundHeight = 500;

    // Load ground with texture

    if (gltfResult.status === "fulfilled") {
      const gltf = gltfResult.value;
      let grassTexture = null;
      gltf.scene.traverse((child) => {
        if (child.isMesh && child.material && child.material.map)
          grassTexture = child.material.map;
      });
      if (grassTexture) {
        grassTexture.wrapS = THREE.RepeatWrapping;
        grassTexture.wrapT = THREE.RepeatWrapping;
        grassTexture.repeat.set(groundWidth, groundHeight);
      }
      const groundGeometry = new THREE.PlaneGeometry(
        groundWidth,
        groundHeight,
        50,
        50
      );
      const groundMaterial = new THREE.MeshStandardMaterial({
        map: grassTexture,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.0,
      });
      ground = new THREE.Mesh(groundGeometry, groundMaterial);
    } else {
      const groundGeometry = new THREE.PlaneGeometry(
        groundWidth,
        groundHeight,
        50,
        50
      );
      const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a7d44,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.0,
      });
      ground = new THREE.Mesh(groundGeometry, groundMaterial);
    }

    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    environmentGroup.add(ground);

    // Load helicopter model
    if (fbxResult.status === "fulfilled") {
      const fbx = fbxResult.value;
      helicopterModel = fbx;

      // Scale model to target size
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      const targetSize = 11;
      const currentSize = Math.max(size.x, size.y, size.z) || 1;
      const scale = targetSize / currentSize;
      helicopterModel.scale.setScalar(scale);

      // Calculate ground position
      const groundY = ground ? ground.position.y : 0;
      const clearance = 0.05;
      const halfHeight = (size.y * scale) / 2;
      const centerYScaled = center.y * scale;

      restY = groundY + clearance + halfHeight - centerYScaled;
      helicopterGroup.position.set(0, restY + 0.05, 0);
      
      // Store metadata untuk scaling
      helicopterGroup.userData = helicopterGroup.userData || {};
      helicopterGroup.userData.groundY = groundY;
      helicopterGroup.userData.clearance = clearance;
      helicopterGroup.userData.baseRestOffset = restY - (groundY + clearance);
      helicopterGroup.userData.currentRestY = restY;
      helicopterGroup.userData.baseModelScale = scale;
      
      helicopterLoaded = true;
      verticalVelocity = 0;

      helicopterModel.position.set(0, 0, 0);

      // Setup shadows
      helicopterModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((mat) => {
            if (!mat) return;
            mat.transparent = false;
          });
        }
      });

      helicopterGroup.add(helicopterModel);

      // Detect main rotor
      const rotorCandidates = [];
      helicopterModel.traverse((child) => {
        if (!child) return;
        if (
          child.isMesh ||
          child.type === "Group" ||
          child.type === "Object3D"
        ) {
          const box = new THREE.Box3().setFromObject(child);
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);
          rotorCandidates.push({
            node: child,
            name: child.name || "",
            size,
            center,
          });
        }
      });

      if (rotorCandidates.length) {
        let mainCandidate = rotorCandidates.find((c) =>
          /main|rotor|hub|mast|blade/i.test(c.name)
        );
        if (!mainCandidate) {
          mainCandidate = rotorCandidates.slice().sort((a, b) => {
            const aScore = a.center.y + (a.size.x + a.size.z) * 0.5;
            const bScore = b.center.y + (b.size.x + b.size.z) * 0.5;
            return bScore - aScore;
          })[0];
        }
        if (mainCandidate) {
          mainRotor = mainCandidate.node;
          mainRotor.userData = mainRotor.userData || {};
          const estimatedRadius = Math.max(mainCandidate.size.x, mainCandidate.size.z) / 2 || 1;
          mainRotor.userData.baseRadius = estimatedRadius;
          mainRotor.userData.baseScale = mainRotor.scale.clone();
        }
      }
    }
  })
  .catch((e) => console.error("Error loading resources:", e));

// Window resize handler
function onWindowResize() {
  const currentInfoPanelWidth = window.innerWidth * 0.4;
  const w = window.innerWidth - currentInfoPanelWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", onWindowResize, false);

// Update physics setiap frame
function updateHelicopterPhysics(delta) {
  if (!helicopterLoaded || !helicopterGroup) return;

  // Visual scaling berdasarkan massa
  if (helicopterGroup.userData && typeof helicopterGroup.userData.baseRestOffset !== "undefined") {
    let scaleFactor = Math.cbrt(physics.mass / BASE_MASS);
    scaleFactor = Math.max(0.2, Math.min(5, scaleFactor));
    const prevScale = helicopterGroup.scale.x;
    if (Math.abs(scaleFactor - prevScale) > 1e-4) {
      const oldRestY = helicopterGroup.userData.currentRestY || restY;
      const newRestY = helicopterGroup.userData.groundY + helicopterGroup.userData.clearance + helicopterGroup.userData.baseRestOffset * scaleFactor;
      const deltaY = newRestY - oldRestY;
      helicopterGroup.position.y += deltaY;
      restY = newRestY;
      helicopterGroup.userData.currentRestY = newRestY;
      helicopterGroup.scale.setScalar(scaleFactor);
      if (helicopterGroup.position.y < restY) {
        helicopterGroup.position.y = restY;
        verticalVelocity = 0;
      }
    }
  }

  // Hitung gaya-gaya
  const lift = physics.liftForce;
  const gravity = physics.mass * 9.8;
  const netForce = lift - gravity;

  // Hitung percepatan
  let acc = netForce / physics.mass;
  const onGround = helicopterGroup.position.y <= restY + 1e-4;
  if (onGround && Math.abs(verticalVelocity) < 1e-6 && netForce <= 0) {
    acc = 0;
  }

  // Update kecepatan dan posisi
  verticalVelocity += acc * delta;
  helicopterGroup.position.y += verticalVelocity * delta * 60;

  // Collision dengan ground
  if (helicopterGroup.position.y < restY) {
    helicopterGroup.position.y = restY;
    verticalVelocity = 0;
  }

  physics.a = acc;

  // Status penerbangan
  let state = "DI DARAT";
  if (helicopterGroup.position.y > restY + 0.1) {
    if (Math.abs(verticalVelocity) < 0.5 && Math.abs(acc) < 0.5) {
      state = "MELAYANG";
    } else if (verticalVelocity > 0.1) {
      state = "NAIK";
    } else if (verticalVelocity < -0.1) {
      state = "TURUN";
    }
  }

  // Update info panel
  updateInfoPanel({
    lift,
    mass: physics.mass,
    weight: gravity,
    netForce,
    acc,
    vel: verticalVelocity,
    pos: helicopterGroup.position.y,
    state,
    rotorSpeed: physics.rotorSpeed,
    bladeRadius: physics.bladeRadius,
  });
}

// Update info panel dengan data fisika
function updateInfoPanel(params) {
  const { lift, mass, weight, netForce, acc, vel, pos, state, rotorSpeed, bladeRadius } = params;

  // Update parameter display
  const paramMass = document.getElementById("param-mass");
  const paramRadius = document.getElementById("param-radius");
  const paramOmega = document.getElementById("param-omega");
  
  if (paramMass) paramMass.textContent = `${mass.toFixed(1)} kg`;
  if (paramRadius) paramRadius.textContent = `${bladeRadius.toFixed(2)} m`;
  if (paramOmega) paramOmega.textContent = `${rotorSpeed.toFixed(2)} rad/s`;

  // Update formula display
  const formulaWeight = document.getElementById("formula-weight");
  const formulaThrust = document.getElementById("formula-thrust");
  const formulaNet = document.getElementById("formula-net");
  const formulaAccel = document.getElementById("formula-accel");
  
  if (formulaWeight) {
    formulaWeight.innerHTML = `W = ${mass.toFixed(0)} × 9.8 = <strong>${weight.toFixed(1)} N</strong>`;
  }
  
  if (formulaThrust) {
    const R = bladeRadius;
    const omega = rotorSpeed;
    formulaThrust.innerHTML = `T = 0.13 × 1.225 × π × ${R.toFixed(2)}² × (${omega.toFixed(2)} × ${R.toFixed(2)})²<br>= <strong>${lift.toFixed(1)} N</strong>`;
  }
  
  if (formulaNet) {
    formulaNet.innerHTML = `F<sub>net</sub> = ${lift.toFixed(1)} - ${weight.toFixed(1)} = <strong>${netForce.toFixed(1)} N</strong>`;
  }
  
  if (formulaAccel) {
    formulaAccel.innerHTML = `a = ${netForce.toFixed(1)} / ${mass.toFixed(0)} = <strong>${acc.toFixed(3)} m/s²</strong>`;
  }

  // Update status display
  const statusState = document.getElementById("status-state");
  const statusVelocity = document.getElementById("status-velocity");
  const statusHeight = document.getElementById("status-height");
  const statusLift = document.getElementById("status-lift");
  
  if (statusState) {
    let indicator = "status-grounded";
    let stateText = state;
    
    if (state === "MELAYANG") indicator = "status-hovering";
    else if (state === "NAIK") indicator = "status-climbing";
    else if (state === "TURUN") indicator = "status-descending";
    
    statusState.innerHTML = `<span class="status-indicator ${indicator}"></span>${stateText}`;
  }
  
  if (statusVelocity) statusVelocity.textContent = `${vel.toFixed(2)} m/s`;
  if (statusHeight) statusHeight.textContent = `${pos.toFixed(2)} m`;
  if (statusLift) statusLift.textContent = `${lift.toFixed(0)} N`;
}

// Main animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  controls.update();

  // Update rotor rotation
  if (mainRotor) {
    mainRotor.rotateY(physics.rotorSpeed * delta);
  }

  updateHelicopterPhysics(delta);

  renderer.render(scene, camera);
}
animate();
