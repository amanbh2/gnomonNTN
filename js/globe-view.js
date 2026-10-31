/**
 * AMAN.GNOMON-NTN — 3D Globe Visualization Engine
 * Features:
 * - Three.js interactive Earth with procedural high-res vector continents & graticules
 * - Atmospheric rim glow & starfield
 * - Geodesic great-circle arcs via SLERP
 * - Curved cell polygon footprint surface
 * - LEO Satellite with solar arrays & dynamic 3D conical beam pointing to centroid
 * - Interactive draggable UE marker and vertex pins with bidirectional event dispatch
 * 
 * Engineered with ❤️ & AI by Aman Bhaskar
 */

import {
  EARTH_RADIUS_KM,
  DEG_TO_RAD,
  RAD_TO_DEG,
  latLonToUnitVector,
  unitVectorToLatLon,
  slerp
} from './gnomon-pip.js';

export class GlobeView {
  constructor(containerElement, onUeMoved, onVertexMoved) {
    this.container = containerElement;
    this.onUeMoved = onUeMoved;
    this.onVertexMoved = onVertexMoved;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.earthMesh = null;
    this.atmosphereMesh = null;

    this.earthRadius = 5.0; // Three.js units
    this.satelliteGroup = null;
    this.satelliteBeam = null;
    this.orbitLine = null;
    this.orbitRadius = 7.0;
    this.orbitAngle = 0.0;
    this.orbitSpeed = 0.003;
    this.isOrbiting = true;
    this.orbitInclination = 53.0; // degrees

    this.geodesicLinesGroup = null;
    this.polygonSurfaceMesh = null;
    this.centroidMarker = null;
    this.ueMarkerGroup = null;
    this.vertexMarkersGroup = null;

    this.currentData = null;
    this.isDraggingUE = false;
    this.isDraggingVertex = false;
    this.draggedVertexIndex = -1;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.planeIntersect = new THREE.Vector3();

    this.init();
  }

  init() {
    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 500;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    this.camera.position.set(0, 5, 17.5);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls with graceful fallback if CDN is delayed or blocked
    if (typeof THREE !== 'undefined' && typeof THREE.OrbitControls === 'function') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.minDistance = 6.2;
      this.controls.maxDistance = 35.0;
      this.controls.rotateSpeed = 0.7;
    } else {
      console.warn('THREE.OrbitControls not available, activating built-in spherical orbit controller');
      this.controls = this.createFallbackOrbitControls();
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x334466, 1.2);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(15, 20, 20);
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x00F2FE, 0.8);
    rimLight.position.set(-15, -10, -15);
    this.scene.add(rimLight);

    // Groups
    this.geodesicLinesGroup = new THREE.Group();
    this.scene.add(this.geodesicLinesGroup);

    this.vertexMarkersGroup = new THREE.Group();
    this.scene.add(this.vertexMarkersGroup);

    // Starfield
    this.buildStarfield();

    // Earth
    this.buildEarth();

    // Atmosphere glow
    this.buildAtmosphere();

    // Satellite & Orbit
    this.buildSatelliteAndOrbit();

    // Centroid Beacon
    this.buildCentroidBeacon();

    // UE Marker
    this.buildUeMarker();

    // Event listeners
    this.setupInteractions();

    // Window resize
    window.addEventListener('resize', () => this.onResize());

    // Animation Loop
    this.animate();
  }

  buildStarfield() {
    const starCount = 1200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 80 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const tint = Math.random();
      if (tint > 0.8) {
        colors[i * 3] = 0.5; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1.0; // Cyan
      } else if (tint > 0.6) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.4; // Amber
      } else {
        colors[i * 3] = 0.9; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 1.0; // White
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    const starPoints = new THREE.Points(geometry, material);
    this.scene.add(starPoints);
  }

  /**
   * Generates a high-precision procedural Equirectangular Earth Texture
   * with continent outlines, bathymetry, topography, and lat/lon graticules.
   */
  generateEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // 1. Ocean base gradient
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    oceanGrad.addColorStop(0, '#040b17');
    oceanGrad.addColorStop(0.3, '#07162c');
    oceanGrad.addColorStop(0.5, '#0a1d38');
    oceanGrad.addColorStop(0.7, '#07162c');
    oceanGrad.addColorStop(1, '#040b17');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Helper: convert lon [-180, 180] and lat [-90, 90] to canvas pixels
    const toPx = (lon, lat) => ({
      x: ((lon + 180) / 360) * canvas.width,
      y: ((90 - lat) / 180) * canvas.height
    });

    // 2. Draw Vector Landmasses
    ctx.fillStyle = '#17324f';
    ctx.strokeStyle = '#2d5885';
    ctx.lineWidth = 1.5;

    const drawPolygon = (coords) => {
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        const pt = toPx(coords[i][0], coords[i][1]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    // Continents simplified high-level polygonal footprints
    // Africa
    drawPolygon([
      [-17, 30], [-13, 34], [-5, 36], [10, 37], [25, 32], [32, 31],
      [35, 27], [43, 12], [51, 11], [45, 2], [41, -5], [35, -20],
      [28, -32], [18, -34], [12, -20], [10, -5], [0, 5], [-15, 12], [-17, 21]
    ]);

    // Eurasia
    drawPolygon([
      [-9, 36], [-9, 43], [2, 51], [5, 62], [15, 68], [28, 70], [60, 68],
      [100, 75], [140, 72], [170, 65], [160, 55], [140, 50], [130, 42],
      [122, 30], [108, 22], [103, 10], [98, 12], [88, 22], [76, 8],
      [68, 24], [50, 26], [35, 36], [26, 40], [15, 45], [0, 48], [-5, 36]
    ]);

    // Great Britain & Scandinavia
    drawPolygon([[-5, 50], [-2, 58], [2, 58], [0, 51]]);
    drawPolygon([[5, 58], [15, 56], [25, 71], [15, 70]]);

    // North America
    drawPolygon([
      [-168, 65], [-160, 71], [-130, 70], [-100, 70], [-80, 60], [-65, 46],
      [-75, 35], [-80, 25], [-97, 20], [-105, 25], [-120, 35], [-125, 48],
      [-140, 60], [-165, 60]
    ]);

    // Greenland
    drawPolygon([[-50, 60], [-20, 70], [-25, 82], [-55, 82], [-50, 70]]);

    // South America
    drawPolygon([
      [-76, 12], [-60, 10], [-45, 0], [-35, -5], [-40, -22], [-50, -35],
      [-65, -54], [-75, -50], [-72, -35], [-76, -15], [-80, -2]
    ]);

    // Australia
    drawPolygon([
      [114, -22], [125, -14], [138, -12], [146, -18], [152, -28],
      [148, -38], [136, -35], [118, -34], [113, -28]
    ]);

    // Antarctica
    drawPolygon([
      [-180, -70], [-100, -72], [0, -70], [100, -70], [180, -70],
      [180, -90], [-180, -90]
    ]);

    // Japan, Philippines, Indonesia
    drawPolygon([[130, 31], [140, 40], [142, 45], [138, 36]]);
    drawPolygon([[120, 15], [126, 8], [122, 5]]);
    drawPolygon([[95, 5], [110, -5], [118, -8], [105, 0]]);

    // 3. Latitude & Longitude Graticules
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';

    // Longitude lines every 30 degrees
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    // Latitude lines every 15 degrees
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Equator (Prominent)
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
    const eqY = canvas.height * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, eqY);
    ctx.lineTo(canvas.width, eqY);
    ctx.stroke();

    // Prime Meridian & Antimeridian (Prominent)
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(255, 184, 0, 0.35)';
    const pmX = canvas.width * 0.5;
    ctx.beginPath();
    ctx.moveTo(pmX, 0);
    ctx.lineTo(pmX, canvas.height);
    ctx.stroke();

    // Text labels for reference
    ctx.font = '20px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(0, 242, 254, 0.4)';
    ctx.fillText('0° EQUATOR', 30, eqY - 8);
    ctx.fillStyle = 'rgba(255, 184, 0, 0.45)';
    ctx.fillText('0° PRIME MERIDIAN', pmX + 10, 40);
    ctx.fillText('±180° ANTIMERIDIAN', 20, 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  buildEarth() {
    const geometry = new THREE.SphereGeometry(this.earthRadius, 64, 64);
    const earthTexture = this.generateEarthTexture();

    const material = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.7,
      metalness: 0.15,
      emissive: new THREE.Color(0x030814),
      emissiveIntensity: 0.3
    });

    this.earthMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.earthMesh);
  }

  buildAtmosphere() {
    // Atmospheric glowing outer shell
    const geometry = new THREE.SphereGeometry(this.earthRadius * 1.025, 48, 48);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    this.atmosphereMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.atmosphereMesh);
  }

  buildSatelliteAndOrbit() {
    // 1. Orbit Path Ring
    const orbitRadius = this.earthRadius * 1.45;
    this.orbitRadius = orbitRadius;

    const orbitPts = [];
    const segments = 120;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(
        Math.cos(angle) * orbitRadius,
        0,
        Math.sin(angle) * orbitRadius
      ));
    }
    const orbitGeom = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitMat = new THREE.LineDashedMaterial({
      color: 0x00F2FE,
      dashSize: 0.3,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.45
    });
    this.orbitLine = new THREE.Line(orbitGeom, orbitMat);
    this.orbitLine.computeLineDistances();

    // Tilt orbit according to inclination
    this.orbitLine.rotation.x = this.orbitInclination * DEG_TO_RAD;
    this.scene.add(this.orbitLine);

    // 2. Satellite Group
    this.satelliteGroup = new THREE.Group();

    // Satellite Main Body Bus
    const busGeom = new THREE.BoxGeometry(0.35, 0.22, 0.22);
    const busMat = new THREE.MeshStandardMaterial({
      color: 0xE2E8F0,
      metalness: 0.8,
      roughness: 0.2
    });
    const busMesh = new THREE.Mesh(busGeom, busMat);
    this.satelliteGroup.add(busMesh);

    // Solar Wings
    const wingGeom = new THREE.BoxGeometry(0.8, 0.18, 0.02);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x0051A8,
      roughness: 0.3,
      metalness: 0.5,
      emissive: 0x002244
    });
    const leftWing = new THREE.Mesh(wingGeom, wingMat);
    leftWing.position.x = -0.6;
    const rightWing = new THREE.Mesh(wingGeom, wingMat);
    rightWing.position.x = 0.6;
    this.satelliteGroup.add(leftWing);
    this.satelliteGroup.add(rightWing);

    // Gold Antenna Dish
    const dishGeom = new THREE.CylinderGeometry(0.12, 0.02, 0.1, 16);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xFFB800,
      metalness: 0.9,
      roughness: 0.1
    });
    const dish = new THREE.Mesh(dishGeom, dishMat);
    dish.position.y = -0.12;
    dish.rotation.x = Math.PI;
    this.satelliteGroup.add(dish);

    this.scene.add(this.satelliteGroup);

    // 3. Dynamic 3D Conical Beam
    const beamGeom = new THREE.ConeGeometry(1.0, 1.0, 32, 1, true);
    beamGeom.translate(0, -0.5, 0); // Origin at apex
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.satelliteBeam = new THREE.Mesh(beamGeom, beamMat);
    this.scene.add(this.satelliteBeam);
  }

  buildCentroidBeacon() {
    this.centroidGroup = new THREE.Group();

    // Central amber sphere
    const sphereGeom = new THREE.SphereGeometry(0.14, 20, 20);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xFFB800,
      emissive: 0xFF9900,
      emissiveIntensity: 0.9,
      metalness: 0.8,
      roughness: 0.2
    });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    this.centroidGroup.add(sphere);

    // Pulsing ring
    const ringGeom = new THREE.RingGeometry(0.18, 0.26, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xFFB800,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.centroidRing = new THREE.Mesh(ringGeom, ringMat);
    this.centroidGroup.add(this.centroidRing);

    // Vertical beacon beam pointing outward into space
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0.9)
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xFFB800, transparent: true, opacity: 0.85, linewidth: 2 });
    const line = new THREE.Line(lineGeom, lineMat);
    this.centroidGroup.add(line);

    this.scene.add(this.centroidGroup);
  }

  buildUeMarker() {
    this.ueMarkerGroup = new THREE.Group();

    // Core sphere (green when inside, red when outside)
    const sphereGeom = new THREE.SphereGeometry(0.18, 24, 24);
    this.ueSphereMat = new THREE.MeshStandardMaterial({
      color: 0x00E676,
      emissive: 0x00B359,
      emissiveIntensity: 0.8,
      metalness: 0.7,
      roughness: 0.2
    });
    this.ueSphere = new THREE.Mesh(sphereGeom, this.ueSphereMat);
    this.ueMarkerGroup.add(this.ueSphere);

    // Outer target radar ring
    const ringGeom = new THREE.RingGeometry(0.26, 0.36, 36);
    this.ueRingMat = new THREE.MeshBasicMaterial({
      color: 0x00E676,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.ueRing = new THREE.Mesh(ringGeom, this.ueRingMat);
    this.ueMarkerGroup.add(this.ueRing);

    // Telemetry Pin vertical stem
    const stemGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1.1)
    ]);
    this.ueStemMat = new THREE.LineBasicMaterial({ color: 0x00E676, linewidth: 3 });
    this.ueStem = new THREE.Line(stemGeom, this.ueStemMat);
    this.ueMarkerGroup.add(this.ueStem);

    // Top pin tip beacon
    const tipGeom = new THREE.SphereGeometry(0.07, 16, 16);
    this.ueTipMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
    const tip = new THREE.Mesh(tipGeom, this.ueTipMat);
    tip.position.set(0, 0, 1.1);
    this.ueMarkerGroup.add(tip);

    this.scene.add(this.ueMarkerGroup);
  }

  /**
   * Converts (lat, lon) in degrees to 3D Cartesian Vector on globe sphere
   */
  latLonToSpherePos(latDeg, lonDeg, altitudeOffset = 0.01) {
    const u = latLonToUnitVector(latDeg, lonDeg);
    const r = this.earthRadius + altitudeOffset;
    // In Three.js: +Y is North, +Z is Prime Meridian (lon 0), +X is East (lon 90)
    // u.x = cos(phi)*cos(lam), u.y = cos(phi)*sin(lam), u.z = sin(phi)
    // We map: X_3d = r * u.y, Y_3d = r * u.z, Z_3d = r * u.x
    return new THREE.Vector3(r * u.y, r * u.z, r * u.x);
  }

  spherePosToLatLon(pos) {
    // Inverse mapping
    const r = pos.length() || 1.0;
    const uz = pos.y / r; // sin(phi)
    const ux = pos.z / r; // cos(phi)*cos(lam)
    const uy = pos.x / r; // cos(phi)*sin(lam)

    const lat = Math.asin(Math.max(-1.0, Math.min(1.0, uz))) * RAD_TO_DEG;
    const lon = Math.atan2(uy, ux) * RAD_TO_DEG;
    return { lat, lon };
  }

  /**
   * Update the 3D scene from the latest evaluation pipeline data
   */
  update(evalData) {
    this.currentData = evalData;

    // 1. Update Centroid beacon
    const cPos = this.latLonToSpherePos(evalData.centroid.lat, evalData.centroid.lon, 0.05);
    this.centroidGroup.position.copy(cPos);
    this.centroidGroup.lookAt(cPos.clone().multiplyScalar(2.0));

    // 2. Update Geodesic lines along great-circle arcs
    this.renderGeodesicPolygon(evalData.vertices);

    // 3. Update Polygon footprint surface
    this.renderPolygonFootprint(evalData.vertices, evalData.centroid);

    // 4. Update Vertex markers
    this.renderVertexMarkers(evalData.vertices);

    // 5. Update UE Marker
    const uePos = this.latLonToSpherePos(evalData.ueCoord.lat, evalData.ueCoord.lon, 0.06);
    this.ueMarkerGroup.position.copy(uePos);
    this.ueMarkerGroup.lookAt(uePos.clone().multiplyScalar(2.0));

    const color = evalData.finalDecision ? 0x00E676 : 0xFF3B30;
    this.ueSphereMat.color.setHex(color);
    this.ueRingMat.color.setHex(color);
    this.ueStemMat.color.setHex(color);

    // 6. Update Satellite Beam to target the cell Centroid
    this.updateSatelliteBeam(cPos);
  }

  renderGeodesicPolygon(vertices) {
    // Clear old lines and meshes
    while (this.geodesicLinesGroup.children.length > 0) {
      const child = this.geodesicLinesGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.geodesicLinesGroup.remove(child);
    }

    const n = vertices.length;
    if (n < 3) return;

    const segmentsPerEdge = 36; // Great-circle SLERP interpolation
    const points = [];

    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      const u1 = latLonToUnitVector(v1.lat, v1.lon);
      const u2 = latLonToUnitVector(v2.lat, v2.lon);

      for (let s = 0; s < segmentsPerEdge; s++) {
        const t = s / segmentsPerEdge;
        const uInterp = slerp(u1, u2, t);
        const latLon = unitVectorToLatLon(uInterp);
        points.push(this.latLonToSpherePos(latLon.lat, latLon.lon, 0.035));
      }
    }

    const numPoints = points.length;
    if (numPoints < 3) return;

    // 1. Build Prominent Glowing Geodesic Ribbon Mesh on Sphere Surface
    // Surface normal N, Tangent T along geodesic, Binormal B = N x T
    const ribbonHalfWidth = 0.055; // ~70 km ribbon width on Earth scale
    const ribbonPositions = [];
    const ribbonNormals = [];

    for (let i = 0; i < numPoints; i++) {
      const nextIdx = (i + 1) % numPoints;
      const pA = points[i];
      const pB = points[nextIdx];

      const lenA = pA.length() || 1.0;
      const nA = new THREE.Vector3(pA.x / lenA, pA.y / lenA, pA.z / lenA);

      const tangent = new THREE.Vector3().subVectors(pB, pA).normalize();
      const binormal = new THREE.Vector3().crossVectors(nA, tangent).normalize();

      // Left and right edges of ribbon at pA and pB
      const lA = pA.clone().addScaledVector(binormal, ribbonHalfWidth);
      const rA = pA.clone().addScaledVector(binormal, -ribbonHalfWidth);
      const lB = pB.clone().addScaledVector(binormal, ribbonHalfWidth);
      const rB = pB.clone().addScaledVector(binormal, -ribbonHalfWidth);

      // Quad triangle 1: lA, lB, rA
      ribbonPositions.push(lA.x, lA.y, lA.z);
      ribbonPositions.push(lB.x, lB.y, lB.z);
      ribbonPositions.push(rA.x, rA.y, rA.z);

      // Quad triangle 2: rA, lB, rB
      ribbonPositions.push(rA.x, rA.y, rA.z);
      ribbonPositions.push(lB.x, lB.y, lB.z);
      ribbonPositions.push(rB.x, rB.y, rB.z);

      ribbonNormals.push(nA.x, nA.y, nA.z, nA.x, nA.y, nA.z, nA.x, nA.y, nA.z);
      ribbonNormals.push(nA.x, nA.y, nA.z, nA.x, nA.y, nA.z, nA.x, nA.y, nA.z);
    }

    const ribbonGeom = new THREE.BufferGeometry();
    ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3));
    ribbonGeom.setAttribute('normal', new THREE.Float32BufferAttribute(ribbonNormals, 3));

    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
    this.geodesicLinesGroup.add(ribbonMesh);

    // 2. Crisp White Center Highlight Line on Top
    const linePoints = [...points, points[0]];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xFFFFFF,
      linewidth: 2,
      transparent: true,
      opacity: 0.95
    });
    const centerLine = new THREE.Line(lineGeom, lineMat);
    this.geodesicLinesGroup.add(centerLine);
  }

  renderPolygonFootprint(vertices, centroid) {
    if (this.polygonSurfaceMesh) {
      this.polygonSurfaceMesh.geometry.dispose();
      this.scene.remove(this.polygonSurfaceMesh);
      this.polygonSurfaceMesh = null;
    }

    const n = vertices.length;
    if (n < 3) return;

    // Create curved fan surface from centroid hugging spherical curvature
    const cPos = this.latLonToSpherePos(centroid.lat, centroid.lon, 0.025);
    const subSegments = 16;
    const positions = [];

    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      const u1 = latLonToUnitVector(v1.lat, v1.lon);
      const u2 = latLonToUnitVector(v2.lat, v2.lon);

      for (let s = 0; s < subSegments; s++) {
        const tA = s / subSegments;
        const tB = (s + 1) / subSegments;

        const uA = slerp(u1, u2, tA);
        const uB = slerp(u1, u2, tB);

        const posA = this.latLonToSpherePos(unitVectorToLatLon(uA).lat, unitVectorToLatLon(uA).lon, 0.025);
        const posB = this.latLonToSpherePos(unitVectorToLatLon(uB).lat, unitVectorToLatLon(uB).lon, 0.025);

        // Triangle fan: Centroid, posA, posB
        positions.push(cPos.x, cPos.y, cPos.z);
        positions.push(posA.x, posA.y, posA.z);
        positions.push(posB.x, posB.y, posB.z);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.polygonSurfaceMesh = new THREE.Mesh(geom, mat);
    this.scene.add(this.polygonSurfaceMesh);
  }

  renderVertexMarkers(vertices) {
    while (this.vertexMarkersGroup.children.length > 0) {
      const child = this.vertexMarkersGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.vertexMarkersGroup.remove(child);
    }

    vertices.forEach((v, idx) => {
      const pos = this.latLonToSpherePos(v.lat, v.lon, 0.06);

      // Outer cyan sphere
      const geom = new THREE.SphereGeometry(0.14, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x00F2FE,
        emissive: 0x00B8D9,
        emissiveIntensity: 0.8,
        metalness: 0.6,
        roughness: 0.2
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.userData = { vertexIndex: idx };

      // Inner white core
      const innerGeom = new THREE.SphereGeometry(0.07, 12, 12);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
      const inner = new THREE.Mesh(innerGeom, innerMat);
      mesh.add(inner);

      this.vertexMarkersGroup.add(mesh);
    });
  }

  updateSatelliteBeam(targetPos) {
    if (!this.satelliteGroup || !this.satelliteBeam) return;

    const satPos = this.satelliteGroup.position;
    const dir = new THREE.Vector3().subVectors(targetPos, satPos);
    const dist = dir.length();

    // Scale beam height to distance, width to cover regional macro beam footprint (~2.4 units radius)
    this.satelliteBeam.position.copy(satPos);
    this.satelliteBeam.scale.set(2.4, dist, 2.4);

    // Orient cone towards centroid
    const up = new THREE.Vector3(0, 1, 0);
    this.satelliteBeam.quaternion.setFromUnitVectors(up, dir.clone().normalize().negate());
  }

  setupInteractions() {
    const dom = this.renderer.domElement;

    const getRaycastIntersection = (event) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      return this.raycaster.intersectObject(this.earthMesh);
    };

    dom.addEventListener('pointerdown', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Check if clicked on UE Marker
      const ueIntersects = this.raycaster.intersectObject(this.ueSphere);
      if (ueIntersects.length > 0) {
        this.isDraggingUE = true;
        this.controls.enabled = false;
        dom.style.cursor = 'grabbing';
        return;
      }

      // Check if clicked on a Vertex Marker
      const vIntersects = this.raycaster.intersectObjects(this.vertexMarkersGroup.children);
      if (vIntersects.length > 0) {
        this.isDraggingVertex = true;
        this.draggedVertexIndex = vIntersects[0].object.userData.vertexIndex;
        this.controls.enabled = false;
        dom.style.cursor = 'grabbing';
        return;
      }

      // If clicked with Alt or Shift key, or single click on Earth -> move UE
      if (e.shiftKey) {
        const earthIntersects = this.raycaster.intersectObject(this.earthMesh);
        if (earthIntersects.length > 0) {
          const coords = this.spherePosToLatLon(earthIntersects[0].point);
          if (this.onUeMoved) this.onUeMoved(coords.lat, coords.lon);
        }
      }
    });

    dom.addEventListener('pointermove', (e) => {
      const intersects = getRaycastIntersection(e);

      if (this.isDraggingUE) {
        if (intersects.length > 0) {
          const coords = this.spherePosToLatLon(intersects[0].point);
          if (this.onUeMoved) this.onUeMoved(coords.lat, coords.lon);
        }
        return;
      }

      if (this.isDraggingVertex && this.draggedVertexIndex >= 0) {
        if (intersects.length > 0) {
          const coords = this.spherePosToLatLon(intersects[0].point);
          if (this.onVertexMoved) this.onVertexMoved(this.draggedVertexIndex, coords.lat, coords.lon);
        }
        return;
      }

      // Hover feedback
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const ueHover = this.raycaster.intersectObject(this.ueSphere);
      const vHover = this.raycaster.intersectObjects(this.vertexMarkersGroup.children);
      if (ueHover.length > 0 || vHover.length > 0) {
        dom.style.cursor = 'grab';
      } else {
        dom.style.cursor = 'default';
      }
    });

    const stopDragging = () => {
      this.isDraggingUE = false;
      this.isDraggingVertex = false;
      this.draggedVertexIndex = -1;
      this.controls.enabled = true;
      dom.style.cursor = 'default';
    };

    dom.addEventListener('pointerup', stopDragging);
    dom.addEventListener('pointerleave', stopDragging);

    // Double-click to move UE to point on globe
    dom.addEventListener('dblclick', (e) => {
      const intersects = getRaycastIntersection(e);
      if (intersects.length > 0) {
        const coords = this.spherePosToLatLon(intersects[0].point);
        if (this.onUeMoved) this.onUeMoved(coords.lat, coords.lon);
      }
    });
  }

  focusOnCell() {
    if (!this.currentData || !this.currentData.centroid) return;
    const cPos = this.latLonToSpherePos(this.currentData.centroid.lat, this.currentData.centroid.lon, 0);

    // Frame camera so that Earth, satellite orbit, and cell footprint are ALL in scope!
    // Offset camera slightly elevated and angled to show 3D space depth of the orbit and conical beam.
    const normal = cPos.clone().normalize();
    const upVec = new THREE.Vector3(0, 1, 0);
    const sideVec = new THREE.Vector3().crossVectors(normal, upVec).normalize();

    const targetDir = normal.clone().multiplyScalar(0.72)
      .add(upVec.clone().multiplyScalar(0.42))
      .add(sideVec.clone().multiplyScalar(0.24))
      .normalize();

    const targetCameraPos = targetDir.multiplyScalar(17.5);

    // Smooth tween using simple step
    const startPos = this.camera.position.clone();
    let step = 0;
    const animateFocus = () => {
      step += 0.05;
      this.camera.position.lerpVectors(startPos, targetCameraPos, Math.min(1.0, step));
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      if (step < 1.0) {
        requestAnimationFrame(animateFocus);
      }
    };
    animateFocus();
  }

  resetCamera() {
    this.camera.position.set(0, 5, 17.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  createFallbackOrbitControls() {
    const dom = this.renderer.domElement;
    let isMouseDown = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    const target = new THREE.Vector3(0, 0, 0);

    const onPointerDown = (e) => {
      if (e.target !== dom) return;
      isMouseDown = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onPointerMove = (e) => {
      if (!isMouseDown) return;
      const dx = (e.clientX - prevMouseX) * 0.006;
      const dy = (e.clientY - prevMouseY) * 0.006;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      const offset = this.camera.position.clone().sub(target);
      const radius = offset.length();
      let theta = Math.atan2(offset.x, offset.z) - dx;
      let phi = Math.acos(Math.max(-0.99, Math.min(0.99, offset.y / radius))) - dy;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

      this.camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.lookAt(target);
    };

    const onPointerUp = () => { isMouseDown = false; };
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      const offset = this.camera.position.clone().sub(target);
      const newRadius = Math.max(6.2, Math.min(35.0, offset.length() * factor));
      offset.setLength(newRadius);
      this.camera.position.copy(target).add(offset);
      this.camera.lookAt(target);
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    return {
      target,
      enabled: true,
      update: () => {},
      dispose: () => {
        dom.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        dom.removeEventListener('wheel', onWheel);
      }
    };
  }

  setOrbitActive(active) {
    this.isOrbiting = active;
  }

  setSatelliteAltitude(altKm) {
    // Map altitude 300..1200 km to radius 6.5..8.5 units
    const norm = (altKm - 300) / (1200 - 300);
    this.orbitRadius = this.earthRadius * (1.2 + norm * 0.4);
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Update Controls
    this.controls.update();

    // Satellite Orbit Motion
    if (this.isOrbiting && this.satelliteGroup) {
      this.orbitAngle += this.orbitSpeed;
      const x = Math.cos(this.orbitAngle) * this.orbitRadius;
      const z = Math.sin(this.orbitAngle) * this.orbitRadius;

      // Apply inclination rotation
      const inc = this.orbitInclination * DEG_TO_RAD;
      const y = z * Math.sin(inc);
      const zTilted = z * Math.cos(inc);

      this.satelliteGroup.position.set(x, y, zTilted);

      // Reorient satellite towards Earth center
      this.satelliteGroup.lookAt(0, 0, 0);

      // Update beam if target centroid is available
      if (this.currentData && this.currentData.centroid) {
        const cPos = this.latLonToSpherePos(this.currentData.centroid.lat, this.currentData.centroid.lon, 0.05);
        this.updateSatelliteBeam(cPos);
      }
    }

    // Centroid pulse animation
    if (this.centroidRing) {
      const s = 1.0 + Math.sin(Date.now() * 0.005) * 0.25;
      this.centroidRing.scale.set(s, s, s);
    }

    // UE marker pulse animation
    if (this.ueRing) {
      const s2 = 1.0 + Math.sin(Date.now() * 0.007) * 0.35;
      this.ueRing.scale.set(s2, s2, s2);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

