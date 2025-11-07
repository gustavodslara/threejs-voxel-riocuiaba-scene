import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Basic scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc4d4b8); // soft daylight background
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1)); // cap for perf
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

camera.position.set(0, 12, -40);
camera.lookAt(0, 12, -20);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 12, -20);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lights
scene.add(new THREE.AmbientLight(0xd4c4a8, 0.7));
const dirLight = new THREE.DirectionalLight(0xfff4d4, 0.9);
dirLight.position.set(15, 25, 10);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// Voxel + materials
const VOXEL_SIZE = 1;
const voxelGeometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const materials = {
    grass: new THREE.MeshLambertMaterial({ color: 0x6a9c4d }),
    darkGrass: new THREE.MeshLambertMaterial({ color: 0x5a8a3d }),
    moss: new THREE.MeshLambertMaterial({ color: 0x7aaa5d }),
    dirt: new THREE.MeshLambertMaterial({ color: 0x7d5a3a }),
    mud: new THREE.MeshLambertMaterial({ color: 0x6a4d2a }),
    woodDark: new THREE.MeshLambertMaterial({ color: 0x5a4a3a }),
    leaves: new THREE.MeshLambertMaterial({ color: 0x4a6a3a }),
    leavesDense: new THREE.MeshLambertMaterial({ color: 0x3a5a2a }),
    leavesLight: new THREE.MeshLambertMaterial({ color: 0x6a8a4a }),
    leavesYellow: new THREE.MeshLambertMaterial({ color: 0x9aaa5a }),
    vine: new THREE.MeshLambertMaterial({ color: 0x5a6a4a }),
    hangingMoss: new THREE.MeshLambertMaterial({ color: 0x7a8a6a }),
    lilyPad: new THREE.MeshLambertMaterial({ color: 0x4a7a4a })
};

    // Skybox helpers
    function setSkyboxFromCubemap(files) {
        // files order: [px, nx, py, ny, pz, nz]
        const loader = new THREE.CubeTextureLoader();
        const cube = loader.load(files);
        cube.colorSpace = THREE.SRGBColorSpace;
        scene.background = cube;
        return cube;
    }
    function setSkyboxFromEquirect(url) {
        const loader = new THREE.TextureLoader();
        const tex = loader.load(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
        return tex;
    }

// Instancing infra
const instancedMeshes = {};
const MAX_INSTANCES = 50000;
function createInstancedMeshBatch(matName) {
    const mesh = new THREE.InstancedMesh(voxelGeometry, materials[matName], MAX_INSTANCES);
    mesh.castShadow = false; // perf: no per-voxel shadow casting
    mesh.receiveShadow = true;
    mesh.count = 0; // track used slots manually
    instancedMeshes[matName].meshes.push(mesh);
    return mesh;
}
function initializeInstancedMeshes() {
    Object.keys(materials).forEach(name => {
        instancedMeshes[name] = { meshes: [], total: 0 };
        createInstancedMeshBatch(name);
    });
}
const tempMatrix = new THREE.Matrix4();
function addVoxelInstance(x, y, z, matName) {
    const bucket = instancedMeshes[matName];
    if (!bucket) return;
    let mesh = bucket.meshes[bucket.meshes.length - 1];
    if (!mesh || mesh.count >= MAX_INSTANCES) mesh = createInstancedMeshBatch(matName);
    tempMatrix.setPosition(x, y, z);
    mesh.setMatrixAt(mesh.count, tempMatrix);
    mesh.count++;
    bucket.total++;
}
function createVoxel(x, y, z, material) { return { x, y, z, material }; }
function addVoxelsToScene(voxels) {
    voxels.forEach(v => {
        const matName = Object.keys(materials).find(k => materials[k] === v.material);
        if (matName) addVoxelInstance(v.x, v.y, v.z, matName);
    });
}

// Water surface
function createWaterPlane() {
    const geom = new THREE.PlaneGeometry(100, 100);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb8945c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const water = new THREE.Mesh(geom, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    water.renderOrder = 2; // above fog layers
    return water;
}

// Underwater vertical fog (stacked planes)
function createUnderwaterFogLayers() {
    const group = new THREE.Group();
    const RIVER_WIDTH = 52;
    const RIVER_LENGTH = 125;
    const SURFACE_Y = 0;
    const BOTTOM_Y = -26;
    const LAYERS = 28;
    const COLOR = 0x5b4a33;
    for (let i = 0; i < LAYERS; i++) {
        const t = (i + 1) / LAYERS;
        const y = THREE.MathUtils.lerp(SURFACE_Y, BOTTOM_Y, t);
        const depthFactor = t * t * (0.85 + t * 0.15);
        const opacity = Math.min(0.20, 0.06 + depthFactor * 0.22);
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(RIVER_WIDTH, RIVER_LENGTH),
            new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthWrite: false })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = y;
        plane.renderOrder = 1; // below water surface
        group.add(plane);
    }
    return group;
}

// Terrain (thin shell for land, solid fill for riverbed to avoid gaps)
function createTerrain() {
    const voxels = [];
    const heightMap = {};
    const FOUNDATION_DEPTH = -25;
    const WATER_LEVEL = 0;
    const RIVER_HALF_WIDTH = 20;
    for (let z = -50; z <= 50; z++) {
        for (let x = -50; x <= 50; x++) {
            const bankWaveLeft = Math.floor(Math.sin(z * 0.2) * 2);
            const bankWaveRight = Math.floor(Math.sin(z * 0.2) * 2);
            const leftEdge = -RIVER_HALF_WIDTH + bankWaveLeft;
            const rightEdge = RIVER_HALF_WIDTH + bankWaveRight;
            const inRiver = x > leftEdge && x < rightEdge;
            if (inRiver) {
                const distLeft = Math.abs(x - leftEdge);
                const distRight = Math.abs(x - rightEdge);
                const distCenter = Math.abs(x);
                const edgeDist = Math.min(distLeft, distRight);
                const depthVariation = Math.floor(Math.sin(z * 0.15) * 2);
                let top;
                if (edgeDist <= 2) top = -2 + depthVariation;
                else if (edgeDist <= 4) top = -5 + depthVariation;
                else if (distCenter < 5) top = -18 + depthVariation;
                else if (distCenter < 10) top = -14 + depthVariation;
                else if (distCenter < 15) top = -10 + depthVariation;
                else top = -7 + depthVariation;
                for (let y = FOUNDATION_DEPTH; y <= top; y++) {
                    const mat = y >= top - 2 ? materials.mud : materials.dirt;
                    voxels.push(createVoxel(x, y, z, mat));
                }
            } else {
                const distFromRiver = x <= leftEdge ? leftEdge - x : x - rightEdge;
                let surface;
                if (distFromRiver === 0) surface = -2;
                else if (distFromRiver === 1) surface = -1;
                else if (distFromRiver === 2) surface = 0;
                else if (distFromRiver < 5) surface = 1;
                else {
                    const base = Math.floor((distFromRiver - 5) / 2.5) + 2;
                    surface = Math.min(10, base + Math.floor(Math.random() * 2));
                }
                if (surface > 0) heightMap[`${x},${z}`] = surface;
                const startY = Math.max(FOUNDATION_DEPTH, surface - 2);
                for (let y = startY; y <= surface; y++) {
                    let mat;
                    if (y === surface && surface > WATER_LEVEL) mat = Math.random() > 0.5 ? materials.grass : materials.darkGrass;
                    else if (y === surface && surface <= WATER_LEVEL) mat = materials.mud;
                    else if (y < 0 && y > surface - 3) mat = materials.mud;
                    else mat = materials.dirt;
                    voxels.push(createVoxel(x, y, z, mat));
                }
                if (Math.random() > 0.7 && surface > WATER_LEVEL) voxels.push(createVoxel(x, surface, z, materials.moss));
            }
        }
    }
    return { voxels, heightMap };
}

// Trees & vegetation
function createTreeRoots(x, z) {
    const voxels = [];
    const count = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const len = Math.floor(Math.random() * 3) + 2;
        for (let j = 0; j < len; j++) {
            const rx = x + Math.floor(Math.cos(angle) * j);
            const rz = z + Math.floor(Math.sin(angle) * j);
            const ry = 1 - j * 0.5;
            if (ry >= 0) voxels.push(createVoxel(rx, ry, rz, materials.woodDark));
        }
    }
    return voxels;
}
function createTreeTrunk(x, z, groundY, height, thickness, roots) {
    const voxels = [];
    if (roots) createTreeRoots(x, z).forEach(r => voxels.push(r));
    for (let y = 0; y < height; y++) {
        for (let dx = 0; dx < thickness; dx++) {
            for (let dz = 0; dz < thickness; dz++) {
                voxels.push(createVoxel(x + dx, groundY + y, z + dz, materials.woodDark));
            }
        }
    }
    return voxels;
}
function createTreeFoliage(cx, topY, cz, radius, type) {
    const voxels = [];
    const layers = type === 'mega' ? 7 : type === 'large' ? 5 : type === 'small' ? 3 : 4;
    for (let layer = 0; layer < layers; layer++) {
        const r = radius - layer * 0.5;
        const y = topY + layer;
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist <= r && Math.random() > 0.15) {
                    const rand = Math.random();
                    let mat = materials.leavesDense;
                    if (rand > 0.7) mat = materials.leavesLight; else if (rand > 0.5) mat = materials.leavesYellow; else if (rand > 0.3) mat = materials.leaves;
                    voxels.push(createVoxel(cx + dx, y, cz + dz, mat));
                }
            }
        }
    }
    const mossCount = type === 'mega' ? 16 : type === 'large' ? 12 : type === 'small' ? 4 : 8;
    for (let i = 0; i < mossCount; i++) {
        const ang = (Math.PI * 2 * i) / mossCount + Math.random() * 0.5;
        const dist = Math.random() * (radius - 1);
        const mx = cx + Math.floor(Math.cos(ang) * dist);
        const mz = cz + Math.floor(Math.sin(ang) * dist);
        const len = type === 'mega' ? Math.floor(Math.random() * 6) + 4 : Math.floor(Math.random() * 4) + 2;
        for (let j = 0; j < len; j++) {
            const mat = j % 2 === 0 ? materials.hangingMoss : materials.vine;
            voxels.push(createVoxel(mx, topY - j - 1, mz, mat));
        }
    }
    return voxels;
}
function createTwistedBranches(x, z, groundY, height, branchCount) {
    const voxels = [];
    const trunkStraight = Math.floor(height * 0.4);
    for (let y = 0; y < trunkStraight; y++) voxels.push(createVoxel(x, groundY + y, z, materials.woodDark));
    const remaining = height - trunkStraight;
    for (let b = 0; b < branchCount; b++) {
        const ang = (Math.PI * 2 * b) / branchCount + Math.random() * 0.5;
        let cx = x, cz = z;
        for (let y = 0; y < remaining; y++) {
            const actualY = trunkStraight + y;
            voxels.push(createVoxel(Math.round(cx), groundY + actualY, Math.round(cz), materials.woodDark));
            const spread = y / remaining;
            cx += Math.cos(ang) * 0.4 * (1 + spread);
            cz += Math.sin(ang) * 0.4 * (1 + spread);
            if (y > remaining * 0.3) {
                for (let lx = -1; lx <= 1; lx++) {
                    for (let lz = -1; lz <= 1; lz++) {
                        if (Math.random() > 0.4) {
                            const leafMat = Math.random() > 0.5 ? materials.leaves : materials.leavesDense;
                            voxels.push(createVoxel(Math.round(cx) + lx, groundY + actualY, Math.round(cz) + lz, leafMat));
                        }
                    }
                }
            }
        }
    }
    return voxels;
}
function createTree(x, z, groundY, trunkHeight, foliageRadius, type, roots, twisted) {
    const voxels = [];
    if (twisted) {
        voxels.push(...createTwistedBranches(x, z, groundY, trunkHeight, Math.floor(Math.random() * 2) + 2));
        const topY = groundY + trunkHeight;
        for (let ly = 0; ly < 2; ly++) {
            const r = foliageRadius - ly;
            const y = topY + ly;
            for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
                for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if (dist <= r && Math.random() > 0.2) {
                        const leafMat = Math.random() > 0.5 ? materials.leaves : materials.leavesDense;
                        voxels.push(createVoxel(x + dx, y, z + dz, leafMat));
                    }
                }
            }
        }
    } else {
        const thickness = type === 'large' ? 2 : type === 'mega' ? 3 : 1;
        voxels.push(...createTreeTrunk(x, z, groundY, trunkHeight, thickness, roots));
        voxels.push(...createTreeFoliage(x + (thickness > 1 ? 0.5 : 0), groundY + trunkHeight, z + (thickness > 1 ? 0.5 : 0), foliageRadius, type));
    }
    return voxels;
}
function populateForest(heightMap) {
    const voxels = [];
    const occupied = new Set();
    function tooClose(x, z, r) {
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (occupied.has(`${x+dx},${z+dz}`)) return true;
        return false;
    }
    function mark(x, z, r) { for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) occupied.add(`${x+dx},${z+dz}`); }
    for (let x = -50; x <= 50; x += 2) {
        for (let z = -50; z <= 50; z += 2) {
            const h = heightMap[`${x},${z}`];
            if (h === undefined || h <= 0) continue;
            const distRiver = Math.abs(x);
            let prob = distRiver < 23 ? 0.18 : distRiver < 30 ? 0.28 : distRiver < 40 ? 0.36 : 0.30;
            const noiseX = Math.sin(x * 0.3) * Math.cos(z * 0.2);
            const noiseZ = Math.cos(x * 0.2) * Math.sin(z * 0.3);
            if (noiseX * noiseZ > 0.7) prob *= 0.3;
            if (Math.random() < prob) {
                const r = Math.random();
                let type, trunkHeight, foliageRadius, roots, spacing, twisted;
                if (r < 0.12) { type='mega'; trunkHeight=Math.floor(Math.random()*6)+18; foliageRadius=Math.floor(Math.random()*2)+7; roots=Math.random()<0.6; spacing=8; twisted=false; }
                else if (r < 0.30) { type='large'; trunkHeight=Math.floor(Math.random()*5)+13; foliageRadius=Math.floor(Math.random()*2)+5; roots=distRiver<23?true:Math.random()<0.35; spacing=6; twisted=false; }
                else if (r < 0.55) { type='normal'; trunkHeight=Math.floor(Math.random()*4)+9; foliageRadius=Math.floor(Math.random()*2)+3; roots=false; spacing=4; twisted=false; }
                else { type='small'; trunkHeight=Math.floor(Math.random()*4)+10; foliageRadius=Math.floor(Math.random()*2)+3; roots=false; spacing=4; twisted=true; }
                if (!tooClose(x, z, spacing)) {
                    voxels.push(...createTree(x, z, h, trunkHeight, foliageRadius, type, roots, twisted));
                    mark(x, z, spacing);
                }
            }
        }
    }
    return voxels;
}

// Lily pads
function createThinLilyPad(x, y, z) {
    const g = new THREE.BoxGeometry(VOXEL_SIZE, 0.15, VOXEL_SIZE);
    const m = materials.lilyPad;
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    return mesh;
}
function createLilyPad(x, z, size='cluster') {
    const group = new THREE.Group();
    const y = 0;
    if (size === 'single') { group.add(createThinLilyPad(x, y, z)); }
    else {
        group.add(createThinLilyPad(x, y, z));
        group.add(createThinLilyPad(x+1, y, z));
        group.add(createThinLilyPad(x, y, z+1));
        group.add(createThinLilyPad(x+1, y, z+1));
    }
    return group;
}
function createLilyPads() {
    const group = new THREE.Group();
    const pads = [
        { x:-18.5,z:26,size:'single'},{x:-15,z:27.5,size:'cluster'},{x:-17,z:29,size:'single'},
        { x:17,z:-48,size:'cluster'},{x:15.5,z:-46,size:'single'},{x:18,z:-44.5,size:'single'}
    ];
    pads.forEach(p => group.add(createLilyPad(p.x, p.z, p.size)));
    return group;
}

// Particles
function createParticles() {
    const g = new THREE.BufferGeometry();
    const count = 150;
    const positions = new Float32Array(count * 3);
    for (let i=0;i<count;i++) {
        positions[i*3] = (Math.random()-0.5)*50;
        positions[i*3+1] = Math.random()*15+2;
        positions[i*3+2] = (Math.random()-0.5)*50;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions,3));
    const m = new THREE.PointsMaterial({ color:0xf4e4c4,size:0.12,transparent:true,opacity:0.6,blending:THREE.AdditiveBlending });
    return new THREE.Points(g,m);
}

// Build world
initializeInstancedMeshes();
const terrain = createTerrain();
const forest = populateForest(terrain.heightMap);
addVoxelsToScene([...terrain.voxels, ...forest]);
Object.values(instancedMeshes).forEach(bucket => bucket.meshes.forEach(mesh => { if (mesh.count>0){ mesh.instanceMatrix.needsUpdate=true; scene.add(mesh);} }));

const water = createWaterPlane();
const fogLayers = createUnderwaterFogLayers();
const lilyPads = createLilyPads();
const particles = createParticles();
scene.add(fogLayers, water, lilyPads, particles);

// setSkyboxFromCubemap([
//   'textures/skybox/px.jpg', // +X
//   'textures/skybox/nx.jpg', // -X
//   'textures/skybox/py.jpg', // +Y
//   'textures/skybox/ny.jpg', // -Y
//   'textures/skybox/pz.jpg', // +Z
//   'textures/skybox/nz.jpg'  // -Z
// ]);

setSkyboxFromEquirect('skybox.jpeg');

// Animation loop
let t = 0;
function animate() {
    requestAnimationFrame(animate);
    t += 0.01;
    const pos = particles.geometry.attributes.position.array;
    for (let i=1;i<pos.length;i+=3) {
        pos[i] += Math.sin(t + i)*0.01;
        if (pos[i] > 20) pos[i] = 0;
    }
    particles.geometry.attributes.position.needsUpdate = true;
    particles.rotation.y += 0.0005;
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
});
