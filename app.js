import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/FBXLoader.js';

const container = document.getElementById('app');

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// prefer linear/srgb handling depending on three.js version
if ('outputColorSpace' in renderer) {
	// three r150+ exposes this
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

// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x8d7c6b, 0.8);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(50, 50, 30);
dir.castShadow = true;
// Increase shadow map size for better quality
dir.shadow.mapSize.width = 2048;
dir.shadow.mapSize.height = 2048;
dir.shadow.camera.left = -100;
dir.shadow.camera.right = 100;
dir.shadow.camera.top = 100;
dir.shadow.camera.bottom = -100;
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 200;
scene.add(dir);

// Enable shadows on renderer
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Helpers
// const grid = new THREE.GridHelper(200, 40, 0x333333, 0x222222);
// scene.add(grid);

// const axes = new THREE.AxesHelper(5);
// scene.add(axes);

// ===== HIERARCHICAL SCENE STRUCTURE =====
// Create organized groups following best practices

// Scene root and groups - hierarchical structure
const sceneRoot = new THREE.Group();
sceneRoot.name = 'SceneRoot';
scene.add(sceneRoot);

// Environment Group - contains all static environment objects
const environmentGroup = new THREE.Group();
environmentGroup.name = 'Environment';
sceneRoot.add(environmentGroup);

// Ground plane with grass texture - much larger field
let ground;

// Helicopter Group - contains the helicopter and all its components
const helicopterGroup = new THREE.Group();
helicopterGroup.name = 'HelicopterGroup';
sceneRoot.add(helicopterGroup);

// Physics state (1 scene unit = 1 meter)
let physicsEnabled = true;
let restY = 0;
let velocityY = 0;
let helicopterMass = 1500; // kg
const GRAVITY_ACCEL = -9.81; // m/s^2 (10x Earth gravity for faster visual response)
const RESTITUTION = 0.12;
let externalForceY = 0;

// Promisified loaders so we can wait until both ground and model are ready
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

let helicopterModel = null;
// Detected rotor nodes (populated after FBX load)
let mainRotor = null;

// Animation mixer for FBX animation clips (if present)
let mixer = null;

// Rotor speeds (rpm) - tweakable for visual animation
const MAIN_ROTOR_RPM = 400; // main rotor rotations per minute

// Load both resources and then place the helicopter relative to the ground
Promise.allSettled([
	loadGLTF('./model/grass_texture.glb'),
	loadFBX('./model/MD 902 Explorer.fbx')
]).then((results) => {
	const gltfResult = results[0];
	const fbxResult = results[1];

	// --- Ground / Environment ---
	// ground dimensions in meters
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
			// tile so each texture repeat maps to 1m x 1m on the plane
			grassTexture.repeat.set(groundWidth, groundHeight);
		}
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundHeight, 50, 50);
		const groundMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 });
		ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.name = 'Ground';
		ground.rotation.x = -Math.PI / 2;
		ground.position.y = 0;
		ground.receiveShadow = true;
		environmentGroup.add(ground);
	} else {
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundHeight, 50, 50);
		const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x3a7d44, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0 });
		ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.name = 'Ground';
		ground.rotation.x = -Math.PI / 2;
		ground.position.y = 0;
		ground.receiveShadow = true;
		environmentGroup.add(ground);
	}

	// --- Helicopter ---
	if (fbxResult.status === 'fulfilled') {
		const fbx = fbxResult.value;
		helicopterModel = fbx;
		helicopterModel.name = 'MD902_Model';

		const box = new THREE.Box3().setFromObject(fbx);
		const size = new THREE.Vector3();
		box.getSize(size);
		const center = new THREE.Vector3();
		box.getCenter(center);

		// MD 902 fuselage length ≈ 11m, set scale so largest dimension = 11
		const targetSize = 11;
		const currentSize = Math.max(size.x, size.y, size.z) || 1;
		const scale = targetSize / currentSize;
		helicopterModel.scale.setScalar(scale);

		const groundY = ground ? ground.position.y : 0;
		const clearance = 0.05;
		const halfHeight = (size.y * scale) / 2;
		const centerYScaled = center.y * scale;

		helicopterMass = 1500; // fixed mass (kg)

		restY = groundY + clearance + halfHeight - centerYScaled;
		helicopterGroup.position.set(0, restY + 0.05, 0);
		velocityY = 0;
		console.log('Start Y:', helicopterGroup.position.y.toFixed(2), 'restY:', restY.toFixed(2), 'drop:', (helicopterGroup.position.y - restY).toFixed(2));

		helicopterModel.position.set(0, 0, 0);

		helicopterModel.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;

				// Normalize materials to avoid unexpected transparency from FBX imports
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				materials.forEach((mat) => {
					if (!mat) return;
					mat.transparent = false;
				});
			}
		});

		helicopterGroup.add(helicopterModel);

		// Collect rotor candidates and pick likely main/tail rotors (log details)
		{
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
				console.log('Rotor candidates found:', rotorCandidates.map(c => ({ name: c.name, size: c.size, center: c.center })));

				const modelBox = new THREE.Box3().setFromObject(helicopterModel);
				const modelCenter = new THREE.Vector3(); modelBox.getCenter(modelCenter);

				let mainCandidate = rotorCandidates.find(c => /main|rotor|hub|mast|blade/i.test(c.name));
				if (!mainCandidate) {
					mainCandidate = rotorCandidates.slice().sort((a,b) => {
						const aScore = a.center.y + (a.size.x + a.size.z) * 0.5;
						const bScore = b.center.y + (b.size.x + b.size.z) * 0.5;
						return bScore - aScore;
					})[0];
				}

				if (mainCandidate) { mainRotor = mainCandidate.node; console.log('Assigned mainRotor ->', mainCandidate.name || mainRotor.id); }
			} else {
				console.log('No rotor candidates detected.');
			}
		}
	} else {
		console.error('Error loading helicopter:', fbxResult.reason);
	}}).catch((e) => {
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

// Animation loop
const clock = new THREE.Clock();
function animate() {
	requestAnimationFrame(animate);
	const delta = clock.getDelta();
	const elapsed = clock.getElapsedTime();
	
	// Update controls
	controls.update();

	// Physics integration
	if (physicsEnabled && helicopterGroup && helicopterModel) {
		const gravityForce = helicopterMass * GRAVITY_ACCEL;
		const totalForceY = gravityForce + externalForceY;
		const accY = totalForceY / helicopterMass;
		velocityY += accY * delta;
		helicopterGroup.position.y += velocityY * delta;

		// Ground collision
		if (helicopterGroup.position.y <= restY) {
			if (Math.abs(velocityY) > 0.5) {
				helicopterGroup.position.y = restY;
				velocityY = -velocityY * RESTITUTION;
			} else {
				helicopterGroup.position.y = restY;
				velocityY = 0;
			}
		}
	}
	
	// Update FBX animations
	if (mixer) mixer.update(delta);

	// Rotate detected rotors for visual animation
	if (mainRotor) {
		const mainOmega = (MAIN_ROTOR_RPM * 2 * Math.PI) / 60;
		mainRotor.rotateY(mainOmega * delta);
	}
	
	// Render scene
	renderer.render(scene, camera);
}
animate();