/**
 * AMAN.GNOMON-NTN — Mathematical & 3GPP PIP Simulation Engine
 * Conforms to:
 * - 3GPP TS 23.032 Clause 5.3 (Universal Geographical Area Description - Polygon)
 * - 3GPP TS 38.331 Clause 6.3.2 (SIB19 - SystemInformationBlockType19 cellGeoArea)
 * 
 * Engineered with ❤️ & AI by Aman Bhaskar
 */

export const EARTH_RADIUS_KM = 6371.0088; // WGS-84 authalic sphere / 3GPP mean Earth radius

export const DEG_TO_RAD = Math.PI / 180.0;
export const RAD_TO_DEG = 180.0 / Math.PI;

/**
 * 3GPP TS 23.032 ASN.1 Encoding & Decoding
 * 
 * Latitude: 23 bits (0 to 8388607) representing 0° to 90°
 * N = round( (lat / 90) * 2^23 )
 * 
 * Longitude: 24 bits (-8388608 to 8388607) representing -180° to +180°
 * N = round( (lon / 360) * 2^24 )
 */
export function latDegToAsn1(latDeg) {
  const sign = latDeg >= 0 ? 'north' : 'south';
  const absLat = Math.min(90.0, Math.max(0.0, Math.abs(latDeg)));
  const scale = 8388608; // 2^23
  const degreesLatitude = Math.min(scale - 1, Math.round((absLat / 90.0) * scale));
  return {
    latitudeSign: sign,
    degreesLatitude,
    binaryString: `sign=${sign}, degreesLatitude=${degreesLatitude} (0x${degreesLatitude.toString(16).toUpperCase()})`
  };
}

export function asn1ToLatDeg(sign, degreesLatitude) {
  const scale = 8388608; // 2^23
  const mag = (degreesLatitude * 90.0) / scale;
  return sign === 'south' || sign === 1 ? -mag : mag;
}

export function lonDegToAsn1(lonDeg) {
  // Wrap lon to [-180, 180]
  let lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  const scale = 16777216; // 2^24
  let degreesLongitude = Math.round((lon / 360.0) * scale);
  if (degreesLongitude > 8388607) degreesLongitude = 8388607;
  if (degreesLongitude < -8388608) degreesLongitude = -8388608;
  return {
    degreesLongitude,
    binaryString: `degreesLongitude=${degreesLongitude} (0x${(degreesLongitude >>> 0).toString(16).toUpperCase()})`
  };
}

export function asn1ToLonDeg(degreesLongitude) {
  const scale = 16777216; // 2^24
  return (degreesLongitude * 360.0) / scale;
}

/**
 * 3D Vector Math on Unit Sphere
 */
export function latLonToUnitVector(latDeg, lonDeg) {
  const phi = latDeg * DEG_TO_RAD;
  const lambda = lonDeg * DEG_TO_RAD;
  return {
    x: Math.cos(phi) * Math.cos(lambda),
    y: Math.cos(phi) * Math.sin(lambda),
    z: Math.sin(phi)
  };
}

export function unitVectorToLatLon(v) {
  const norm = Math.hypot(v.x, v.y, v.z) || 1.0;
  const zClamped = Math.max(-1.0, Math.min(1.0, v.z / norm));
  const lat = Math.asin(zClamped) * RAD_TO_DEG;
  const lon = Math.atan2(v.y, v.x) * RAD_TO_DEG;
  return { lat, lon };
}

/**
 * Spherical Linear Interpolation (SLERP) for geodesic arcs
 */
export function slerp(v1, v2, t) {
  let dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  dot = Math.max(-1.0, Math.min(1.0, dot));
  const theta = Math.acos(dot);
  if (Math.abs(theta) < 1e-6) {
    const vx = v1.x + (v2.x - v1.x) * t;
    const vy = v1.y + (v2.y - v1.y) * t;
    const vz = v1.z + (v2.z - v1.z) * t;
    const len = Math.hypot(vx, vy, vz) || 1;
    return { x: vx / len, y: vy / len, z: vz / len };
  }
  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;
  return {
    x: a * v1.x + b * v2.x,
    y: a * v1.y + b * v2.y,
    z: a * v1.z + b * v2.z
  };
}

/**
 * Great-circle distance between two coordinates in kilometers
 */
export function greatCircleDistanceKm(lat1, lon1, lat2, lon2) {
  const v1 = latLonToUnitVector(lat1, lon1);
  const v2 = latLonToUnitVector(lat2, lon2);
  let dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  dot = Math.max(-1.0, Math.min(1.0, dot));
  return Math.acos(dot) * EARTH_RADIUS_KM;
}

/**
 * Compute the 3D Spherical Centroid of a polygon.
 * Averaging unit vectors natively resolves the 180° antimeridian jump
 * without longitude modulo discontinuities!
 */
export function computeSphericalCentroid(vertices) {
  if (!vertices || vertices.length === 0) {
    return { lat: 0, lon: 0, vector: { x: 1, y: 0, z: 0 } };
  }
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const v of vertices) {
    const u = latLonToUnitVector(v.lat, v.lon);
    sumX += u.x;
    sumY += u.y;
    sumZ += u.z;
  }
  const len = Math.hypot(sumX, sumY, sumZ) || 1.0;
  const unit = { x: sumX / len, y: sumY / len, z: sumZ / len };
  const { lat, lon } = unitVectorToLatLon(unit);
  return { lat, lon, vector: unit };
}

/**
 * Tier 1: Minimum Bounding Rectangle (MBR) Fast-Reject Filter
 * Handles 180° Antimeridian split seamlessly.
 */
export function checkTier1Mbr(vertices, ueCoord) {
  if (!vertices || vertices.length === 0) {
    return { pass: false, reason: 'Empty polygon', bounds: null };
  }

  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;

  // Check if cell spans across antimeridian
  let hasPositiveLon = false;
  let hasNegativeLon = false;
  let crossesAntimeridian = false;

  for (let i = 0; i < vertices.length; i++) {
    const lat = vertices[i].lat;
    const lon = vertices[i].lon;
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;

    if (lon > 90) hasPositiveLon = true;
    if (lon < -90) hasNegativeLon = true;

    // Check adjacent edge jump
    const nextLon = vertices[(i + 1) % vertices.length].lon;
    if (Math.abs(lon - nextLon) > 180) {
      crossesAntimeridian = true;
    }
  }

  if (hasPositiveLon && hasNegativeLon && (lonMax - lonMin > 180)) {
    crossesAntimeridian = true;
  }

  // Latitude check
  const latPass = ueCoord.lat >= latMin - 1e-7 && ueCoord.lat <= latMax + 1e-7;

  let lonPass = false;
  let eastMin = 180;
  let westMax = -180;

  if (crossesAntimeridian) {
    // Polygon is split across 180°
    for (const v of vertices) {
      if (v.lon >= 0 && v.lon < eastMin) eastMin = v.lon;
      if (v.lon < 0 && v.lon > westMax) westMax = v.lon;
    }
    // UE passes if it is east of eastMin OR west of westMax
    lonPass = (ueCoord.lon >= eastMin - 1e-7 && ueCoord.lon <= 180.0) ||
              (ueCoord.lon <= westMax + 1e-7 && ueCoord.lon >= -180.0);
  } else {
    lonPass = ueCoord.lon >= lonMin - 1e-7 && ueCoord.lon <= lonMax + 1e-7;
  }

  const pass = latPass && lonPass;
  const reason = pass 
    ? 'PASS: UE coordinates reside within Tier-1 MBR envelope'
    : (!latPass ? 'FAST REJECT: UE Latitude outside MBR' : 'FAST REJECT: UE Longitude outside MBR');

  return {
    pass,
    reason,
    crossesAntimeridian,
    bounds: {
      latMin,
      latMax,
      lonMin: crossesAntimeridian ? eastMin : lonMin,
      lonMax: crossesAntimeridian ? westMax : lonMax,
      crossesAntimeridian,
      eastMin: crossesAntimeridian ? eastMin : null,
      westMax: crossesAntimeridian ? westMax : null
    }
  };
}

/**
 * Stage 3: Gnomonic Projection
 * Projects spherical coordinates (lat, lon) onto a tangent plane touching at (lat0, lon0).
 * 
 * Central Angle c:
 * cos(c) = sin(phi0)*sin(phi) + cos(phi0)*cos(phi)*cos(lambda - lambda0)
 * 
 * Tangent Coordinates:
 * x = cos(phi)*sin(lambda - lambda0) / cos(c)
 * y = [cos(phi0)*sin(phi) - sin(phi0)*cos(phi)*cos(lambda - lambda0)] / cos(c)
 * 
 * Metric Coordinates:
 * X_km = R * x
 * Y_km = R * y
 */
export function projectGnomonic(latDeg, lonDeg, lat0Deg, lon0Deg) {
  const phi = latDeg * DEG_TO_RAD;
  const phi0 = lat0Deg * DEG_TO_RAD;
  
  // Wrap deltaLon into [-PI, +PI]
  let deltaLonDeg = lonDeg - lon0Deg;
  while (deltaLonDeg > 180) deltaLonDeg -= 360;
  while (deltaLonDeg < -180) deltaLonDeg += 360;
  const deltaLon = deltaLonDeg * DEG_TO_RAD;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const cosDeltaLon = Math.cos(deltaLon);
  const sinDeltaLon = Math.sin(deltaLon);

  const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDeltaLon;

  // Horizon check: Gnomonic projection is defined only for the hemisphere facing the tangent point (cos(c) > 0)
  if (cosC <= 0.00001) {
    return {
      valid: false,
      cosC,
      centralAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosC))) * RAD_TO_DEG,
      x: 0,
      y: 0,
      xKm: 0,
      yKm: 0,
      reason: 'Beyond tangent plane horizon (cos(c) <= 0)'
    };
  }

  const x = (cosPhi * sinDeltaLon) / cosC;
  const y = (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDeltaLon) / cosC;

  return {
    valid: true,
    cosC,
    centralAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosC))) * RAD_TO_DEG,
    x,
    y,
    xKm: x * EARTH_RADIUS_KM,
    yKm: y * EARTH_RADIUS_KM,
    reason: 'Projected cleanly onto Gnomonic tangent plane'
  };
}

/**
 * Inverse Gnomonic Projection
 * Converts tangent coordinates (X_km, Y_km) back into spherical (lat, lon).
 */
export function inverseGnomonic(xKm, yKm, lat0Deg, lon0Deg) {
  const x = xKm / EARTH_RADIUS_KM;
  const y = yKm / EARTH_RADIUS_KM;
  const rho = Math.hypot(x, y);

  if (rho < 1e-12) {
    return { lat: lat0Deg, lon: lon0Deg };
  }

  const c = Math.atan(rho);
  const cosC = Math.cos(c);
  const sinC = Math.sin(c);
  const phi0 = lat0Deg * DEG_TO_RAD;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);

  const sinPhi = cosC * sinPhi0 + (y * sinC * cosPhi0) / rho;
  const phi = Math.asin(Math.max(-1.0, Math.min(1.0, sinPhi)));

  const numer = x * sinC;
  const denom = rho * cosPhi0 * cosC - y * sinPhi0 * sinC;
  const deltaLon = Math.atan2(numer, denom);

  let lat = phi * RAD_TO_DEG;
  let lon = lon0Deg + deltaLon * RAD_TO_DEG;

  // Wrap lon to [-180, +180]
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;

  return { lat, lon };
}

/**
 * Stage 4: Jordan Curve Parity Ray-Casting on 2D Tangent Plane
 * Shoots a horizontal ray from testPoint (x0, y0) towards +X (x -> +infinity).
 */
export function jordanRayCast(projectedPolygon, testPoint) {
  let crossings = 0;
  const intersections = [];
  const n = projectedPolygon.length;

  const x0 = testPoint.xKm;
  const y0 = testPoint.yKm;

  for (let i = 0; i < n; i++) {
    const p1 = projectedPolygon[i];
    const p2 = projectedPolygon[(i + 1) % n];

    // Check if edge straddles the horizontal scanline y = y0
    // Standard Jordan rule: strictly one vertex above, one on or below
    const straddles = (p1.yKm > y0) !== (p2.yKm > y0);

    if (straddles) {
      // Calculate intersection x coordinate
      const dy = p2.yKm - p1.yKm;
      const dx = p2.xKm - p1.xKm;
      const xInt = p1.xKm + ((y0 - p1.yKm) / dy) * dx;

      if (xInt >= x0) {
        crossings++;
        intersections.push({
          edgeIndex: i,
          vertexA: i,
          vertexB: (i + 1) % n,
          xKm: xInt,
          yKm: y0,
          p1,
          p2
        });
      }
    }
  }

  // Parity rule: ODD crossings = INSIDE, EVEN crossings = OUTSIDE
  const isInside = (crossings % 2) === 1;

  return {
    isInside,
    crossings,
    parity: crossings % 2 === 1 ? 'ODD' : 'EVEN',
    intersections
  };
}

/**
 * 3GPP TS 23.032 Clause 5.3 Winding Order & Signed Area
 * Traversal must be Clockwise for the interior to be to the right.
 */
export function checkWindingOrder(projectedPolygon) {
  let sum = 0;
  const n = projectedPolygon.length;
  for (let i = 0; i < n; i++) {
    const p1 = projectedPolygon[i];
    const p2 = projectedPolygon[(i + 1) % n];
    sum += (p1.xKm * p2.yKm - p2.xKm * p1.yKm);
  }
  const signedArea = 0.5 * sum;
  // In Cartesian (+X East, +Y North), a Clockwise polygon has negative signed area
  // (Shoelace formula yields negative for CW, positive for CCW).
  const isClockwise = signedArea < 0;
  const areaKm2 = Math.abs(signedArea);

  return {
    isClockwise,
    signedAreaKm2: signedArea,
    areaKm2,
    warning: !isClockwise 
      ? 'WARNING: Counter-Clockwise winding order detected! Under 3GPP TS 23.032 Clause 5.3, the interior is defined to the right of perimeter traversal. CCW winding inverts the cell, treating the rest of the planet as inside!' 
      : null
  };
}

/**
 * Complete End-to-End Algorithmic Pipeline Evaluator
 */
export function evaluateCellPip(polygonVertices, ueCoord, forceWinding = null) {
  // If user requested inverted winding, reverse the vertices for evaluation
  let vertices = [...polygonVertices];
  if (forceWinding === 'ccw') {
    const tempWinding = checkWindingOrder(
      vertices.map(v => {
        const c = computeSphericalCentroid(vertices);
        return projectGnomonic(v.lat, v.lon, c.lat, c.lon);
      })
    );
    if (tempWinding.isClockwise) {
      vertices.reverse();
    }
  } else if (forceWinding === 'cw') {
    const tempWinding = checkWindingOrder(
      vertices.map(v => {
        const c = computeSphericalCentroid(vertices);
        return projectGnomonic(v.lat, v.lon, c.lat, c.lon);
      })
    );
    if (!tempWinding.isClockwise) {
      vertices.reverse();
    }
  }

  // 1. Centroid calculation
  const centroid = computeSphericalCentroid(vertices);
  const centroidAsn1 = {
    lat: latDegToAsn1(centroid.lat),
    lon: lonDegToAsn1(centroid.lon)
  };

  // 2. Tier 1 MBR check
  const mbrResult = checkTier1Mbr(vertices, ueCoord);

  // 3. Stage 3: Gnomonic Projection of Polygon & UE
  const projectedPolygon = vertices.map((v, idx) => {
    const proj = projectGnomonic(v.lat, v.lon, centroid.lat, centroid.lon);
    return {
      index: idx,
      lat: v.lat,
      lon: v.lon,
      ...proj,
      asn1: {
        lat: latDegToAsn1(v.lat),
        lon: lonDegToAsn1(v.lon)
      }
    };
  });

  const projectedUE = projectGnomonic(ueCoord.lat, ueCoord.lon, centroid.lat, centroid.lon);
  const ueAsn1 = {
    lat: latDegToAsn1(ueCoord.lat),
    lon: lonDegToAsn1(ueCoord.lon)
  };

  // 4. Winding order check
  const winding = checkWindingOrder(projectedPolygon);

  // 5. Stage 4: Jordan Ray-Casting
  let rayResult = null;
  let finalDecision = false;
  let decisionReason = '';

  if (!projectedUE.valid) {
    finalDecision = false;
    decisionReason = 'OUTSIDE: UE is beyond the Gnomonic tangent horizon (cos(c) <= 0)';
    rayResult = {
      isInside: false,
      crossings: 0,
      parity: 'EVEN',
      intersections: []
    };
  } else if (!mbrResult.pass) {
    // Fast reject by Tier 1 MBR!
    // Still compute ray-casting for visualization purposes, but final decision is fast-rejected
    rayResult = jordanRayCast(projectedPolygon, projectedUE);
    finalDecision = false;
    decisionReason = `OUTSIDE: ${mbrResult.reason}`;
  } else {
    rayResult = jordanRayCast(projectedPolygon, projectedUE);
    finalDecision = rayResult.isInside;
    
    // In TS 23.032, if winding is counter-clockwise, the interior is inverted!
    if (!winding.isClockwise) {
      finalDecision = !finalDecision;
      decisionReason = finalDecision 
        ? 'INSIDE (🪤 3GPP CCW INVERSION TRAP: Outside area considered cell interior!)'
        : 'OUTSIDE (🪤 3GPP CCW INVERSION TRAP: Geometric interior considered cell exterior!)';
    } else {
      decisionReason = finalDecision 
        ? `INSIDE CELL: ODD ray crossings (${rayResult.crossings})` 
        : `OUTSIDE CELL: EVEN ray crossings (${rayResult.crossings})`;
    }
  }

  // Distance from UE to Centroid
  const distanceToCentroidKm = greatCircleDistanceKm(ueCoord.lat, ueCoord.lon, centroid.lat, centroid.lon);

  return {
    vertices,
    ueCoord,
    ueAsn1,
    centroid,
    centroidAsn1,
    mbrResult,
    projectedPolygon,
    projectedUE,
    winding,
    rayResult,
    finalDecision,
    decisionReason,
    distanceToCentroidKm
  };
}

/**
 * 5 Standard Scenario Presets conforming to 3GPP TS 23.032 & NTN deployments
 * Scaled to prominent regional macro beam dimensions (~1,500 - 2,200 km across)
 * so that great-circle geodesic curvature along Earth's sphere is clearly and visibly curved!
 */
export const SCENARIO_PRESETS = {
  hexagonal: {
    id: 'hexagonal',
    name: '1. Standard LEO Regional Hexagonal Beam (550 km)',
    description: 'Prominent 6-vertex regional hexagonal cell footprint (~1,800 km across) over Central & Western Europe. Geodesic curvature along Earth\'s spherical surface is unmistakably curved.',
    center: { lat: 48.00, lon: 12.00 },
    altitudeKm: 550,
    orbitInclinationDeg: 53.0,
    ue: { lat: 48.50, lon: 13.50 },
    vertices: [
      { lat: 56.00, lon: 12.00 }, // North (Denmark / Baltic Sea)
      { lat: 52.00, lon: 23.50 }, // ENE (Poland / Belarus)
      { lat: 44.00, lon: 23.50 }, // ESE (Balkans / Romania)
      { lat: 40.00, lon: 12.00 }, // South (Italy / Naples)
      { lat: 44.00, lon: 0.50 },  // WSW (France / Toulouse)
      { lat: 52.00, lon: 0.50 }   // WNW (English Channel / London)
    ]
  },
  triangular: {
    id: 'triangular',
    name: '2. Triangular Sector Beam (Min 3 Vertices)',
    description: 'Large directional 3-sector macro beam (~1,600 km span) over Western North America conforming to TS 23.032 Clause 5.3 (N = 3).',
    center: { lat: 37.00, lon: -120.00 },
    altitudeKm: 600,
    orbitInclinationDeg: 65.0,
    ue: { lat: 38.00, lon: -119.00 },
    vertices: [
      { lat: 47.00, lon: -120.00 }, // North (Washington / Pacific NW)
      { lat: 31.00, lon: -107.00 }, // South-East (Texas / New Mexico)
      { lat: 31.00, lon: -133.00 }  // South-West (Pacific Ocean)
    ]
  },
  coastline: {
    id: 'coastline',
    name: '3. Irregular Coastline / Border Cell (14 Vertices)',
    description: 'High-resolution complex boundary (~2,200 km span) following the Mediterranean basin with 14 vertices (maximum 3GPP resolution N <= 15).',
    center: { lat: 37.00, lon: 20.00 },
    altitudeKm: 500,
    orbitInclinationDeg: 45.0,
    ue: { lat: 37.50, lon: 19.50 },
    vertices: [
      { lat: 44.00, lon: 13.00 }, // Venice / North Adriatic
      { lat: 43.50, lon: 20.00 }, // Balkans
      { lat: 41.00, lon: 26.00 }, // Thrace / Aegean North
      { lat: 37.00, lon: 27.50 }, // Rhodes / Anatolia
      { lat: 34.00, lon: 26.00 }, // South Crete
      { lat: 32.00, lon: 21.00 }, // Libya Coast
      { lat: 32.00, lon: 15.00 }, // Gulf of Sirte
      { lat: 34.00, lon: 11.00 }, // Tunisia Coast
      { lat: 37.00, lon: 10.00 }, // Sicily Channel
      { lat: 39.00, lon: 12.00 }, // Tyrrhenian Sea
      { lat: 41.00, lon: 11.00 }, // Corsica East
      { lat: 42.50, lon: 10.00 }, // Tuscany
      { lat: 43.50, lon: 10.50 }, // Liguria
      { lat: 44.00, lon: 11.50 }  // Apennines
    ]
  },
  antimeridian: {
    id: 'antimeridian',
    name: '4. 180° Antimeridian Crosser (Fiji / Tonga / Samoa)',
    description: 'Trans-dateline Pacific beam (~2,200 km span) crossing the 180° International Date Line (+170°E to -170°W), demonstrating Tier-1 MBR dual interval split.',
    center: { lat: -16.00, lon: 180.00 },
    altitudeKm: 550,
    orbitInclinationDeg: 55.0,
    ue: { lat: -16.00, lon: -178.50 },
    vertices: [
      { lat: -6.00, lon: 180.00 },   // North
      { lat: -11.00, lon: -170.00 }, // North-East (Samoa)
      { lat: -21.00, lon: -170.00 }, // South-East (Tonga South)
      { lat: -26.00, lon: 180.00 },  // South
      { lat: -21.00, lon: 170.00 },  // South-West (Fiji West)
      { lat: -11.00, lon: 170.00 }   // North-West (Tuvalu South)
    ]
  },
  polar: {
    id: 'polar',
    name: '5. High-Latitude Polar Cell (Arctic Ocean / Svalbard 78°N)',
    description: 'Arctic polar macro cell (~1,800 km span) from 70°N to 86°N. Demonstrates extreme Mercator projection distortion vs exact Gnomonic geodesic planar lines.',
    center: { lat: 78.00, lon: 15.00 },
    altitudeKm: 650,
    orbitInclinationDeg: 86.4, // Polar orbit
    ue: { lat: 78.00, lon: 17.00 },
    vertices: [
      { lat: 86.00, lon: 15.00 },  // Far North Arctic
      { lat: 80.00, lon: 42.00 },  // Franz Josef Land
      { lat: 72.00, lon: 36.00 },  // Barents Sea
      { lat: 70.00, lon: 15.00 },  // Tromsø / Northern Norway
      { lat: 72.00, lon: -6.00 },  // Greenland Sea
      { lat: 80.00, lon: -12.00 }  // Fram Strait
    ]
  }
};

