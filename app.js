import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';
import { GLTFLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/FBXLoader.js';

const container = document.getElementById('app');
const hud = document.getElementById("physicsHUD");

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// prefer linear/srgb handling depending on three.js version
if ('outputColorSpace' in renderer) {
	renderer.outputColorSpace = THREE.SRGBColorSpace;
}
container.appendChild(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(25, 12, 35);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground

// buat limit ketinggian kamera yang menggunakan PAN
const MIN_CAMERA_Y = 0.2;
controls.addEventListener('change', () => {
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
sceneRoot.name = 'SceneRoot';
scene.add(sceneRoot);

const environmentGroup = new THREE.Group();
environmentGroup.name = 'Environment';
sceneRoot.add(environmentGroup);

// Ground and helicopter groups
let ground;
const helicopterGroup = new THREE.Group();
helicopterGroup.name = 'HelicopterGroup';
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
    liftForce: 0,     // 0..100 (UI)
    rotorSpeed: 0     // angular speed in rad/s (computed from lift or UI mapping)
};

const helicopterMass = 150; 

const LIFT_THRESHOLD = 30;     // lift threshold for producing upward force
const MAX_ROTOR_SPEED = 50;    // max rotor angular speed (rad/s) used for visuals

let verticalVelocity = 0;      // m/s-like unit (scene units per second)
// const GRAVITY = -9.81 * 0.15;  // tuned gravity (scaled for visual feel)
// const LIFT_MULTIPLIER = 0.12;  // tuned multiplier to convert (liftForce - threshold) -> upward accel
// const DRAG = 0.96;             // velocity damping per frame (0..1)
// const MAX_UP_VELOCITY = 6.0;   // clamp upward speed (scene units / s)
// const MAX_DOWN_VELOCITY = -10.0; // clamp downward speed

let restY = 0;            // HEIGHT of helicopter on ground
let helicopterLoaded = false;

// GUI
const gui = new GUI();
const heliFolder = gui.addFolder('Helicopter Controls');

// liftForce 0..100
heliFolder.add(physics, 'liftForce', 0, 100, 1)
    .name('Lift Force')
    .onChange(v => {
        // map liftForce to rotorSpeed visually (for immediate feedback)
        physics.rotorSpeed = (v / 100) * MAX_ROTOR_SPEED;
    });

// rotorSpeed read-only display
heliFolder.add(physics, 'rotorSpeed').name('Rotor Speed (rad/s)').listen();
heliFolder.open();

// Rotor RPM constant for legacy visual rotation (kept for reference)
const MAIN_ROTOR_RPM = 400;

// Load resources and setup scene
Promise.allSettled([
	loadGLTF('./model/grass_texture.glb'),
	loadFBX('./model/MD 902 Explorer.fbx')
]).then((results) => {
	const gltfResult = results[0];
	const fbxResult = results[1];

	// Ground
	const groundWidth = 500;
	const groundHeight = 500;

	if (gltfResult.status === 'fulfilled') {
		const gltf = gltfResult.value;
		let grassTexture = null;
		gltf.scene.traverse((child) => {
			if (child.isMesh && child.material && child.material.map) grassTexture = child.material.map;
		});
		if (grassTexture) {
			grassTexture.wrapS = THREE.RepeatWrapping;
			grassTexture.wrapT = THREE.RepeatWrapping;
			grassTexture.repeat.set(groundWidth, groundHeight);
		}
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundHeight, 50, 50);
		const groundMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 });
		ground = new THREE.Mesh(groundGeometry, groundMaterial);
	} else {
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundHeight, 50, 50);
		const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x3a7d44, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0 });
		ground = new THREE.Mesh(groundGeometry, groundMaterial);
	}

	ground.name = 'Ground';
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = 0;
	ground.receiveShadow = true;
	environmentGroup.add(ground);

	// Helicopter
	if (fbxResult.status === 'fulfilled') {
		const fbx = fbxResult.value;
		helicopterModel = fbx;
		helicopterModel.name = 'MD902_Model';

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
        helicopterLoaded = true;
		verticalVelocity = 0;

		helicopterModel.position.set(0, 0, 0);

		helicopterModel.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				materials.forEach((mat) => { if (!mat) return; mat.transparent = false; });
			}
		});

		helicopterGroup.add(helicopterModel);

		// auto-detect rotor candidates
		const rotorCandidates = [];
		helicopterModel.traverse((child) => {
			if (!child) return;
			if (child.isMesh || child.type === 'Group' || child.type === 'Object3D') {
				const box = new THREE.Box3().setFromObject(child);
				const size = new THREE.Vector3();
				box.getSize(size);
				const center = new THREE.Vector3();
				box.getCenter(center);
				rotorCandidates.push({ node: child, name: child.name || '', size, center });
			}
		});

		if (rotorCandidates.length) {
			let mainCandidate = rotorCandidates.find(c => /main|rotor|hub|mast|blade/i.test(c.name));
			if (!mainCandidate) {
				mainCandidate = rotorCandidates.slice().sort((a,b) => {
					const aScore = a.center.y + (a.size.x + a.size.z) * 0.5;
					const bScore = b.center.y + (b.size.x + b.size.z) * 0.5;
					return bScore - aScore;
				})[0];
			}
			if (mainCandidate) {
				mainRotor = mainCandidate.node;
				console.log('Assigned mainRotor ->', mainCandidate.name || mainRotor.id);
			}
		} else {
			console.log('No rotor candidates detected.');
		}
	} else {
		console.error('Error loading helicopter:', fbxResult.reason);
	}
}).catch((e) => {
	console.error('Error loading resources:', e);
});

// Resize handling
function onWindowResize() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
}
window.addEventListener('resize', onWindowResize, false);

// Physics update function (best practice velocity-based)
function updateHelicopterPhysics(delta) {

    // pastikan helikopter sudah load
    if (!helicopterLoaded || !helicopterGroup) return;

    // baca nilai dari GUI
    const liftInput = physics.liftForce;

    // LIFT = input × koefisien
    const lift = liftInput * 15; // gaya ke atas

    // GRAVITY
    const gravity = helicopterMass * 9.8;

    // AIR DRAG (penting agar tidak memantul!)
    const drag = Math.abs(verticalVelocity) * 8;

    // NET FORCE
    const netForce = lift - gravity - drag;

    // ACCELERATION
    const acc = netForce / helicopterMass;

    // UPDATE VELOCITY
    verticalVelocity += acc * delta;

    // UPDATE POSITION
    helicopterGroup.position.y += verticalVelocity * delta * 60;

    // COLLISION
    if (helicopterGroup.position.y < restY) {
        helicopterGroup.position.y = restY;
        verticalVelocity = 0;
    }

    // STATE STATUS
    let state = "Hover ≈";
    if (netForce > 50) state = "Rising ↑";
    else if (netForce < -50) state = "Falling ↓";

    // UPDATE HUD
    updateHUD({
        lift,
        weight: gravity,
        drag,
        netForce,
        acc,
        vel: verticalVelocity,
        pos: helicopterGroup.position.y,
        state
    });
}

function updateHUD(params) {
    const { lift, weight, drag, netForce, acc, vel, pos, state } = params;

    hud.textContent =
`--- HELICOPTER PHYSICS ---
Lift Force : ${lift.toFixed(2)} N
Gravity    : ${weight.toFixed(2)} N
Drag       : ${drag.toFixed(2)} N
---------------------------
Net Force  : ${netForce.toFixed(2)} N
Accel      : ${acc.toFixed(2)} m/s²
Velocity   : ${vel.toFixed(2)} m/s
Height     : ${pos.toFixed(2)} m
---------------------------
State      : ${state}

Hukum Aktif:
✓ Newton II  (F = m a)
✓ Newton III (Lift reaction)
✓ Gravity    (mg)
✓ Drag       (air damping)
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
