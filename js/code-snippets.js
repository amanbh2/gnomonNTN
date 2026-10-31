/**
 * AMAN.GNOMON-NTN — Code Inspector Snippets
 * Contains production C99 and modern ES6 JavaScript implementations.
 * Engineered with ❤️ & AI by Aman Bhaskar
 */

export const CODE_SNIPPETS = {
  c: `/**
 * ============================================================================
 * AMAN.GNOMON-NTN: 5G Non-Terrestrial Network (NTN) Geographic Cell PIP Engine
 * Conforming to:
 *   - 3GPP TS 23.032 Clause 5.3 (Universal Geographical Area Description - Polygon)
 *   - 3GPP TS 38.331 Clause 6.3.2 (SIB19 cellGeoArea Information Element)
 * 
 * Pipeline:
 *   Stage 1: ASN.1 Decoding & 3D Spherical Centroid Computation
 *   Stage 2: Tier-1 Minimum Bounding Rectangle (MBR) Fast-Reject (O(1))
 *   Stage 3: Gnomonic Tangent Plane Projection (Great Circles -> Straight Lines)
 *   Stage 4: Jordan Curve Parity Ray-Casting on 2D Tangent Plane (O(N))
 * 
 * Author: Aman Bhaskar (https://github.com/amanbh2)
 * Standard: C99 / POSIX compliant
 * ============================================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include <math.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define EARTH_RADIUS_KM 6371.0088       /* WGS-84 authalic mean Earth radius */
#define DEG_TO_RAD (M_PI / 180.0)
#define RAD_TO_DEG (180.0 / M_PI)

#define TS_23032_MAX_POLYGON_POINTS 15  /* 3GPP TS 23.032 Clause 5.3: 3 to 15 */
#define TS_23032_MIN_POLYGON_POINTS 3

/* ============================================================================
 * 3GPP ASN.1 Data Types (TS 38.331 & TS 23.032)
 * ============================================================================ */

typedef enum {
    LATITUDE_SIGN_NORTH = 0,
    LATITUDE_SIGN_SOUTH = 1
} LatitudeSign_t;

/**
 * 3GPP TS 23.032 Geographical Coordinates ASN.1 Definition:
 * latitudeSign: ENUMERATED { north, south }
 * degreesLatitude: INTEGER (0..8388607)       -- 23 bits, scale = 2^23 / 90°
 * degreesLongitude: INTEGER (-8388608..8388607) -- 24 bits, scale = 2^24 / 360°
 */
typedef struct {
    LatitudeSign_t latitudeSign;
    uint32_t       degreesLatitude;
    int32_t        degreesLongitude;
} GeographicalCoordinates_t;

typedef struct {
    uint8_t                   numPoints;
    GeographicalCoordinates_t points[TS_23032_MAX_POLYGON_POINTS];
} CellPolygon_t;

/* Internal Float Geometry Types */
typedef struct {
    double lat; /* Degrees [-90.0, +90.0] */
    double lon; /* Degrees [-180.0, +180.0] */
} GeoPoint_t;

typedef struct {
    double x;
    double y;
    double z;
} Vector3D_t;

typedef struct {
    double x;   /* Local tangent East in km */
    double y;   /* Local tangent North in km */
} TangentPoint_t;

typedef struct {
    bool   isInside;
    bool   mbrPassed;
    bool   isClockwise;
    int    rayCrossings;
    double cosC;
    double distanceToCentroidKm;
    char   diagnosticMsg[256];
} PipResult_t;

/* ============================================================================
 * Stage 1: 3GPP ASN.1 Decoding & Vector Centroid Formulation
 * ============================================================================ */

static inline GeoPoint_t asn1_to_degrees(const GeographicalCoordinates_t *coord) {
    GeoPoint_t pt;
    double latMag = ((double)coord->degreesLatitude * 90.0) / 8388608.0;
    pt.lat = (coord->latitudeSign == LATITUDE_SIGN_SOUTH) ? -latMag : latMag;
    pt.lon = ((double)coord->degreesLongitude * 360.0) / 16777216.0;
    return pt;
}

static inline GeographicalCoordinates_t degrees_to_asn1(double lat, double lon) {
    GeographicalCoordinates_t coord;
    coord.latitudeSign = (lat >= 0.0) ? LATITUDE_SIGN_NORTH : LATITUDE_SIGN_SOUTH;
    double absLat = fabs(lat);
    if (absLat > 90.0) absLat = 90.0;
    coord.degreesLatitude = (uint32_t)round((absLat / 90.0) * 8388608.0);
    if (coord.degreesLatitude > 8388607) coord.degreesLatitude = 8388607;

    while (lon > 180.0) lon -= 360.0;
    while (lon < -180.0) lon += 360.0;
    int32_t degLon = (int32_t)round((lon / 360.0) * 16777216.0);
    if (degLon > 8388607) degLon = 8388607;
    if (degLon < -8388608) degLon = -8388608;
    coord.degreesLongitude = degLon;
    return coord;
}

static Vector3D_t geo_to_unit_vector(double latDeg, double lonDeg) {
    double phi = latDeg * DEG_TO_RAD;
    double lam = lonDeg * DEG_TO_RAD;
    Vector3D_t v;
    v.x = cos(phi) * cos(lam);
    v.y = cos(phi) * sin(lam);
    v.z = sin(phi);
    return v;
}

static GeoPoint_t unit_vector_to_geo(Vector3D_t v) {
    GeoPoint_t pt;
    double norm = sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (norm < 1e-12) { pt.lat = 0; pt.lon = 0; return pt; }
    double zNorm = v.z / norm;
    if (zNorm > 1.0) zNorm = 1.0;
    if (zNorm < -1.0) zNorm = -1.0;
    pt.lat = asin(zNorm) * RAD_TO_DEG;
    pt.lon = atan2(v.y, v.x) * RAD_TO_DEG;
    return pt;
}

/**
 * 3D Spherical Centroid: Averaging unit normal vectors
 * Guarantees no discontinuity across the ±180° antimeridian!
 */
static GeoPoint_t compute_spherical_centroid(const GeoPoint_t *pts, uint8_t n) {
    Vector3D_t sum = {0.0, 0.0, 0.0};
    for (uint8_t i = 0; i < n; i++) {
        Vector3D_t u = geo_to_unit_vector(pts[i].lat, pts[i].lon);
        sum.x += u.x;
        sum.y += u.y;
        sum.z += u.z;
    }
    return unit_vector_to_geo(sum);
}

/* ============================================================================
 * Stage 2: Tier-1 MBR Fast-Reject with Antimeridian Wrap Handling
 * ============================================================================ */

static bool tier1_mbr_check(const GeoPoint_t *pts, uint8_t n, GeoPoint_t ue, bool *crossesAntimeridian) {
    double latMin = 90.0, latMax = -90.0;
    double lonMin = 180.0, lonMax = -180.0;
    bool hasPosLon = false, hasNegLon = false;
    *crossesAntimeridian = false;

    for (uint8_t i = 0; i < n; i++) {
        if (pts[i].lat < latMin) latMin = pts[i].lat;
        if (pts[i].lat > latMax) latMax = pts[i].lat;
        if (pts[i].lon < lonMin) lonMin = pts[i].lon;
        if (pts[i].lon > lonMax) lonMax = pts[i].lon;

        if (pts[i].lon > 90.0) hasPosLon = true;
        if (pts[i].lon < -90.0) hasNegLon = true;

        double nextLon = pts[(i + 1) % n].lon;
        if (fabs(pts[i].lon - nextLon) > 180.0) {
            *crossesAntimeridian = true;
        }
    }

    if (hasPosLon && hasNegLon && (lonMax - lonMin > 180.0)) {
        *crossesAntimeridian = true;
    }

    /* Latitude Range Check */
    if (ue.lat < latMin - 1e-6 || ue.lat > latMax + 1e-6) {
        return false;
    }

    /* Longitude Range Check */
    if (*crossesAntimeridian) {
        double eastMin = 180.0;
        double westMax = -180.0;
        for (uint8_t i = 0; i < n; i++) {
            if (pts[i].lon >= 0.0 && pts[i].lon < eastMin) eastMin = pts[i].lon;
            if (pts[i].lon < 0.0 && pts[i].lon > westMax)  westMax = pts[i].lon;
        }
        /* UE must be East of eastMin or West of westMax */
        if (!((ue.lon >= eastMin - 1e-6 && ue.lon <= 180.0) ||
              (ue.lon <= westMax + 1e-6 && ue.lon >= -180.0))) {
            return false;
        }
    } else {
        if (ue.lon < lonMin - 1e-6 || ue.lon > lonMax + 1e-6) {
            return false;
        }
    }

    return true;
}

/* ============================================================================
 * Stage 3: Gnomonic Tangent Plane Projection (Core Mathematical Transform)
 * ============================================================================ */

static bool gnomonic_project(double latDeg, double lonDeg, double lat0Deg, double lon0Deg,
                             TangentPoint_t *outPt, double *outCosC) {
    double phi = latDeg * DEG_TO_RAD;
    double phi0 = lat0Deg * DEG_TO_RAD;
    double deltaLonDeg = lonDeg - lon0Deg;

    while (deltaLonDeg > 180.0) deltaLonDeg -= 360.0;
    while (deltaLonDeg < -180.0) deltaLonDeg += 360.0;
    double deltaLon = deltaLonDeg * DEG_TO_RAD;

    double sinPhi = sin(phi);
    double cosPhi = cos(phi);
    double sinPhi0 = sin(phi0);
    double cosPhi0 = cos(phi0);
    double cosDeltaLon = cos(deltaLon);
    double sinDeltaLon = sin(deltaLon);

    /* Cosine of central angle c between tangent point and target */
    double cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDeltaLon;
    *outCosC = cosC;

    /* Tangent Horizon condition: Point must be on visible hemisphere (cos(c) > 0) */
    if (cosC <= 1e-6) {
        outPt->x = 0;
        outPt->y = 0;
        return false;
    }

    /* Dimensionless coordinates */
    double x = (cosPhi * sinDeltaLon) / cosC;
    double y = (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDeltaLon) / cosC;

    /* Convert to physical kilometers */
    outPt->x = x * EARTH_RADIUS_KM;
    outPt->y = y * EARTH_RADIUS_KM;
    return true;
}

/* ============================================================================
 * Stage 4: Jordan Curve Ray-Casting & TS 23.032 Winding Order Verification
 * ============================================================================ */

static int jordan_ray_cast(const TangentPoint_t *poly, uint8_t n, TangentPoint_t p) {
    int crossings = 0;
    for (uint8_t i = 0; i < n; i++) {
        TangentPoint_t a = poly[i];
        TangentPoint_t b = poly[(i + 1) % n];

        /* Check scanline straddle: y0 between a.y and b.y */
        if ((a.y > p.y) != (b.y > p.y)) {
            /* Ray shoots towards +X (x >= p.x) */
            double dy = b.y - a.y;
            double dx = b.x - a.x;
            double xInt = a.x + ((p.y - a.y) / dy) * dx;
            if (xInt >= p.x) {
                crossings++;
            }
        }
    }
    return crossings;
}

static bool check_clockwise_winding(const TangentPoint_t *poly, uint8_t n) {
    double sum = 0.0;
    for (uint8_t i = 0; i < n; i++) {
        TangentPoint_t a = poly[i];
        TangentPoint_t b = poly[(i + 1) % n];
        sum += (a.x * b.y - b.x * a.y);
    }
    /* Negative signed area in Cartesian plane denotes Clockwise traversal */
    return (sum < 0.0);
}

/* ============================================================================
 * Public API: isLocationInCellGeoArea
 * ============================================================================ */

bool isLocationInCellGeoArea(const CellPolygon_t *cellPolygon,
                             const GeographicalCoordinates_t *ueCoord,
                             PipResult_t *result) {
    if (!cellPolygon || !ueCoord || !result) return false;
    if (cellPolygon->numPoints < TS_23032_MIN_POLYGON_POINTS ||
        cellPolygon->numPoints > TS_23032_MAX_POLYGON_POINTS) {
        snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                 "Invalid polygon vertex count: %d (Must be 3..15)", cellPolygon->numPoints);
        result->isInside = false;
        return false;
    }

    /* 1. Decode ASN.1 coordinates into IEEE-754 degrees */
    GeoPoint_t polyGeo[TS_23032_MAX_POLYGON_POINTS];
    for (uint8_t i = 0; i < cellPolygon->numPoints; i++) {
        polyGeo[i] = asn1_to_degrees(&cellPolygon->points[i]);
    }
    GeoPoint_t ueGeo = asn1_to_degrees(ueCoord);

    /* 2. Compute Centroid on Unit Sphere */
    GeoPoint_t centroid = compute_spherical_centroid(polyGeo, cellPolygon->numPoints);

    /* 3. Tier 1 MBR Fast-Reject Check */
    bool crossesAntimeridian = false;
    result->mbrPassed = tier1_mbr_check(polyGeo, cellPolygon->numPoints, ueGeo, &crossesAntimeridian);
    if (!result->mbrPassed) {
        result->isInside = false;
        result->rayCrossings = 0;
        snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                 "FAST REJECT: Outside Tier-1 MBR (Antimeridian=%s)", crossesAntimeridian ? "YES" : "NO");
        return false;
    }

    /* 4. Gnomonic Projection to Tangent Plane */
    TangentPoint_t polyTangent[TS_23032_MAX_POLYGON_POINTS];
    double dummyCos;
    for (uint8_t i = 0; i < cellPolygon->numPoints; i++) {
        if (!gnomonic_project(polyGeo[i].lat, polyGeo[i].lon, centroid.lat, centroid.lon,
                              &polyTangent[i], &dummyCos)) {
            result->isInside = false;
            snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                     "ERROR: Vertex %d beyond tangent horizon", i);
            return false;
        }
    }

    TangentPoint_t ueTangent;
    if (!gnomonic_project(ueGeo.lat, ueGeo.lon, centroid.lat, centroid.lon, &ueTangent, &result->cosC)) {
        result->isInside = false;
        snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                 "REJECT: UE beyond tangent plane horizon (cos(c) <= 0)");
        return false;
    }

    result->distanceToCentroidKm = sqrt(ueTangent.x * ueTangent.x + ueTangent.y * ueTangent.y);

    /* 5. TS 23.032 Winding Order Verification */
    result->isClockwise = check_clockwise_winding(polyTangent, cellPolygon->numPoints);

    /* 6. Jordan Curve Parity Ray-Casting */
    result->rayCrossings = jordan_ray_cast(polyTangent, cellPolygon->numPoints, ueTangent);
    bool parityInside = (result->rayCrossings % 2) == 1;

    /* 3GPP Right-Hand Trap Check: Inverted polygon inverts result */
    if (!result->isClockwise) {
        result->isInside = !parityInside;
        snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                 "WARNING: CCW Winding trap active! Ray crossings=%d. Parity inverted.", result->rayCrossings);
    } else {
        result->isInside = parityInside;
        snprintf(result->diagnosticMsg, sizeof(result->diagnosticMsg),
                 "SUCCESS: Clean %s cell (Crossings=%d, CW=YES)",
                 result->isInside ? "INSIDE" : "OUTSIDE", result->rayCrossings);
    }

    return result->isInside;
}

/* ============================================================================
 * Self-Contained Test Harness
 * ============================================================================ */

int main(void) {
    printf("===================================================================\\n");
    printf("AMAN.GNOMON-NTN — 3GPP TS 23.032 / TS 38.331 C99 PIP Test Harness\\n");
    printf("===================================================================\\n");

    /* Define Regional LEO Hexagonal Beam (6 vertices, ~1,800 km across) */
    CellPolygon_t hexBeam;
    hexBeam.numPoints = 6;
    double rawVerts[6][2] = {
        { 56.00, 12.00 },
        { 52.00, 23.50 },
        { 44.00, 23.50 },
        { 40.00, 12.00 },
        { 44.00,  0.50 },
        { 52.00,  0.50 }
    };
    for (int i = 0; i < 6; i++) {
        hexBeam.points[i] = degrees_to_asn1(rawVerts[i][0], rawVerts[i][1]);
    }

    /* Test Case 1: Point Inside Regional Cell (Bavaria / Austria: 48.50°N, 13.50°E) */
    GeographicalCoordinates_t ueInside = degrees_to_asn1(48.50, 13.50);
    PipResult_t res1;
    bool in1 = isLocationInCellGeoArea(&hexBeam, &ueInside, &res1);
    printf("Test 1 (Inside Bavaria): Result=%s, Crossings=%d, Dist=%.2f km -> %s\\n",
           in1 ? "INSIDE [PASS]" : "OUTSIDE [FAIL]", res1.rayCrossings, res1.distanceToCentroidKm, res1.diagnosticMsg);

    /* Test Case 2: Point Outside Regional Cell (Cairo / Sahara: 30.00°N, 12.00°E) */
    GeographicalCoordinates_t ueOutside = degrees_to_asn1(30.00, 12.00);
    PipResult_t res2;
    bool in2 = isLocationInCellGeoArea(&hexBeam, &ueOutside, &res2);
    printf("Test 2 (Outside Sahara): Result=%s, Crossings=%d -> %s\\n",
           in2 ? "INSIDE [FAIL]" : "OUTSIDE [PASS]", res2.rayCrossings, res2.diagnosticMsg);

    /* Test Case 3: 180° Antimeridian Crosser (Fiji / Tonga / Samoa) */
    CellPolygon_t datelineBeam;
    datelineBeam.numPoints = 6;
    double dlVerts[6][2] = {
        {  -6.00,  180.00 },
        { -11.00, -170.00 },
        { -21.00, -170.00 },
        { -26.00,  180.00 },
        { -21.00,  170.00 },
        { -11.00,  170.00 }
    };
    for (int i = 0; i < 6; i++) {
        datelineBeam.points[i] = degrees_to_asn1(dlVerts[i][0], dlVerts[i][1]);
    }

    GeographicalCoordinates_t ueDateLine = degrees_to_asn1(-16.00, -178.50);
    PipResult_t res3;
    bool in3 = isLocationInCellGeoArea(&datelineBeam, &ueDateLine, &res3);
    printf("Test 3 (180° Date Line): Result=%s, Crossings=%d, Dist=%.2f km -> %s\\n",
           in3 ? "INSIDE [PASS]" : "OUTSIDE [FAIL]", res3.rayCrossings, res3.distanceToCentroidKm, res3.diagnosticMsg);

    printf("===================================================================\\n");
    return 0;
}
`,
  js: `/**
 * ============================================================================
 * AMAN.GNOMON-NTN: ES6 JavaScript Runtime PIP Engine
 * Conforms to:
 *   - 3GPP TS 23.032 Clause 5.3 (Universal Geographical Area Description)
 *   - 3GPP TS 38.331 Clause 6.3.2 (SIB19 cellGeoArea)
 * 
 * Drives the live browser simulation.
 * ============================================================================
 */

export const EARTH_RADIUS_KM = 6371.0088;
export const DEG_TO_RAD = Math.PI / 180.0;
export const RAD_TO_DEG = 180.0 / Math.PI;

/**
 * 3GPP ASN.1 Converters
 */
export function latDegToAsn1(latDeg) {
  const sign = latDeg >= 0 ? 'north' : 'south';
  const absLat = Math.min(90.0, Math.max(0.0, Math.abs(latDeg)));
  const degreesLatitude = Math.min(8388607, Math.round((absLat / 90.0) * 8388608));
  return { latitudeSign: sign, degreesLatitude };
}

export function lonDegToAsn1(lonDeg) {
  let lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  let degreesLongitude = Math.round((lon / 360.0) * 16777216);
  if (degreesLongitude > 8388607) degreesLongitude = 8388607;
  if (degreesLongitude < -8388608) degreesLongitude = -8388608;
  return { degreesLongitude };
}

/**
 * Stage 1: Spherical Centroid via 3D Vector Averaging
 * Eliminates ±180° Antimeridian jump discontinuities
 */
export function computeSphericalCentroid(vertices) {
  let sumX = 0, sumY = 0, sumZ = 0;
  for (const v of vertices) {
    const phi = v.lat * DEG_TO_RAD;
    const lam = v.lon * DEG_TO_RAD;
    sumX += Math.cos(phi) * Math.cos(lam);
    sumY += Math.cos(phi) * Math.sin(lam);
    sumZ += Math.sin(phi);
  }
  const norm = Math.hypot(sumX, sumY, sumZ) || 1.0;
  const zNorm = Math.max(-1.0, Math.min(1.0, sumZ / norm));
  return {
    lat: Math.asin(zNorm) * RAD_TO_DEG,
    lon: Math.atan2(sumY, sumX) * RAD_TO_DEG
  };
}

/**
 * Stage 2: Tier-1 MBR Fast-Reject with Antimeridian Split
 */
export function checkTier1Mbr(vertices, ue) {
  let latMin = Infinity, latMax = -Infinity;
  let lonMin = Infinity, lonMax = -Infinity;
  let crossesAntimeridian = false;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.lat < latMin) latMin = v.lat;
    if (v.lat > latMax) latMax = v.lat;
    if (v.lon < lonMin) lonMin = v.lon;
    if (v.lon > lonMax) lonMax = v.lon;

    const nextLon = vertices[(i + 1) % vertices.length].lon;
    if (Math.abs(v.lon - nextLon) > 180) crossesAntimeridian = true;
  }

  const latPass = ue.lat >= latMin - 1e-7 && ue.lat <= latMax + 1e-7;
  let lonPass = false;

  if (crossesAntimeridian) {
    let eastMin = 180, westMax = -180;
    for (const v of vertices) {
      if (v.lon >= 0 && v.lon < eastMin) eastMin = v.lon;
      if (v.lon < 0 && v.lon > westMax)  westMax = v.lon;
    }
    lonPass = (ue.lon >= eastMin - 1e-7 && ue.lon <= 180.0) ||
              (ue.lon <= westMax + 1e-7 && ue.lon >= -180.0);
  } else {
    lonPass = ue.lon >= lonMin - 1e-7 && ue.lon <= lonMax + 1e-7;
  }

  return {
    pass: latPass && lonPass,
    crossesAntimeridian,
    bounds: { latMin, latMax, lonMin, lonMax }
  };
}

/**
 * Stage 3: Gnomonic Tangent Plane Projection
 * All great circle geodesics project into exact straight line segments!
 */
export function projectGnomonic(latDeg, lonDeg, lat0Deg, lon0Deg) {
  const phi = latDeg * DEG_TO_RAD;
  const phi0 = lat0Deg * DEG_TO_RAD;
  let dLonDeg = lonDeg - lon0Deg;
  while (dLonDeg > 180) dLonDeg -= 360;
  while (dLonDeg < -180) dLonDeg += 360;
  const dLon = dLonDeg * DEG_TO_RAD;

  const cosC = Math.sin(phi0) * Math.sin(phi) +
               Math.cos(phi0) * Math.cos(phi) * Math.cos(dLon);

  if (cosC <= 1e-5) {
    return { valid: false, cosC, xKm: 0, yKm: 0 };
  }

  const x = (Math.cos(phi) * Math.sin(dLon)) / cosC;
  const y = (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dLon)) / cosC;

  return {
    valid: true,
    cosC,
    xKm: x * EARTH_RADIUS_KM,
    yKm: y * EARTH_RADIUS_KM
  };
}

/**
 * Stage 4: Jordan Curve Ray-Casting & Parity Rule
 */
export function jordanRayCast(projectedPolygon, testPoint) {
  let crossings = 0;
  const x0 = testPoint.xKm;
  const y0 = testPoint.yKm;
  const n = projectedPolygon.length;

  for (let i = 0; i < n; i++) {
    const p1 = projectedPolygon[i];
    const p2 = projectedPolygon[(i + 1) % n];

    // Straddle check on scanline y = y0
    if ((p1.yKm > y0) !== (p2.yKm > y0)) {
      const xInt = p1.xKm + ((y0 - p1.yKm) / (p2.yKm - p1.yKm)) * (p2.xKm - p1.xKm);
      if (xInt >= x0) {
        crossings++;
      }
    }
  }

  return {
    isInside: (crossings % 2) === 1,
    crossings
  };
}
`
};
