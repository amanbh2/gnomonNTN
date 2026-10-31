/**
 * AMAN.GNOMON-NTN — 2D Gnomonic Tangent Plane View
 * Features:
 * - Local tangent plane touching Earth at Centroid (origin 0,0)
 * - Metric grid with kilometer markers (+X East, +Y North)
 * - Exact straight-line polygon edges (Gnomonic geodesic property)
 * - Animated horizontal ray-casting with laser pulses & glowing intersection pings
 * - Bidirectional dragging (2D -> Inverse Gnomonic -> 3D Globe)
 * - Pan and smooth zoom controls
 * 
 * Engineered with ❤️ & AI by Aman Bhaskar
 */

import { inverseGnomonic } from './gnomon-pip.js';

export class PlaneView {
  constructor(canvasElement, onUeMoved, onVertexMoved) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onUeMoved = onUeMoved;
    this.onVertexMoved = onVertexMoved;

    this.currentData = null;

    // Viewport transform
    this.scale = 1.0; // pixels per kilometer
    this.panX = 0;    // pixels from center
    this.panY = 0;    // pixels from center
    this.autoFitted = false;

    // Interactions
    this.isDraggingUE = false;
    this.isDraggingVertex = false;
    this.draggedVertexIndex = -1;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.hoveredVertexIndex = -1;

    // Animation state
    this.laserOffset = 0;
    this.pingPhase = 0;

    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Mouse / Touch Event Listeners
    this.setupInteractions();

    // Start render animation loop
    this.animate();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width || 600;
    this.height = rect.height || 500;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }

  setupInteractions() {
    const getCanvasMouse = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    // Coordinate conversions
    // Tangent plane: +X is East (right), +Y is North (up)
    // Canvas: +X is right, +Y is down
    this.kmToScreen = (xKm, yKm) => {
      const centerX = this.width / 2 + this.panX;
      const centerY = this.height / 2 + this.panY;
      return {
        x: centerX + xKm * this.scale,
        y: centerY - yKm * this.scale // invert Y
      };
    };

    this.screenToKm = (sx, sy) => {
      const centerX = this.width / 2 + this.panX;
      const centerY = this.height / 2 + this.panY;
      return {
        xKm: (sx - centerX) / this.scale,
        yKm: (centerY - sy) / this.scale
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      const m = getCanvasMouse(e);
      this.lastMouseX = m.x;
      this.lastMouseY = m.y;

      if (!this.currentData) return;

      // Check if clicking on UE Marker
      if (this.currentData.projectedUE && this.currentData.projectedUE.valid) {
        const ueScr = this.kmToScreen(this.currentData.projectedUE.xKm, this.currentData.projectedUE.yKm);
        const dist = Math.hypot(m.x - ueScr.x, m.y - ueScr.y);
        if (dist <= 16) {
          this.isDraggingUE = true;
          this.canvas.style.cursor = 'grabbing';
          return;
        }
      }

      // Check if clicking on a Vertex Marker
      if (this.currentData.projectedPolygon) {
        for (let i = 0; i < this.currentData.projectedPolygon.length; i++) {
          const v = this.currentData.projectedPolygon[i];
          const vScr = this.kmToScreen(v.xKm, v.yKm);
          const dist = Math.hypot(m.x - vScr.x, m.y - vScr.y);
          if (dist <= 14) {
            this.isDraggingVertex = true;
            this.draggedVertexIndex = i;
            this.canvas.style.cursor = 'grabbing';
            return;
          }
        }
      }

      // If clicked with Shift key -> move UE directly to clicked tangent point
      if (e.shiftKey) {
        const km = this.screenToKm(m.x, m.y);
        const inv = inverseGnomonic(km.xKm, km.yKm, this.currentData.centroid.lat, this.currentData.centroid.lon);
        if (this.onUeMoved) this.onUeMoved(inv.lat, inv.lon);
        return;
      }

      // Otherwise, initiate panning
      this.isPanning = true;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const m = getCanvasMouse(e);
      const dx = m.x - this.lastMouseX;
      const dy = m.y - this.lastMouseY;
      this.lastMouseX = m.x;
      this.lastMouseY = m.y;

      if (this.isDraggingUE && this.currentData) {
        const km = this.screenToKm(m.x, m.y);
        const inv = inverseGnomonic(km.xKm, km.yKm, this.currentData.centroid.lat, this.currentData.centroid.lon);
        if (this.onUeMoved) this.onUeMoved(inv.lat, inv.lon);
        return;
      }

      if (this.isDraggingVertex && this.draggedVertexIndex >= 0 && this.currentData) {
        const km = this.screenToKm(m.x, m.y);
        const inv = inverseGnomonic(km.xKm, km.yKm, this.currentData.centroid.lat, this.currentData.centroid.lon);
        if (this.onVertexMoved) this.onVertexMoved(this.draggedVertexIndex, inv.lat, inv.lon);
        return;
      }

      if (this.isPanning) {
        this.panX += dx;
        this.panY += dy;
        return;
      }

      // Hover feedback
      this.hoveredVertexIndex = -1;
      if (this.currentData) {
        if (this.currentData.projectedUE && this.currentData.projectedUE.valid) {
          const ueScr = this.kmToScreen(this.currentData.projectedUE.xKm, this.currentData.projectedUE.yKm);
          if (Math.hypot(m.x - ueScr.x, m.y - ueScr.y) <= 16) {
            this.canvas.style.cursor = 'grab';
            return;
          }
        }
        if (this.currentData.projectedPolygon) {
          for (let i = 0; i < this.currentData.projectedPolygon.length; i++) {
            const v = this.currentData.projectedPolygon[i];
            const vScr = this.kmToScreen(v.xKm, v.yKm);
            if (Math.hypot(m.x - vScr.x, m.y - vScr.y) <= 14) {
              this.hoveredVertexIndex = i;
              this.canvas.style.cursor = 'grab';
              return;
            }
          }
        }
      }
      this.canvas.style.cursor = 'default';
    });

    const stopDrag = () => {
      this.isDraggingUE = false;
      this.isDraggingVertex = false;
      this.draggedVertexIndex = -1;
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    };

    this.canvas.addEventListener('pointerup', stopDrag);
    this.canvas.addEventListener('pointerleave', stopDrag);

    // Zoom on wheel
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const m = getCanvasMouse(e);
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.1, Math.min(10.0, this.scale * zoomFactor));

      // Zoom towards mouse position
      const centerX = this.width / 2 + this.panX;
      const centerY = this.height / 2 + this.panY;
      const mouseKmX = (m.x - centerX) / this.scale;
      const mouseKmY = (centerY - m.y) / this.scale;

      this.scale = newScale;
      this.panX = m.x - this.width / 2 - mouseKmX * this.scale;
      this.panY = m.y - this.height / 2 + mouseKmY * this.scale;
    }, { passive: false });

    // Double-click to move UE to location
    this.canvas.addEventListener('dblclick', (e) => {
      if (!this.currentData) return;
      const m = getCanvasMouse(e);
      const km = this.screenToKm(m.x, m.y);
      const inv = inverseGnomonic(km.xKm, km.yKm, this.currentData.centroid.lat, this.currentData.centroid.lon);
      if (this.onUeMoved) this.onUeMoved(inv.lat, inv.lon);
    });
  }

  update(evalData) {
    this.currentData = evalData;

    // Auto-fit bounds on initial load or preset change
    if (!this.autoFitted && evalData.projectedPolygon && evalData.projectedPolygon.length > 0) {
      this.fitToBounds();
      this.autoFitted = true;
    }
  }

  fitToBounds() {
    if (!this.currentData || !this.currentData.projectedPolygon) return;
    const pts = this.currentData.projectedPolygon;
    if (pts.length === 0) return;

    let maxDist = 50;
    for (const p of pts) {
      const d = Math.hypot(p.xKm, p.yKm);
      if (d > maxDist) maxDist = d;
    }
    if (this.currentData.projectedUE && this.currentData.projectedUE.valid) {
      const ueDist = Math.hypot(this.currentData.projectedUE.xKm, this.currentData.projectedUE.yKm);
      if (ueDist > maxDist) maxDist = ueDist;
    }

    const availableSize = Math.min(this.width, this.height) * 0.75;
    this.scale = availableSize / (maxDist * 2.2);
    this.panX = 0;
    this.panY = 0;
  }

  resetView() {
    this.fitToBounds();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.laserOffset = (this.laserOffset + 1.8) % 24;
    this.pingPhase = (this.pingPhase + 0.08) % (Math.PI * 2);
    this.render();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Mission Control Background Grid
    this.drawBackgroundGrid(ctx);

    if (!this.currentData) return;

    // 2. Centroid Tangent Point (Origin 0,0)
    this.drawCentroid(ctx);

    // 3. Projected Polygon (Exact straight lines under Gnomonic projection)
    this.drawProjectedPolygon(ctx);

    // 4. Live Jordan Ray-Casting & Collision Pings
    this.drawRayCasting(ctx);

    // 5. Projected UE Pin
    this.drawUePin(ctx);

    // 6. Scale and Legend Overlay
    this.drawOverlayInfo(ctx);
  }

  drawBackgroundGrid(ctx) {
    const centerX = this.width / 2 + this.panX;
    const centerY = this.height / 2 + this.panY;

    // Adaptive grid step
    let gridKm = 100;
    if (this.scale > 1.8) gridKm = 20;
    else if (this.scale > 0.8) gridKm = 50;
    else if (this.scale > 0.3) gridKm = 100;
    else if (this.scale > 0.12) gridKm = 200;
    else if (this.scale > 0.05) gridKm = 500;
    else gridKm = 1000;

    const gridPx = gridKm * this.scale;

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;

    // Vertical lines
    const startX = (centerX % gridPx) - gridPx;
    for (let x = startX; x <= this.width + gridPx; x += gridPx) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    // Horizontal lines
    const startY = (centerY % gridPx) - gridPx;
    for (let y = startY; y <= this.height + gridPx; y += gridPx) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Concentric range circles from Centroid
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (let rKm = gridKm; rKm <= 3000; rKm += gridKm * 2) {
      const rPx = rKm * this.scale;
      ctx.beginPath();
      ctx.arc(centerX, centerY, rPx, 0, Math.PI * 2);
      ctx.stroke();

      // Range text
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(0, 242, 254, 0.3)';
      ctx.fillText(`${rKm} km`, centerX + rPx + 4, centerY - 4);
    }
    ctx.setLineDash([]);

    // Main Axes: +X East, +Y North
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
    ctx.lineWidth = 1.5;

    // X Axis (East/West)
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(this.width, centerY);
    ctx.stroke();

    // Y Axis (North/South)
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, this.height);
    ctx.stroke();

    // Axis Labels
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(0, 242, 254, 0.7)';
    ctx.fillText('+X (East)', this.width - 70, centerY - 8);
    ctx.fillText('-X (West)', 12, centerY - 8);
    ctx.fillText('+Y (North)', centerX + 8, 20);
    ctx.fillText('-Y (South)', centerX + 8, this.height - 12);
  }

  drawCentroid(ctx) {
    const cScr = this.kmToScreen(0, 0);

    // Amber glowing crosshair at (0, 0)
    ctx.strokeStyle = '#FFB800';
    ctx.lineWidth = 1.5;
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(cScr.x - s, cScr.y); ctx.lineTo(cScr.x + s, cScr.y);
    ctx.moveTo(cScr.x, cScr.y - s); ctx.lineTo(cScr.x, cScr.y + s);
    ctx.stroke();

    // Amber center dot
    ctx.fillStyle = '#FFB800';
    ctx.beginPath();
    ctx.arc(cScr.x, cScr.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB800';
    ctx.fillText('CENTROID (0,0)', cScr.x + 12, cScr.y + 14);
  }

  drawProjectedPolygon(ctx) {
    const pts = this.currentData.projectedPolygon;
    if (!pts || pts.length < 3) return;

    const screenPts = pts.map(p => this.kmToScreen(p.xKm, p.yKm));

    // 1. Polygon Fill
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.closePath();

    const isCw = this.currentData.winding ? this.currentData.winding.isClockwise : true;
    if (isCw) {
      ctx.fillStyle = 'rgba(0, 242, 254, 0.12)';
    } else {
      // Counter-Clockwise warning styling (red/amber trap)
      ctx.fillStyle = 'rgba(255, 184, 0, 0.16)';
    }
    ctx.fill();

    // 2. Polygon Edges (Straight line segments on Gnomonic plane)
    ctx.strokeStyle = isCw ? '#00F2FE' : '#FFB800';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = isCw ? 'rgba(0, 242, 254, 0.8)' : 'rgba(255, 184, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset

    // 3. Directional Traversal Arrows on Edges (Clockwise vs CCW indicator)
    for (let i = 0; i < screenPts.length; i++) {
      const p1 = screenPts[i];
      const p2 = screenPts[(i + 1) % screenPts.length];
      this.drawEdgeArrow(ctx, p1, p2, isCw ? '#00F2FE' : '#FFB800');
    }

    // 4. Vertex Pins & Labels
    for (let i = 0; i < screenPts.length; i++) {
      const pt = screenPts[i];
      const isHovered = this.hoveredVertexIndex === i;

      // Outer glow circle
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#00F2FE';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isHovered ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Vertex badge label (P1, P2...)
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = isHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.85)';
      const orig = pts[i];
      ctx.fillText(`P${i + 1} (${orig.xKm >= 0 ? '+' : ''}${orig.xKm.toFixed(0)}, ${orig.yKm >= 0 ? '+' : ''}${orig.yKm.toFixed(0)})`, pt.x + 8, pt.y - 6);
    }
  }

  drawEdgeArrow(ctx, p1, p2, color) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-5, -3.5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawRayCasting(ctx) {
    const ue = this.currentData.projectedUE;
    const ray = this.currentData.rayResult;
    if (!ue || !ue.valid || !ray) return;

    const ueScr = this.kmToScreen(ue.xKm, ue.yKm);

    // Horizontal ray shoots from UE to the right edge (+X direction)
    const rayEndX = this.width + 100;
    const rayY = ueScr.y;

    // 1. Ray beam path
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ueScr.x, rayY);
    ctx.lineTo(rayEndX, rayY);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.7)';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -this.laserOffset;
    ctx.stroke();
    ctx.restore();

    // 2. Animated Intersection Collision Pings
    if (ray.intersections && ray.intersections.length > 0) {
      for (let i = 0; i < ray.intersections.length; i++) {
        const hit = ray.intersections[i];
        const hitScr = this.kmToScreen(hit.xKm, hit.yKm);

        // Ping wave expanding circle
        const pingRadius = 6 + Math.sin(this.pingPhase) * 6;
        ctx.strokeStyle = '#00F2FE';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hitScr.x, hitScr.y, pingRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Solid hit dot
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(hitScr.x, hitScr.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Collision badge tag
        ctx.fillStyle = '#00F2FE';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(`HIT #${i + 1} (+${hit.xKm.toFixed(1)} km)`, hitScr.x + 8, hitScr.y - 10);
      }
    }

    // 3. Ray Tag summary badge
    const badgeText = `RAY: ${ray.crossings} CROSSING${ray.crossings === 1 ? '' : 'S'} (${ray.parity})`;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(badgeText).width;
    const badgeX = Math.min(this.width - textWidth - 24, ueScr.x + 40);
    const badgeY = rayY - 14;

    ctx.fillStyle = 'rgba(7, 10, 19, 0.85)';
    ctx.strokeStyle = ray.isInside ? '#00E676' : '#FF3B30';
    ctx.lineWidth = 1;
    ctx.fillRect(badgeX - 6, badgeY - 12, textWidth + 12, 18);
    ctx.strokeRect(badgeX - 6, badgeY - 12, textWidth + 12, 18);

    ctx.fillStyle = ray.isInside ? '#00E676' : '#FF3B30';
    ctx.fillText(badgeText, badgeX, badgeY + 1);
  }

  drawUePin(ctx) {
    const ue = this.currentData.projectedUE;
    if (!ue || !ue.valid) return;

    const ueScr = this.kmToScreen(ue.xKm, ue.yKm);
    const isInside = this.currentData.finalDecision;
    const color = isInside ? '#00E676' : '#FF3B30';

    // Concentric pulsing radar ring
    const pingR = 12 + Math.sin(this.pingPhase) * 4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ueScr.x, ueScr.y, pingR, 0, Math.PI * 2);
    ctx.stroke();

    // Inner glowing sphere
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ueScr.x, ueScr.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // reset

    // White center pip
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ueScr.x, ueScr.y, 2, 0, Math.PI * 2);
    ctx.fill();

    // Label with tangent coordinates
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.fillText(`UE (${ue.xKm >= 0 ? '+' : ''}${ue.xKm.toFixed(1)}, ${ue.yKm >= 0 ? '+' : ''}${ue.yKm.toFixed(1)} km)`, ueScr.x + 12, ueScr.y + 16);
  }

  drawOverlayInfo(ctx) {
    // Tangent plane info banner in bottom-left
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(`Scale: 1px = ${(1 / this.scale).toFixed(2)} km | Tangent Origin: Cell Centroid (0,0)`, 14, this.height - 14);

    // Tip in top-left
    ctx.fillStyle = 'rgba(0, 242, 254, 0.7)';
    ctx.fillText('💡 Drag UE or Vertices | Shift+Click to place | Scroll to Zoom', 14, 24);
  }
}

