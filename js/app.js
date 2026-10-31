/**
 * AMAN.GNOMON-NTN — Main Application Orchestrator
 * Coordinates:
 * - 3D Globe View & 2D Tangent Plane View
 * - Mathematical Evaluation Pipeline (MBR -> Gnomonic -> Ray-Cast)
 * - Real-Time Telemetry HUD & Decision Status Badges
 * - Preset Scenarios & Interactive Controls
 * - ASN.1 Live Inspector
 * - Code & Theory Inspection Modals
 * 
 * Engineered with ❤️ & AI by Aman Bhaskar
 */

import {
  evaluateCellPip,
  SCENARIO_PRESETS,
  latDegToAsn1,
  lonDegToAsn1
} from './gnomon-pip.js';

import { GlobeView } from './globe-view.js';
import { PlaneView } from './plane-view.js';
import { CODE_SNIPPETS } from './code-snippets.js';

class AppController {
  constructor() {
    // Application State
    this.currentPresetKey = 'hexagonal';
    this.polygonVertices = JSON.parse(JSON.stringify(SCENARIO_PRESETS.hexagonal.vertices));
    this.ueCoord = { ...SCENARIO_PRESETS.hexagonal.ue };
    this.forceWinding = 'cw'; // 'cw' or 'ccw'
    this.satelliteAltitudeKm = 550;
    this.isOrbiting = true;

    // View References
    this.globeView = null;
    this.planeView = null;
    this.lastEvaluation = null;

    this.init();
  }

  init() {
    try {
      // 1. Initialize Views
      const globeContainer = document.getElementById('globe-container');
      const planeCanvas = document.getElementById('plane-canvas');

      try {
        this.globeView = new GlobeView(
          globeContainer,
          (lat, lon) => this.onUeMoved(lat, lon),
          (index, lat, lon) => this.onVertexMoved(index, lat, lon)
        );
      } catch (err) {
        console.error('Error initializing GlobeView:', err);
      }

      try {
        this.planeView = new PlaneView(
          planeCanvas,
          (lat, lon) => this.onUeMoved(lat, lon),
          (index, lat, lon) => this.onVertexMoved(index, lat, lon)
        );
      } catch (err) {
        console.error('Error initializing PlaneView:', err);
      }

      // 2. Setup UI Event Listeners
      this.setupControlListeners();
      this.setupModals();

      // 3. Initial Evaluation & Render
      this.evaluateAndSync();

      // Auto-focus camera on cell after small delay for Three.js layout
      setTimeout(() => {
        if (this.globeView) this.globeView.focusOnCell();
      }, 400);
    } catch (err) {
      console.error('AppController init failed:', err);
    }
  }

  onUeMoved(lat, lon) {
    // Clamp coordinates
    const clampedLat = Math.max(-90.0, Math.min(90.0, lat));
    let clampedLon = lon;
    while (clampedLon > 180) clampedLon -= 360;
    while (clampedLon < -180) clampedLon += 360;

    this.ueCoord = { lat: clampedLat, lon: clampedLon };
    this.evaluateAndSync();
  }

  onVertexMoved(index, lat, lon) {
    if (index >= 0 && index < this.polygonVertices.length) {
      const clampedLat = Math.max(-90.0, Math.min(90.0, lat));
      let clampedLon = lon;
      while (clampedLon > 180) clampedLon -= 360;
      while (clampedLon < -180) clampedLon += 360;

      this.polygonVertices[index] = { lat: clampedLat, lon: clampedLon };
      this.evaluateAndSync();
    }
  }

  evaluateAndSync() {
    try {
      // Run mathematical evaluation pipeline
      this.lastEvaluation = evaluateCellPip(this.polygonVertices, this.ueCoord, this.forceWinding);

      // Update synchronized views
      if (this.globeView) {
        try {
          this.globeView.update(this.lastEvaluation);
        } catch (err) {
          console.error('Error updating GlobeView:', err);
        }
      }

      if (this.planeView) {
        try {
          this.planeView.update(this.lastEvaluation);
        } catch (err) {
          console.error('Error updating PlaneView:', err);
        }
      }

      // Update Telemetry HUD & Badges
      this.updateTelemetryHUD(this.lastEvaluation);

      // Update Vertices Table Editor in sidebar
      this.updateVerticesListUI();
    } catch (err) {
      console.error('Error in evaluateAndSync:', err);
    }
  }

  updateTelemetryHUD(data) {
    // 1. Decision Status Badge
    const decisionBadge = document.getElementById('decision-badge');
    const decisionText = document.getElementById('decision-text');
    const decisionSubtext = document.getElementById('decision-subtext');

    if (data.finalDecision) {
      decisionBadge.className = 'status-badge status-inside';
      decisionText.textContent = 'INSIDE CELL';
      decisionSubtext.textContent = `ODD Ray Crossings (${data.rayResult.crossings}) • SIB19 Cell Match`;
    } else {
      decisionBadge.className = 'status-badge status-outside';
      decisionText.textContent = 'OUTSIDE CELL';
      if (!data.mbrResult.pass) {
        decisionSubtext.textContent = 'Tier-1 MBR Fast Reject (O(1))';
      } else if (!data.projectedUE.valid) {
        decisionSubtext.textContent = 'Beyond Tangent Horizon (cos c ≤ 0)';
      } else {
        decisionSubtext.textContent = `EVEN Ray Crossings (${data.rayResult.crossings}) • Outside Polygon`;
      }
    }

    // 2. Algorithmic Pipeline Telemetry Cards
    // Tier 1 MBR Card
    const mbrStatus = document.getElementById('telemetry-mbr-status');
    const mbrBounds = document.getElementById('telemetry-mbr-bounds');
    if (data.mbrResult.pass) {
      mbrStatus.textContent = 'PASS';
      mbrStatus.className = 'telemetry-val pass';
    } else {
      mbrStatus.textContent = 'FAST REJECT';
      mbrStatus.className = 'telemetry-val reject';
    }
    const b = data.mbrResult.bounds;
    if (b) {
      if (b.crossesAntimeridian) {
        mbrBounds.textContent = `Lat: [${b.latMin.toFixed(2)}°, ${b.latMax.toFixed(2)}°] | Lon: [${b.eastMin.toFixed(2)}°, 180°] ∪ [-180°, ${b.westMax.toFixed(2)}°]`;
      } else {
        mbrBounds.textContent = `Lat: [${b.latMin.toFixed(2)}°, ${b.latMax.toFixed(2)}°] | Lon: [${b.lonMin.toFixed(2)}°, ${b.lonMax.toFixed(2)}°]`;
      }
    }

    // Centroid Card
    const centroidDeg = document.getElementById('telemetry-centroid-deg');
    const centroidAsn = document.getElementById('telemetry-centroid-asn');
    centroidDeg.textContent = `${data.centroid.lat.toFixed(4)}°${data.centroid.lat >= 0 ? 'N' : 'S'}, ${data.centroid.lon.toFixed(4)}°${data.centroid.lon >= 0 ? 'E' : 'W'}`;
    centroidAsn.textContent = `Lat: ${data.centroidAsn1.lat.degreesLatitude} (${data.centroidAsn1.lat.latitudeSign}) | Lon: ${data.centroidAsn1.lon.degreesLongitude}`;

    // Gnomonic Cosine Factor
    const cosCVal = document.getElementById('telemetry-cos-c');
    const cosCStatus = document.getElementById('telemetry-cos-status');
    if (data.projectedUE.valid) {
      cosCVal.textContent = data.projectedUE.cosC.toFixed(5);
      cosCVal.className = 'telemetry-val pass';
      cosCStatus.textContent = `Central angle c = ${data.projectedUE.centralAngleDeg.toFixed(2)}° (Horizon > 0)`;
    } else {
      cosCVal.textContent = '≤ 0.00000';
      cosCVal.className = 'telemetry-val reject';
      cosCStatus.textContent = 'Horizon exceeded (Opposite hemisphere)';
    }

    // Tangent Coordinates (UE)
    const ueTangent = document.getElementById('telemetry-ue-tangent');
    const ueDist = document.getElementById('telemetry-ue-dist');
    if (data.projectedUE.valid) {
      ueTangent.textContent = `X: ${data.projectedUE.xKm >= 0 ? '+' : ''}${data.projectedUE.xKm.toFixed(1)} km, Y: ${data.projectedUE.yKm >= 0 ? '+' : ''}${data.projectedUE.yKm.toFixed(1)} km`;
      ueDist.textContent = `Distance to Centroid: ${data.distanceToCentroidKm.toFixed(1)} km`;
    } else {
      ueTangent.textContent = 'N/A (Beyond Horizon)';
      ueDist.textContent = `Distance: ${data.distanceToCentroidKm.toFixed(1)} km`;
    }

    // Ray Crossing Count & Parity
    const rayCount = document.getElementById('telemetry-ray-count');
    const rayParity = document.getElementById('telemetry-ray-parity');
    rayCount.textContent = `${data.rayResult.crossings} Intersection${data.rayResult.crossings === 1 ? '' : 's'}`;
    rayParity.textContent = `Parity: ${data.rayResult.parity} (${data.rayResult.isInside ? 'Interior' : 'Exterior'})`;
    rayCount.className = data.rayResult.isInside ? 'telemetry-val pass' : 'telemetry-val';

    // Winding Order & Trap Warning
    const windingStatus = document.getElementById('telemetry-winding-status');
    const trapWarningBox = document.getElementById('trap-warning-box');
    if (data.winding.isClockwise) {
      windingStatus.textContent = 'CLOCKWISE (Valid 3GPP Interior)';
      windingStatus.className = 'telemetry-val pass';
      trapWarningBox.style.display = 'none';
    } else {
      windingStatus.textContent = 'COUNTER-CLOCKWISE (Outer Space Trap!)';
      windingStatus.className = 'telemetry-val reject';
      trapWarningBox.style.display = 'block';
      trapWarningBox.innerHTML = `
        <strong>🪤 3GPP TS 23.032 Clause 5.3 Right-Hand Rule Trap Active:</strong>
        Vertices are ordered counter-clockwise. The standard defines the interior to the <em>right</em> of perimeter traversal. This inverts the geometry, treating the rest of the planet as inside!
      `;
    }

    // 3. Live 3GPP ASN.1 Inspector Code Box
    this.updateAsn1Inspector(data);
  }

  updateAsn1Inspector(data) {
    const inspectorElem = document.getElementById('asn1-inspector-content');
    if (!inspectorElem) return;

    let asn1Lines = [];
    asn1Lines.push(`-- 3GPP TS 38.331 SIB19 cellGeoArea / TS 23.032 Clause 5.3`);
    asn1Lines.push(`CellGeoArea ::= SEQUENCE {`);
    asn1Lines.push(`  polygon ::= SEQUENCE (SIZE (${data.vertices.length})) OF GeographicalCoordinates {`);

    data.vertices.forEach((v, idx) => {
      const asnLat = latDegToAsn1(v.lat);
      const asnLon = lonDegToAsn1(v.lon);
      asn1Lines.push(`    -- Vertex #${idx + 1} (${v.lat.toFixed(4)}°, ${v.lon.toFixed(4)}°)`);
      asn1Lines.push(`    { latitudeSign: ${asnLat.latitudeSign}, degreesLatitude: ${asnLat.degreesLatitude}, degreesLongitude: ${asnLon.degreesLongitude} },`);
    });

    asn1Lines.push(`  }`);
    asn1Lines.push(`}`);
    asn1Lines.push(``);
    asn1Lines.push(`-- Test UE Position (Current GNSS Telemetry)`);
    const ueLat = latDegToAsn1(data.ueCoord.lat);
    const ueLon = lonDegToAsn1(data.ueCoord.lon);
    asn1Lines.push(`UeLocation ::= GeographicalCoordinates {`);
    asn1Lines.push(`  latitudeSign:      ${ueLat.latitudeSign},`);
    asn1Lines.push(`  degreesLatitude:   ${ueLat.degreesLatitude},   -- ${(data.ueCoord.lat).toFixed(5)}°`);
    asn1Lines.push(`  degreesLongitude:  ${ueLon.degreesLongitude}   -- ${(data.ueCoord.lon).toFixed(5)}°`);
    asn1Lines.push(`}`);

    inspectorElem.textContent = asn1Lines.join('\n');
  }

  updateVerticesListUI() {
    const listContainer = document.getElementById('vertices-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    this.polygonVertices.forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'vertex-row';

      row.innerHTML = `
        <span class="vertex-idx">P${idx + 1}</span>
        <div class="vertex-inputs">
          <label>Lat: <input type="number" step="0.01" value="${v.lat.toFixed(4)}" data-idx="${idx}" data-field="lat" class="coord-input" /></label>
          <label>Lon: <input type="number" step="0.01" value="${v.lon.toFixed(4)}" data-idx="${idx}" data-field="lon" class="coord-input" /></label>
        </div>
        ${this.polygonVertices.length > 3 ? `<button class="btn-remove-vertex" data-idx="${idx}" title="Remove vertex">✕</button>` : ''}
      `;

      listContainer.appendChild(row);
    });

    // Wire up inputs
    listContainer.querySelectorAll('.coord-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
          this.polygonVertices[idx][field] = val;
          this.evaluateAndSync();
        }
      });
    });

    listContainer.querySelectorAll('.btn-remove-vertex').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.removeVertex(idx);
      });
    });

    // Update Vertex Count Badge
    const countBadge = document.getElementById('vertex-count-badge');
    if (countBadge) {
      countBadge.textContent = `${this.polygonVertices.length} / 15 Vertices`;
    }
  }

  addVertex() {
    if (this.polygonVertices.length >= 15) {
      alert('Maximum 15 vertices allowed under 3GPP TS 23.032 Clause 5.3');
      return;
    }
    // Insert new vertex between last and first
    const n = this.polygonVertices.length;
    const pLast = this.polygonVertices[n - 1];
    const pFirst = this.polygonVertices[0];
    const newLat = (pLast.lat + pFirst.lat) / 2;
    const newLon = (pLast.lon + pFirst.lon) / 2;

    this.polygonVertices.push({ lat: newLat, lon: newLon });
    this.evaluateAndSync();
  }

  removeVertex(index) {
    if (this.polygonVertices.length <= 3) {
      alert('Minimum 3 vertices required for a valid polygon under 3GPP TS 23.032');
      return;
    }
    this.polygonVertices.splice(index, 1);
    this.evaluateAndSync();
  }

  loadPreset(presetKey) {
    const preset = SCENARIO_PRESETS[presetKey];
    if (!preset) return;

    this.currentPresetKey = presetKey;
    this.polygonVertices = JSON.parse(JSON.stringify(preset.vertices));
    this.ueCoord = { ...preset.ue };
    this.satelliteAltitudeKm = preset.altitudeKm || 550;

    // Update Globe view parameters
    this.globeView.setSatelliteAltitude(this.satelliteAltitudeKm);

    // Reset plane view auto-fit flag
    this.planeView.autoFitted = false;

    // Run evaluation
    this.evaluateAndSync();

    // Focus camera
    this.globeView.focusOnCell();
  }

  setupControlListeners() {
    // Presets selector
    const presetSelect = document.getElementById('preset-select');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.loadPreset(e.target.value);
      });
    }

    // Winding order toggle
    const windingToggle = document.getElementById('winding-toggle');
    if (windingToggle) {
      windingToggle.addEventListener('change', (e) => {
        this.forceWinding = e.target.checked ? 'ccw' : 'cw';
        this.evaluateAndSync();
      });
    }

    // Add Vertex button
    const addVertexBtn = document.getElementById('btn-add-vertex');
    if (addVertexBtn) {
      addVertexBtn.addEventListener('click', () => this.addVertex());
    }

    // Focus cell on 3D globe button
    const btnFocusCell = document.getElementById('btn-focus-cell');
    if (btnFocusCell) {
      btnFocusCell.addEventListener('click', () => {
        this.globeView.focusOnCell();
      });
    }

    // Reset 3D camera button
    const btnResetGlobe = document.getElementById('btn-reset-globe');
    if (btnResetGlobe) {
      btnResetGlobe.addEventListener('click', () => {
        this.globeView.resetCamera();
      });
    }

    // Reset 2D Plane zoom button
    const btnResetPlane = document.getElementById('btn-reset-plane');
    if (btnResetPlane) {
      btnResetPlane.addEventListener('click', () => {
        this.planeView.resetView();
      });
    }

    // Satellite Orbit toggle
    const orbitToggle = document.getElementById('orbit-toggle');
    if (orbitToggle) {
      orbitToggle.addEventListener('change', (e) => {
        this.isOrbiting = e.target.checked;
        this.globeView.setOrbitActive(this.isOrbiting);
      });
    }

    // Satellite Altitude slider
    const altSlider = document.getElementById('altitude-slider');
    const altDisplay = document.getElementById('altitude-display');
    if (altSlider && altDisplay) {
      altSlider.addEventListener('input', (e) => {
        const alt = parseInt(e.target.value, 10);
        this.satelliteAltitudeKm = alt;
        altDisplay.textContent = `${alt} km`;
        this.globeView.setSatelliteAltitude(alt);
      });
    }

    // Manual UE Coordinate inputs
    const ueLatInput = document.getElementById('ue-lat-input');
    const ueLonInput = document.getElementById('ue-lon-input');
    const btnApplyUe = document.getElementById('btn-apply-ue');
    if (btnApplyUe && ueLatInput && ueLonInput) {
      btnApplyUe.addEventListener('click', () => {
        const lat = parseFloat(ueLatInput.value);
        const lon = parseFloat(ueLonInput.value);
        if (!isNaN(lat) && !isNaN(lon)) {
          this.onUeMoved(lat, lon);
        }
      });
    }
  }

  setupModals() {
    // 1. Code Inspector Modal
    const codeModal = document.getElementById('code-modal');
    const btnOpenCode = document.getElementById('btn-open-code');
    const btnCloseCode = document.getElementById('btn-close-code');
    const tabBtnC = document.getElementById('tab-btn-c');
    const tabBtnJs = document.getElementById('tab-btn-js');
    const codeBlock = document.getElementById('code-block-content');
    const btnCopyCode = document.getElementById('btn-copy-code');
    const btnDownloadCode = document.getElementById('btn-download-code');
    let currentCodeTab = 'c';

    const renderCodeTab = (tab) => {
      currentCodeTab = tab;
      if (tab === 'c') {
        tabBtnC.classList.add('active');
        tabBtnJs.classList.remove('active');
        codeBlock.textContent = CODE_SNIPPETS.c;
      } else {
        tabBtnJs.classList.add('active');
        tabBtnC.classList.remove('active');
        codeBlock.textContent = CODE_SNIPPETS.js;
      }
    };

    if (btnOpenCode && codeModal) {
      btnOpenCode.addEventListener('click', () => {
        renderCodeTab('c');
        codeModal.classList.add('modal-visible');
      });
    }

    if (btnCloseCode && codeModal) {
      btnCloseCode.addEventListener('click', () => {
        codeModal.classList.remove('modal-visible');
      });
    }

    if (tabBtnC && tabBtnJs) {
      tabBtnC.addEventListener('click', () => renderCodeTab('c'));
      tabBtnJs.addEventListener('click', () => renderCodeTab('js'));
    }

    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        const text = currentCodeTab === 'c' ? CODE_SNIPPETS.c : CODE_SNIPPETS.js;
        navigator.clipboard.writeText(text).then(() => {
          btnCopyCode.textContent = '✓ Copied!';
          setTimeout(() => { btnCopyCode.textContent = 'Copy Code'; }, 2000);
        });
      });
    }

    if (btnDownloadCode) {
      btnDownloadCode.addEventListener('click', () => {
        const text = currentCodeTab === 'c' ? CODE_SNIPPETS.c : CODE_SNIPPETS.js;
        const filename = currentCodeTab === 'c' ? 'isLocationInCellGeoArea.c' : 'gnomonPip.js';
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // 2. Theory & 3GPP Specs Modal
    const theoryModal = document.getElementById('theory-modal');
    const btnOpenTheory = document.getElementById('btn-open-theory');
    const btnCloseTheory = document.getElementById('btn-close-theory');

    if (btnOpenTheory && theoryModal) {
      btnOpenTheory.addEventListener('click', () => {
        theoryModal.classList.add('modal-visible');
      });
    }

    if (btnCloseTheory && theoryModal) {
      btnCloseTheory.addEventListener('click', () => {
        theoryModal.classList.remove('modal-visible');
      });
    }

    // Close on backdrop click
    window.addEventListener('click', (e) => {
      if (e.target === codeModal) codeModal.classList.remove('modal-visible');
      if (e.target === theoryModal) theoryModal.classList.remove('modal-visible');
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (codeModal) codeModal.classList.remove('modal-visible');
        if (theoryModal) theoryModal.classList.remove('modal-visible');
      }
    });
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.gnomonApp = new AppController();
});

