import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";
import { GLTFLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/FBXLoader.js";

const container = document.getElementById("app");
const hud = document.getElementById("physicsHUD");
// ensure the HUD is positioned below the GUI controls so it isn't overlapped
if (hud && hud.style) {
  // move HUD lower
  hud.style.top = "230px";
}

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// prefer linear/srgb handling depending on three.js version
if ("outputColorSpace" in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
container.appendChild(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue background

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(25, 12, 35);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground

// buat limit ketinggian kamera yang menggunakan PAN
const MIN_CAMERA_Y = 0.2;
controls.addEventListener("change", () => {
  if (camera.position.y < MIN_CAMERA_Y) {
    camera.position.y = MIN_CAMERA_Y;
  }
});

// Lights
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

// ===== HIERARCHICAL SCENE STRUCTURE =====
const sceneRoot = new THREE.Group();
sceneRoot.name = "SceneRoot";
scene.add(sceneRoot);

const environmentGroup = new THREE.Group();
environmentGroup.name = "Environment";
sceneRoot.add(environmentGroup);

// Ground and helicopter groups
let ground;
const helicopterGroup = new THREE.Group();
helicopterGroup.name = "HelicopterGroup";
sceneRoot.add(helicopterGroup);

// loaders
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}
function loadFBX(url) {
  return new Promise((resolve, reject) => {
    fbxLoader.load(url, resolve, undefined, reject);
  });
}

// helicopter model objects
let helicopterModel = null;

let mainRotor = null;
let mixer = null;

// Physics / flight state (BEST PRACTICE)
const physics = {
  liftForce: 0, // 0..100 (UI)
  rotorSpeed: 0, // angular speed in rad/s (computed from lift or UI mapping)
  mass: 2000, // helicopter mass in kg
  a: 0, // actual acceleration (m/s^2)
  desiredA: 0, // desired acceleration (m/s^2)
  bladeRadius: 4.5, // rotor blade radius (m)
};

// Base mass that corresponds to the current visual size
const BASE_MASS = 2000;
// Physical constants for rotor thrust model
const AIR_DENSITY = 1.225; // kg/m^3 (sea level)
// Thrust coefficient (tunable). Chosen so MAX_ROTOR_SPEED can generate reasonable thrust.
const THRUST_COEFF = 0.13;
// guard to avoid recursive GUI handler updates
let suppressHandlers = false;

// keep a reference to the desired-acc GUI controller so we can update its display
let desiredAController = null;

// track previous mass (used earlier in logic)
let lastMass = physics.mass;

const MAX_ROTOR_SPEED = 50; // max rotor angular speed (rad/s) used for visuals

let verticalVelocity = 0; // m/s-like unit (scene units per second)

let restY = 0; // HEIGHT of helicopter on ground
let helicopterLoaded = false;

// GUI
const gui = new GUI();
const heliFolder = gui.addFolder("Helicopter Controls");

// liftForce is in Newtons
heliFolder
  .add(physics, "liftForce", 0, 30000, 1)
  .name("Lift Force (N)")
  .onChange((v) => {
    if (suppressHandlers) return;
    suppressHandlers = true;
    // User directly changed total thrust (N). Recompute rotorSpeed required
    // from T = Ct * rho * A * (omega * R)^2. If required omega exceeds
    // MAX_ROTOR_SPEED clamp and update liftForce to achievable thrust.
    const T = v <= 0 ? 0 : v;
    const R = physics.bladeRadius;
    const A = Math.PI * R * R;
    const denom = THRUST_COEFF * AIR_DENSITY * A;
    let omegaReq = 0;
    if (denom > 0 && R > 0) {
      omegaReq = Math.sqrt(Math.max(0, T / denom)) / R;
    }
    let saturated = false;
    let omega = omegaReq;
    if (omegaReq > MAX_ROTOR_SPEED) {
      saturated = true;
      omega = MAX_ROTOR_SPEED;
      // compute achievable thrust at clamped omega
      const vtip = omega * R;
      const achievableT = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
      physics.liftForce = achievableT;
    } else {
      physics.liftForce = T;
    }
    physics.rotorSpeed = omega;
    // recompute acceleration for display
    const drag = Math.abs(verticalVelocity) * 8;
    physics.a = (physics.liftForce - physics.mass * 9.8 - drag) / physics.mass;
    // update desiredA display to reflect current achievable acceleration
    if (desiredAController) {
      physics.desiredA = physics.a;
      desiredAController.setValue(physics.desiredA);
    }
    suppressHandlers = false;
  })
  .listen();

// Rotor Controls folder (rotor speed and blade radius and desired acceleration)
const rotorFolder = gui.addFolder("Rotor Controls");

// rotorSpeed: changing rotorSpeed updates liftForce and acceleration
rotorFolder
  .add(physics, "rotorSpeed", 0, MAX_ROTOR_SPEED, 0.1)
  .name("Rotor Speed (rad/s)")
  .onChange((v) => {
    if (suppressHandlers) return;
    suppressHandlers = true;
    // compute thrust T = Ct * rho * A * (omega * R)^2
    const R = physics.bladeRadius;
    const A = Math.PI * R * R;
    const vtip = v * R;
    const T = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
    physics.liftForce = T;
    // compute acceleration a = (T - m*g - drag) / m
    const drag = Math.abs(verticalVelocity) * 8;
    physics.a = (T - physics.mass * 9.8 - drag) / physics.mass;
    // update desiredA display to reflect current achievable acceleration
    if (desiredAController) {
      physics.desiredA = physics.a;
      desiredAController.setValue(physics.desiredA);
    }
    suppressHandlers = false;
  })
  .listen();

// blade radius control: changing R updates thrust and acceleration (rotorSpeed kept)
rotorFolder
  .add(physics, "bladeRadius", 2, 10, 0.5)
  .name("Blade Radius (m)")
  .onChange((v) => {
    if (suppressHandlers) return;
    suppressHandlers = true;
    const R = v;
    const A = Math.PI * R * R;
    const omega = physics.rotorSpeed;
    const vtip = omega * R;
    const T = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
    physics.liftForce = T;
    const drag = Math.abs(verticalVelocity) * 8;
    physics.a = (T - physics.mass * 9.8 - drag) / physics.mass;
    // update desiredA display to reflect current achievable acceleration
    if (desiredAController) {
      physics.desiredA = physics.a;
      desiredAController.setValue(physics.desiredA);
    }
    // Update rotor visual scale to reflect blade radius change (X/Z axes)
    if (mainRotor && mainRotor.userData && mainRotor.userData.baseRadius) {
      const baseR = mainRotor.userData.baseRadius || 1;
      const baseScale =
        mainRotor.userData.baseScale || new THREE.Vector3(1, 1, 1);
      // scale factor relative to stored base radius
      const scaleFactor = R / baseR;
      mainRotor.scale.set(
        baseScale.x * scaleFactor,
        baseScale.y,
        baseScale.z * scaleFactor
      );
    }
    suppressHandlers = false;
  })
  .listen();

// desired acceleration control: changing a adjusts rotorSpeed to reach that acceleration
rotorFolder;
// store controller reference so other handlers can update its displayed value
desiredAController = rotorFolder
  .add(physics, "desiredA", 0, 20, 0.01)
  .name("Desired Acc (m/s²)")
  .onChange((v) => {
    if (suppressHandlers) return;
    suppressHandlers = true;
    // when user sets a desired acceleration, compute required rotor speed
    const desiredA = v;
    const drag = Math.abs(verticalVelocity) * 8;
    // required thrust T = m*(a + g) + drag
    const requiredT = physics.mass * (desiredA + 9.8) + drag;
    // compute omega = sqrt(T / (Ct * rho * A)) / R
    const R = physics.bladeRadius;
    const A = Math.PI * R * R;
    let omega = 0;
    if (THRUST_COEFF * AIR_DENSITY * A * (R * R) > 0) {
      omega = Math.sqrt(requiredT / (THRUST_COEFF * AIR_DENSITY * A)) / R;
    }
    // clamp omega
    if (omega > MAX_ROTOR_SPEED) omega = MAX_ROTOR_SPEED;
    physics.rotorSpeed = Math.max(0, Math.min(MAX_ROTOR_SPEED, omega));
    // derive liftForce from rotorSpeed (do not directly set lift to requiredT)
    const vtip = physics.rotorSpeed * R;
    physics.liftForce = THRUST_COEFF * AIR_DENSITY * A * (vtip * vtip);
    // actual acceleration will be computed each physics tick and stored in physics.a
    suppressHandlers = false;
  })
  .listen();

rotorFolder.open();

// Add mass control to GUI (kg)
heliFolder
  .add(physics, "mass", 100, 5000, 10)
  .name("Mass (kg)")
  .onChange((v) => {
    // When mass changes DO NOT modify liftForce automatically.
    // Only update mass and recompute acceleration from the current lift.
    if (suppressHandlers) return;
    suppressHandlers = true;
    const newMass = v <= 0 ? 1 : v;
    physics.mass = newMass;
    // recompute acceleration using the existing liftForce (unchanged)
    const dragNow = Math.abs(verticalVelocity) * 8;
    physics.a =
      (physics.liftForce - physics.mass * 9.8 - dragNow) / physics.mass;
    // update desiredA display because changing mass affects achievable accel
    if (desiredAController) {
      physics.desiredA = physics.a;
      desiredAController.setValue(physics.desiredA);
    }
    lastMass = physics.mass;
    suppressHandlers = false;
  });

// Rotor RPM constant for legacy visual rotation (kept for reference)
const MAIN_ROTOR_RPM = 400;

// Load resources and setup scene
Promise.allSettled([
  loadGLTF("./model/grass_texture.glb"),
  loadFBX("./model/MD 902 Explorer.fbx"),
])
  .then((results) => {
    const gltfResult = results[0];
    const fbxResult = results[1];

    // Ground
    const groundWidth = 500;
    const groundHeight = 500;

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

    ground.name = "Ground";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    environmentGroup.add(ground);

    // Helicopter
    if (fbxResult.status === "fulfilled") {
      const fbx = fbxResult.value;
      helicopterModel = fbx;
      helicopterModel.name = "MD902_Model";

      // Normalize scale to target length ~11
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      const targetSize = 11;
      const currentSize = Math.max(size.x, size.y, size.z) || 1;
      const scale = targetSize / currentSize;
      helicopterModel.scale.setScalar(scale);

      // Compute restY so model sits on ground
      const groundY = ground ? ground.position.y : 0;
      const clearance = 0.05;
      const halfHeight = (size.y * scale) / 2;
      const centerYScaled = center.y * scale;

      // restY is world Y where helicopterGroup should be when touching ground
      restY = groundY + clearance + halfHeight - centerYScaled;
      helicopterGroup.position.set(0, restY + 0.05, 0);
      // store metadata needed to keep ground contact when we change visual scale
      helicopterGroup.userData = helicopterGroup.userData || {};
      helicopterGroup.userData.groundY = groundY;
      helicopterGroup.userData.clearance = clearance;
      helicopterGroup.userData.baseRestOffset = restY - (groundY + clearance);
      helicopterGroup.userData.currentRestY = restY;
      helicopterGroup.userData.baseModelScale = scale;
      helicopterLoaded = true;
      verticalVelocity = 0;

      helicopterModel.position.set(0, 0, 0);

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

      // auto-detect rotor candidates
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
          // store base radius and base scale for visual blade scaling
          mainRotor.userData = mainRotor.userData || {};
          const estimatedRadius =
            Math.max(mainCandidate.size.x, mainCandidate.size.z) / 2 || 1;
          mainRotor.userData.baseRadius = estimatedRadius;
          mainRotor.userData.baseScale = mainRotor.scale.clone();
          console.log(
            "Assigned mainRotor ->",
            mainCandidate.name || mainRotor.id,
            "baseRadius=",
            estimatedRadius
          );
        }
      } else {
        console.log("No rotor candidates detected.");
      }
    } else {
      console.error("Error loading helicopter:", fbxResult.reason);
    }
  })
  .catch((e) => {
    console.error("Error loading resources:", e);
  });

// Resize handling
function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", onWindowResize, false);

// Physics update function (best practice velocity-based)
function updateHelicopterPhysics(delta) {
  // pastikan helikopter sudah load
  if (!helicopterLoaded || !helicopterGroup) return;

  // --- Visual scaling based on mass ---
  // scale factor uses cubic root to approximate linear dimensions from mass (volume ~ mass)
  if (
    helicopterGroup.userData &&
    typeof helicopterGroup.userData.baseRestOffset !== "undefined"
  ) {
    let scaleFactor = Math.cbrt(physics.mass / BASE_MASS);
    // clamp scale to reasonable bounds to avoid extreme visuals
    scaleFactor = Math.max(0.2, Math.min(5, scaleFactor));
    const prevScale = helicopterGroup.scale.x;
    if (Math.abs(scaleFactor - prevScale) > 1e-4) {
      const oldRestY = helicopterGroup.userData.currentRestY || restY;
      const newRestY =
        helicopterGroup.userData.groundY +
        helicopterGroup.userData.clearance +
        helicopterGroup.userData.baseRestOffset * scaleFactor;
      const deltaY = newRestY - oldRestY;
      // apply vertical adjustment so helicopter keeps proper ground contact visually
      helicopterGroup.position.y += deltaY;
      // update global restY used in collision checks so physics uses new ground contact
      restY = newRestY;
      helicopterGroup.userData.currentRestY = newRestY;
      helicopterGroup.scale.setScalar(scaleFactor);
      // ensure not clipping into ground after scale change
      if (helicopterGroup.position.y < restY) {
        helicopterGroup.position.y = restY;
        verticalVelocity = 0;
      }
    }
  }

  // baca nilai dari GUI
  const liftInput = physics.liftForce;

  // LIFT = input × koefisien
  // liftForce is already specified in N (no extra multiplier)
  const lift = liftInput; // gaya ke atas (N)

  // GRAVITY (weight = m * g)
  const gravity = physics.mass * 9.8;

  // AIR DRAG (penting agar tidak memantul!)
  const drag = Math.abs(verticalVelocity) * 8;

  // NET FORCE
  const netForce = lift - gravity - drag;

  // ACCELERATION (actual)
  let acc = netForce / physics.mass;

  // If helicopter is resting on the ground and the net force would pull it down,
  // the ground reaction prevents downward acceleration: actual accel = 0.
  const onGround = helicopterGroup.position.y <= restY + 1e-4;
  if (onGround && Math.abs(verticalVelocity) < 1e-6 && netForce <= 0) {
    acc = 0;
  }

  // UPDATE VELOCITY
  verticalVelocity += acc * delta;

  // UPDATE POSITION
  helicopterGroup.position.y += verticalVelocity * delta * 60;

  // COLLISION
  if (helicopterGroup.position.y < restY) {
    helicopterGroup.position.y = restY;
    verticalVelocity = 0;
  }

  // update actual acceleration state value for display/handlers
  physics.a = acc;

  // STATE STATUS
  let state = "Hover ≈";
  if (netForce > 50) state = "Rising ↑";
  else if (netForce < -50) state = "Falling ↓";

  // rotor saturation indicator (useful when required omega exceeds limits)
  const rotorSaturated = physics.rotorSpeed >= MAX_ROTOR_SPEED - 1e-6;

  // UPDATE HUD
  updateHUD({
    lift,
    mass: physics.mass,
    weight: gravity,
    drag,
    netForce,
    acc,
    vel: verticalVelocity,
    pos: helicopterGroup.position.y,
    desiredA: physics.a,
    rotorSaturated,
    state,
  });
}

function updateHUD(params) {
  const {
    lift,
    mass,
    weight,
    drag,
    netForce,
    acc,
    vel,
    pos,
    state,
    desiredA,
    rotorSaturated,
  } = params;

  hud.textContent = `--- HELICOPTER PHYSICS ---
Lift Force : ${lift.toFixed(2)} N
Mass       : ${mass.toFixed(2)} kg
Weight     : ${weight.toFixed(2)} N
Drag       : ${drag.toFixed(2)} N
---------------------------
Net Force  : ${netForce.toFixed(2)} N
Current Acc: ${acc.toFixed(2)} m/s²
Velocity   : ${vel.toFixed(2)} m/s
Height     : ${pos.toFixed(2)} m
---------------------------
State      : ${state}

${pos <= restY + 0.01 ? "✓ Ground Collision" : "Ground Collision: OFF"}
`;
}

// Animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Update controls
  controls.update();

  // Update rotor visual from physics.rotorSpeed
  if (mainRotor) {
    // rotor spin using physics.rotorSpeed (rad/s) * delta
    mainRotor.rotateY(physics.rotorSpeed * delta);
  } else {
    // fallback spin using MAIN_ROTOR_RPM if physics.rotorSpeed is zero (visual)
    // convert rpm to rad/s: rpm * 2π / 60
    const mainOmega = (MAIN_ROTOR_RPM * 2 * Math.PI) / 60;
    if (mainRotor) mainRotor.rotateY(mainOmega * delta);
  }

  // Update flight physics
  updateHelicopterPhysics(delta);

  // Update mixer if any animations present
  if (mixer) mixer.update(delta);

  // Render
  renderer.render(scene, camera);
}
animate();
