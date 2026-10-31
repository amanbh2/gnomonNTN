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
    this.orbitalPlaneGroup = null;
    this.orbitRadius = 7.0;
    this.orbitAngle = 0.0;
    this.orbitSpeed = 0.003;
    this.isOrbiting = true;
    this.orbitInclination = 53.0; // degrees
    this.isSatelliteInLos = true;
    this.onSatelliteLosChanged = null;

    this.isTransparentMode = false;
    this.transparentGroup = null;

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

    this.transparentGroup = new THREE.Group();
    this.transparentGroup.visible = false;
    this.scene.add(this.transparentGroup);

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
   * Generates a high-precision digital Aerospace Graticule Earth Texture
   * with razor-sharp lat/lon parallels, meridians, highlighted Equator,
   * Prime Meridian, and Antimeridian date line with monospace telemetry stamps.
   */
  generateEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // 1. Sleek Obsidian Midnight Space Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, '#050914');
    bgGrad.addColorStop(0.3, '#070D1E');
    bgGrad.addColorStop(0.5, '#0A1329');
    bgGrad.addColorStop(0.7, '#070D1E');
    bgGrad.addColorStop(1, '#050914');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Fine Coordinate Grid: Minor Graticules (every 5° lat, every 10° lon)
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.06)';

    for (let lon = -180; lon <= 180; lon += 10) {
      const x = ((lon + 180) / 360) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let lat = -80; lat <= 80; lat += 5) {
      const y = ((90 - lat) / 180) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 3. Standard Graticules (every 15° lat, every 30° lon)
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';

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

    // 4. Tropics (±23.5°) & Polar Circles (±66.5°)
    ctx.lineWidth = 1.0;
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255, 184, 0, 0.25)';
    [-66.5, -23.5, 23.5, 66.5].forEach(lat => {
      const y = ((90 - lat) / 180) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    });
    ctx.setLineDash([]); // Reset line dash

    // 5. Equator (0° Latitude) — Vivid Glowing Cyan
    const eqY = canvas.height * 0.5;
    ctx.lineWidth = 4.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, eqY);
    ctx.lineTo(canvas.width, eqY);
    ctx.stroke();

    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.beginPath();
    ctx.moveTo(0, eqY);
    ctx.lineTo(canvas.width, eqY);
    ctx.stroke();

    // 6. Prime Meridian (0° Longitude) — Vivid Glowing Cyan
    const pmX = canvas.width * 0.5;
    ctx.lineWidth = 4.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.2)';
    ctx.beginPath();
    ctx.moveTo(pmX, 0);
    ctx.lineTo(pmX, canvas.height);
    ctx.stroke();

    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.beginPath();
    ctx.moveTo(pmX, 0);
    ctx.lineTo(pmX, canvas.height);
    ctx.stroke();

    // 7. Antimeridian (±180° Longitude) — Electric Amber Highlight
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 184, 0, 0.85)';
    ctx.setLineDash([12, 6]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvas.width - 1, 0);
    ctx.lineTo(canvas.width - 1, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // 8. Grid Intersection Crosshairs
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = ((lon + 180) / 360) * canvas.width;
      for (let lat = -60; lat <= 60; lat += 30) {
        if (lat === 0 && lon === 0) continue;
        const y = ((90 - lat) / 180) * canvas.height;
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
      }
    }

    // 9. Crisp Aerospace Monospace Coordinate Labels
    ctx.font = 'bold 15px "JetBrains Mono", monospace';

    // Latitude labels stamped across multiple meridians around the entire globe
    const labelLons = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
    for (const lon of labelLons) {
      const x = ((lon + 180) / 360) * canvas.width;
      for (let lat = -75; lat <= 75; lat += 15) {
        if (lat === 0) continue;
        const y = ((90 - lat) / 180) * canvas.height;
        const label = lat > 0 ? `${lat}°N` : `${Math.abs(lat)}°S`;
        ctx.fillStyle = lon === 0 ? 'rgba(0, 242, 254, 0.95)' : 'rgba(0, 242, 254, 0.65)';
        ctx.fillText(label, x + 6, y - 4);
      }
    }

    // Equator labels along longitudes
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = ((lon + 180) / 360) * canvas.width;
      const label = lon === 0 ? '0° (PM)' : (lon > 0 ? `${lon}°E` : `${Math.abs(lon)}°W`);
      ctx.fillStyle = lon === 0 ? 'rgba(0, 242, 254, 0.95)' : 'rgba(0, 242, 254, 0.65)';
      ctx.fillText(label, x + 6, eqY - 8);
    }

    // Antimeridian labels
    ctx.fillStyle = 'rgba(255, 184, 0, 0.95)';
    ctx.fillText('180° ANTIMERIDIAN / DATE LINE', 20, 36);
    ctx.fillText('0° EQUATOR', pmX + 10, eqY - 8);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  buildEarth() {
    const geometry = new THREE.SphereGeometry(this.earthRadius, 64, 64);
    const earthTexture = this.generateEarthTexture();

    // 1. Translucent Surface Skin (pure lat/lon graticules, no diagonal tessellation)
    const material = new THREE.MeshBasicMaterial({
      map: earthTexture,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.earthMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.earthMesh);

    // 2. Physical 3D Latitude Parallels & Longitude Meridian Rings (Zero angular diagonal lines)
    this.buildProminent3DRings();
  }

  buildProminent3DRings() {
    this.ringsGroup = new THREE.Group();
    const R = this.earthRadius * 1.002;

    // 1. True Latitude parallel circles every 15 degrees (-75° to +75°)
    for (let lat = -75; lat <= 75; lat += 15) {
      const phi = lat * DEG_TO_RAD;
      const y = R * Math.sin(phi);
      const r = R * Math.cos(phi);

      const pts = [];
      const segments = 64;
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta)));
      }

      const isEquator = lat === 0;
      const ringGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const ringMat = new THREE.LineBasicMaterial({
        color: 0x00F2FE,
        transparent: true,
        opacity: isEquator ? 0.85 : 0.35,
        linewidth: isEquator ? 2 : 1
      });
      const ringLine = new THREE.Line(ringGeom, ringMat);
      this.ringsGroup.add(ringLine);
    }

    // 2. True Longitude meridian semicircles every 30 degrees (0° to 330°)
    for (let lon = 0; lon < 360; lon += 30) {
      const lam = lon * DEG_TO_RAD;
      const pts = [];
      const segments = 48;
      // Semicircle from South pole (-90°) to North pole (+90°)
      for (let s = 0; s <= segments; s++) {
        const phi = (-90 + (s / segments) * 180) * DEG_TO_RAD;
        pts.push(new THREE.Vector3(
          R * Math.cos(phi) * Math.sin(lam),
          R * Math.sin(phi),
          R * Math.cos(phi) * Math.cos(lam)
        ));
      }

      const isPrime = lon === 0;
      const isAntimeridian = lon === 180;
      const color = isAntimeridian ? 0xFFB800 : 0x00F2FE;
      const opacity = (isPrime || isAntimeridian) ? 0.85 : 0.30;

      const ringGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const ringMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        linewidth: (isPrime || isAntimeridian) ? 2 : 1
      });
      const ringLine = new THREE.Line(ringGeom, ringMat);
      this.ringsGroup.add(ringLine);
    }

    this.scene.add(this.ringsGroup);
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
    // 1. Orbital Plane Group tilted by inclination
    this.orbitalPlaneGroup = new THREE.Group();
    this.orbitalPlaneGroup.rotation.x = this.orbitInclination * DEG_TO_RAD;
    this.scene.add(this.orbitalPlaneGroup);

    // 2. Orbit Path Ring
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
    this.orbitalPlaneGroup.add(this.orbitLine);

    // 3. Satellite Group (positioned on orbital plane)
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

    this.orbitalPlaneGroup.add(this.satelliteGroup);

    // 4. Dynamic 3D Conical Beam in world space
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

    // Small crisp amber center dot matching 2D plane view (no outer ring)
    const dotGeom = new THREE.CircleGeometry(0.065, 24);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xFFB800,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const dot = new THREE.Mesh(dotGeom, dotMat);
    this.centroidGroup.add(dot);

    // Subtle amber crosshairs matching 2D plane view
    const s = 0.12;
    const crossGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s, 0, 0.005), new THREE.Vector3(s, 0, 0.005),
      new THREE.Vector3(0, -s, 0.005), new THREE.Vector3(0, s, 0.005)
    ]);
    const crossMat = new THREE.LineBasicMaterial({
      color: 0xFFB800,
      transparent: true,
      opacity: 0.9,
      linewidth: 1.5
    });
    const cross = new THREE.LineSegments(crossGeom, crossMat);
    this.centroidGroup.add(cross);

    this.scene.add(this.centroidGroup);
  }

  buildUeMarker() {
    this.ueMarkerGroup = new THREE.Group();

    // Small crisp solid UE dot matching 2D plane view (no outer concentric ring)
    const discGeom = new THREE.CircleGeometry(0.08, 24);
    this.ueDiscMat = new THREE.MeshBasicMaterial({
      color: 0x00E676,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.ueDisc = new THREE.Mesh(discGeom, this.ueDiscMat);
    this.ueMarkerGroup.add(this.ueDisc);

    // Center white pinpoint
    const pipGeom = new THREE.CircleGeometry(0.028, 16);
    const pipMat = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const pip = new THREE.Mesh(pipGeom, pipMat);
    pip.position.z = 0.005;
    this.ueMarkerGroup.add(pip);

    // Invisible hit-test disc for smooth pointer drag interaction
    const hitGeom = new THREE.CircleGeometry(0.35, 16);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.ueHitDisc = new THREE.Mesh(hitGeom, hitMat);
    this.ueMarkerGroup.add(this.ueHitDisc);

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
    if (this.ueRingMat) this.ueRingMat.color.setHex(color);
    if (this.ueDiscMat) this.ueDiscMat.color.setHex(color);

    // 6. Update Satellite Beam to target the cell Centroid
    this.updateSatelliteBeam(cPos);

    // 7. Update 3D Transparent Geometry Mode
    if (this.isTransparentMode) {
      this.renderTransparentGeometry(evalData.vertices, evalData.centroid);
    }
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

    // 1. Build Sleek Geodesic Ribbon Mesh on Sphere Surface (Low weight, matching 2D view)
    // Surface normal N, Tangent T along geodesic, Binormal B = N x T
    const ribbonHalfWidth = 0.012; // ~15 km ribbon width on Earth scale (sleek, not crowding cell)
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
      opacity: 0.9
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
    const cPos = this.latLonToSpherePos(centroid.lat, centroid.lon, 0.02);
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

        const posA = this.latLonToSpherePos(unitVectorToLatLon(uA).lat, unitVectorToLatLon(uA).lon, 0.02);
        const posB = this.latLonToSpherePos(unitVectorToLatLon(uB).lat, unitVectorToLatLon(uB).lon, 0.02);

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
      opacity: 0.12,
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
      const pos = this.latLonToSpherePos(v.lat, v.lon, 0.045);

      const vGroup = new THREE.Group();
      vGroup.position.copy(pos);
      vGroup.lookAt(pos.clone().multiplyScalar(2.0));
      vGroup.userData = { vertexIndex: idx };

      // Single crisp solid cyan dot matching 2D plane view (no outer ring)
      const coreGeom = new THREE.CircleGeometry(0.065, 24);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0x00F2FE,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      coreMesh.userData = { vertexIndex: idx };
      vGroup.add(coreMesh);

      // Tiny white center pin
      const pinGeom = new THREE.CircleGeometry(0.024, 16);
      const pinMat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const pinMesh = new THREE.Mesh(pinGeom, pinMat);
      pinMesh.position.z = 0.005;
      pinMesh.userData = { vertexIndex: idx };
      vGroup.add(pinMesh);

      // Invisible hit-test disc for smooth pointer drag interaction
      const hitGeom = new THREE.CircleGeometry(0.35, 16);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
      const hitMesh = new THREE.Mesh(hitGeom, hitMat);
      hitMesh.userData = { vertexIndex: idx };
      vGroup.add(hitMesh);

      this.vertexMarkersGroup.add(vGroup);
    });
  }

  updateSatelliteBeam(targetPos, satWorldPos) {
    if (!this.satelliteGroup || !this.satelliteBeam || !targetPos) return;

    const satPos = satWorldPos || new THREE.Vector3();
    if (!satWorldPos) {
      this.satelliteGroup.getWorldPosition(satPos);
    }

    // Centroid normal vector on Earth's surface (pointing out to space)
    const cNormal = targetPos.clone().normalize();
    // Direction from centroid to satellite
    const toSatellite = new THREE.Vector3().subVectors(satPos, targetPos);
    // Horizon elevation check: dot product with surface normal
    // If <= 0, the satellite is below the cell centroid's tangent horizon (occluded by Earth!)
    const losDot = toSatellite.dot(cNormal);
    const isInLos = losDot > 0.05;

    if (this.isSatelliteInLos !== isInLos) {
      this.isSatelliteInLos = isInLos;
      if (typeof this.onSatelliteLosChanged === 'function') {
        this.onSatelliteLosChanged(isInLos);
      }
    }

    if (!isInLos) {
      this.satelliteBeam.visible = false;
      return;
    }

    this.satelliteBeam.visible = true;
    const dist = toSatellite.length();

    // Scale beam height to distance, width to cover regional macro beam footprint (~2.4 units radius)
    this.satelliteBeam.position.copy(satPos);
    this.satelliteBeam.scale.set(2.4, dist, 2.4);

    // Orient cone towards centroid
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3().subVectors(targetPos, satPos).normalize().negate();
    this.satelliteBeam.quaternion.setFromUnitVectors(up, dir);
  }

  setTransparentMode(enabled) {
    this.isTransparentMode = enabled;
    if (this.earthMesh) {
      if (enabled) {
        this.earthMesh.material.opacity = 0.12;
        if (this.atmosphereMesh) this.atmosphereMesh.visible = false;
        if (this.transparentGroup) this.transparentGroup.visible = true;
      } else {
        this.earthMesh.material.opacity = 0.38;
        if (this.atmosphereMesh) this.atmosphereMesh.visible = true;
        if (this.transparentGroup) this.transparentGroup.visible = false;
      }
    }
    // Re-render transparent geometry with current data
    if (enabled && this.currentData) {
      this.renderTransparentGeometry(this.currentData.vertices, this.currentData.centroid);
    }
  }

  renderTransparentGeometry(vertices, centroid) {
    if (!this.transparentGroup) return;

    // Clear existing transparent meshes
    while (this.transparentGroup.children.length > 0) {
      const child = this.transparentGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.transparentGroup.remove(child);
    }

    if (!vertices || vertices.length < 3 || !centroid) return;

    // 1. Earth Core Origin Beacon at (0, 0, 0)
    const coreOriginGroup = new THREE.Group();

    // Bold Core sphere
    const coreGeom = new THREE.SphereGeometry(0.18, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xFFB800 });
    const coreSphere = new THREE.Mesh(coreGeom, coreMat);
    coreOriginGroup.add(coreSphere);

    // Glowing wireframe aura
    const auraGeom = new THREE.SphereGeometry(0.32, 12, 12);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    const auraSphere = new THREE.Mesh(auraGeom, auraMat);
    coreOriginGroup.add(auraSphere);

    this.transparentGroup.add(coreOriginGroup);

    // 2. Exact Centroid Tangent Normal and Position in Three.js Scene Coordinates
    const R = this.earthRadius;
    const cPos = this.latLonToSpherePos(centroid.lat, centroid.lon, 0.0);
    const cNormal = cPos.clone().normalize();

    // Compute Projected Points pTan on the Tangent Plane in Three.js Coordinates
    const n = vertices.length;
    const pTanList = [];

    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      // 3D position on sphere surface in Three.js coordinates
      const posSph = this.latLonToSpherePos(v.lat, v.lon, 0.0);
      const uDir = posSph.clone().normalize();

      // Cosine of central angle c between vertex ray and centroid normal
      const cosC = uDir.dot(cNormal);

      // In Gnomonic projection, distance from origin (0,0,0) to tangent plane along uDir:
      // dist = R / cos(c)
      const dist = cosC > 0.02 ? (R / cosC) : (R * 2.0);
      const pTan = uDir.clone().multiplyScalar(dist);
      pTanList.push(pTan);
    }

    // Determine required size of the flat Tangent Plane Sheet
    let maxDistFromCentroid = 2.0;
    for (const pt of pTanList) {
      const d = pt.distanceTo(cPos);
      if (d > maxDistFromCentroid) maxDistFromCentroid = d;
    }
    const planeSize = Math.min(24.0, Math.max(5.5, maxDistFromCentroid * 2.3));

    // Create Flat Tangent Plane Sheet at Centroid
    const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
    const planeFillMat = new THREE.MeshBasicMaterial({
      color: 0x002B49,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const planeMesh = new THREE.Mesh(planeGeom, planeFillMat);

    // Orthogonal grid lines on the tangent plane sheet (East/West and North/South lines only, no diagonal cuts)
    const gridPts = [];
    const halfSize = planeSize / 2;
    const gridDivs = 10;
    const step = planeSize / gridDivs;
    for (let i = -halfSize; i <= halfSize + 0.001; i += step) {
      // Lines parallel to local X (East)
      gridPts.push(new THREE.Vector3(-halfSize, i, 0.002));
      gridPts.push(new THREE.Vector3(halfSize, i, 0.002));
      // Lines parallel to local Y (North)
      gridPts.push(new THREE.Vector3(i, -halfSize, 0.002));
      gridPts.push(new THREE.Vector3(i, halfSize, 0.002));
    }
    const gridGeom = new THREE.BufferGeometry().setFromPoints(gridPts);
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x00F2FE,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    const gridLines = new THREE.LineSegments(gridGeom, gridMat);
    planeMesh.add(gridLines);

    // Position and orient tangent plane to touch centroid surface
    planeMesh.position.copy(cPos);
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cNormal);
    this.transparentGroup.add(planeMesh);

    // Local Tangent Coordinate Axes (+X East, +Y North) in Three.js space
    let eastVec;
    if (Math.abs(cNormal.y) > 0.999) {
      eastVec = new THREE.Vector3(1, 0, 0);
    } else {
      eastVec = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cNormal).normalize();
    }
    const northVec = new THREE.Vector3().crossVectors(cNormal, eastVec).normalize();

    const axisLen = planeSize * 0.45;
    const axesGeom = new THREE.BufferGeometry().setFromPoints([
      cPos.clone().addScaledVector(eastVec, -axisLen),
      cPos.clone().addScaledVector(eastVec, axisLen),
      cPos.clone().addScaledVector(northVec, -axisLen),
      cPos.clone().addScaledVector(northVec, axisLen)
    ]);
    const axesMat = new THREE.LineBasicMaterial({
      color: 0xFFB800,
      transparent: true,
      opacity: 0.85,
      linewidth: 2
    });
    const axesLines = new THREE.LineSegments(axesGeom, axesMat);
    this.transparentGroup.add(axesLines);

    // 3. Radial Great-Circle Slicing Wedges from Core (0,0,0)
    const wedgeMat = new THREE.MeshBasicMaterial({
      color: 0x00F2FE,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const edgeLinePts = [];
    const rayLinePts = [];
    const pCore = new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const pTanA = pTanList[i];
      const pTanB = pTanList[nextIdx];

      // Slicing triangle from Core (0,0,0) to tangent points: Core -> TanA -> TanB
      const wedgeGeom = new THREE.BufferGeometry();
      const positions = new Float32Array([
        pCore.x, pCore.y, pCore.z,
        pTanA.x, pTanA.y, pTanA.z,
        pTanB.x, pTanB.y, pTanB.z
      ]);
      wedgeGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      wedgeGeom.computeVertexNormals();

      const wedgeMesh = new THREE.Mesh(wedgeGeom, wedgeMat);
      this.transparentGroup.add(wedgeMesh);

      // Straight projected line on tangent plane from TanA to TanB
      edgeLinePts.push(pTanA, pTanB);

      // Radial projection ray from Core through Vertex to Tangent Point
      rayLinePts.push(pCore, pTanA);
    }

    // Bold projected straight edges on the tangent plane sheet
    if (edgeLinePts.length > 0) {
      const edgeLineGeom = new THREE.BufferGeometry().setFromPoints(edgeLinePts);
      const edgeLineMat = new THREE.LineBasicMaterial({
        color: 0x00F2FE,
        linewidth: 4,
        transparent: true,
        opacity: 0.98
      });
      const edgeLines = new THREE.LineSegments(edgeLineGeom, edgeLineMat);
      this.transparentGroup.add(edgeLines);
    }

    // Radial projection rays from Core through vertices to tangent plane
    if (rayLinePts.length > 0) {
      const rayLineGeom = new THREE.BufferGeometry().setFromPoints(rayLinePts);
      const rayLineMat = new THREE.LineDashedMaterial({
        color: 0xFFB800,
        dashSize: 0.3,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.75
      });
      const rayLines = new THREE.LineSegments(rayLineGeom, rayLineMat);
      rayLines.computeLineDistances();
      this.transparentGroup.add(rayLines);
    }
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
      const ueIntersects = this.raycaster.intersectObjects(this.ueMarkerGroup.children, true);
      if (ueIntersects.length > 0) {
        this.isDraggingUE = true;
        this.controls.enabled = false;
        dom.style.cursor = 'grabbing';
        return;
      }

      // Check if clicked on a Vertex Marker
      const vIntersects = this.raycaster.intersectObjects(this.vertexMarkersGroup.children, true);
      if (vIntersects.length > 0) {
        this.isDraggingVertex = true;
        const obj = vIntersects[0].object;
        this.draggedVertexIndex = obj.userData.vertexIndex !== undefined ? obj.userData.vertexIndex : obj.parent?.userData?.vertexIndex;
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
      const ueHover = this.raycaster.intersectObjects(this.ueMarkerGroup.children, true);
      const vHover = this.raycaster.intersectObjects(this.vertexMarkersGroup.children, true);
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

    if (this.orbitLine) {
      const orbitPts = [];
      const segments = 120;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        orbitPts.push(new THREE.Vector3(
          Math.cos(angle) * this.orbitRadius,
          0,
          Math.sin(angle) * this.orbitRadius
        ));
      }
      this.orbitLine.geometry.setFromPoints(orbitPts);
      this.orbitLine.computeLineDistances();
    }
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

    // Satellite Orbit Motion (perfectly aligned with orbit ring inside orbitalPlaneGroup)
    if (this.isOrbiting && this.satelliteGroup && this.orbitalPlaneGroup) {
      this.orbitAngle += this.orbitSpeed;
      const x = Math.cos(this.orbitAngle) * this.orbitRadius;
      const z = Math.sin(this.orbitAngle) * this.orbitRadius;

      // In orbitalPlaneGroup coordinates, orbit ring is flat on X-Z plane
      this.satelliteGroup.position.set(x, 0, z);

      // Reorient satellite towards Earth core in world space
      this.satelliteGroup.lookAt(0, 0, 0);

      // Compute world position of satellite for line-of-sight & conical beam
      const satWorldPos = new THREE.Vector3();
      this.satelliteGroup.getWorldPosition(satWorldPos);

      // Update beam if target centroid is available
      if (this.currentData && this.currentData.centroid) {
        const cPos = this.latLonToSpherePos(this.currentData.centroid.lat, this.currentData.centroid.lon, 0.05);
        this.updateSatelliteBeam(cPos, satWorldPos);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

