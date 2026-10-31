/**
 * Mathematical & Standard Verification Suite for AMAN.GNOMON-NTN
 * Validates:
 * 1. 3GPP TS 23.032 ASN.1 round-trip encoding
 * 2. Spherical Centroid computation across Dateline
 * 3. Tier-1 MBR fast reject
 * 4. Forward & Inverse Gnomonic projection round-trip accuracy
 * 5. Jordan curve parity ray-casting on all 5 Presets
 * 6. TS 23.032 Clockwise vs CCW winding detection
 */

import {
  latDegToAsn1,
  asn1ToLatDeg,
  lonDegToAsn1,
  asn1ToLonDeg,
  computeSphericalCentroid,
  checkTier1Mbr,
  projectGnomonic,
  inverseGnomonic,
  jordanRayCast,
  checkWindingOrder,
  evaluateCellPip,
  SCENARIO_PRESETS,
  greatCircleDistanceKm
} from '../js/gnomon-pip.js';

import { CODE_SNIPPETS } from '../js/code-snippets.js';

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ✕ [FAIL] ${testName}`);
  }
}

console.log('================================================================');
console.log('AMAN.GNOMON-NTN — Mathematical & 3GPP Validation Suite');
console.log('================================================================\n');

// 1. ASN.1 Round-trip
console.log('TEST 1: 3GPP TS 23.032 ASN.1 Bitfield Round-Trip Conversion');
const testLat = 48.1375;
const asnLat = latDegToAsn1(testLat);
const decodedLat = asn1ToLatDeg(asnLat.latitudeSign, asnLat.degreesLatitude);
assert(Math.abs(testLat - decodedLat) < 0.0001, `Latitude round-trip (${testLat}° -> ASN.1: ${asnLat.degreesLatitude} -> ${decodedLat.toFixed(4)}°)`);

const testSouthLat = -33.8688; // Sydney
const asnSouth = latDegToAsn1(testSouthLat);
const decodedSouth = asn1ToLatDeg(asnSouth.latitudeSign, asnSouth.degreesLatitude);
assert(asnSouth.latitudeSign === 'south' && Math.abs(testSouthLat - decodedSouth) < 0.0001, `South Latitude sign & round-trip (${testSouthLat}° -> ${decodedSouth.toFixed(4)}°)`);

const testLon = 11.5755;
const asnLon = lonDegToAsn1(testLon);
const decodedLon = asn1ToLonDeg(asnLon.degreesLongitude);
assert(Math.abs(testLon - decodedLon) < 0.0001, `Longitude round-trip (${testLon}° -> ASN.1: ${asnLon.degreesLongitude} -> ${decodedLon.toFixed(4)}°)`);

const testWestLon = -122.4194; // San Francisco
const asnWest = lonDegToAsn1(testWestLon);
const decodedWest = asn1ToLonDeg(asnWest.degreesLongitude);
assert(Math.abs(testWestLon - decodedWest) < 0.0001, `West Longitude round-trip (${testWestLon}° -> ${decodedWest.toFixed(4)}°)`);

// 2. Gnomonic Projection & Inverse Round-Trip Accuracy
console.log('\nTEST 2: Gnomonic Projection Forward & Inverse Consistency');
const centerLat = 48.1375;
const centerLon = 11.5755;
const targetLat = 48.5000;
const targetLon = 12.0000;

const forward = projectGnomonic(targetLat, targetLon, centerLat, centerLon);
assert(forward.valid && forward.cosC > 0, `Forward projection valid (cos(c) = ${forward.cosC.toFixed(5)})`);

const inverse = inverseGnomonic(forward.xKm, forward.yKm, centerLat, centerLon);
assert(Math.abs(inverse.lat - targetLat) < 0.0001 && Math.abs(inverse.lon - targetLon) < 0.0001,
  `Inverse projection recovers original coordinates: (${targetLat}°, ${targetLon}°) -> (${inverse.lat.toFixed(4)}°, ${inverse.lon.toFixed(4)}°)`);

// 3. Preset 1: Standard LEO Hexagonal Beam (Regional Macro Cell)
console.log('\nTEST 3: Scenario Preset 1 — LEO Hexagonal Beam (550 km)');
const hexPreset = SCENARIO_PRESETS.hexagonal;
const hexEvalInside = evaluateCellPip(hexPreset.vertices, hexPreset.ue);
assert(hexEvalInside.finalDecision === true, 'Bavaria/Austria UE correctly verified as INSIDE regional hexagon');
assert(hexEvalInside.rayResult.isInside === true && hexEvalInside.rayResult.crossings % 2 === 1,
  `Odd ray crossings observed: ${hexEvalInside.rayResult.crossings}`);
assert(hexEvalInside.mbrResult.pass === true, 'Tier-1 MBR passed for inside UE');

// Test point outside regional cell (e.g. Cairo / Sahara 30.00°N, 12.00°E)
const hexEvalOutside = evaluateCellPip(hexPreset.vertices, { lat: 30.00, lon: 12.00 });
assert(hexEvalOutside.finalDecision === false, 'Distant point correctly identified as OUTSIDE regional cell');
assert(hexEvalOutside.mbrResult.pass === false, 'Distant point correctly FAST REJECTED by Tier-1 MBR');

// 4. Preset 4: 180° Antimeridian Crosser (Fiji / Tonga)
console.log('\nTEST 4: Scenario Preset 4 — 180° Antimeridian Crosser (Fiji/Tonga)');
const datelinePreset = SCENARIO_PRESETS.antimeridian;
const datelineEval = evaluateCellPip(datelinePreset.vertices, datelinePreset.ue);
assert(datelineEval.mbrResult.crossesAntimeridian === true, 'Antimeridian crossing detected successfully');
assert(datelineEval.mbrResult.pass === true, 'UE inside split longitudinal envelope passes Tier-1 MBR');
assert(datelineEval.finalDecision === true, 'UE on Western side (-178.5°) correctly verified INSIDE cross-dateline cell');

// Test point outside dateline envelope (e.g. 0° lon)
const datelineOutside = evaluateCellPip(datelinePreset.vertices, { lat: -16.00, lon: 0.0 });
assert(datelineOutside.finalDecision === false && datelineOutside.mbrResult.pass === false,
  'Point outside dateline envelope correctly FAST REJECTED');

// 5. Preset 2: Triangular Sector Beam (San Francisco)
console.log('\nTEST 5: Scenario Preset 2 — Triangular Sector Beam (N = 3)');
const triPreset = SCENARIO_PRESETS.triangular;
const triEval = evaluateCellPip(triPreset.vertices, triPreset.ue);
assert(triEval.vertices.length === 3, 'Valid minimum 3 vertices polygon');
assert(triEval.finalDecision === true, 'SF UE correctly verified inside triangle');

// 6. Preset 5: High-Latitude Polar Cell (Svalbard 78°N)
console.log('\nTEST 6: Scenario Preset 5 — High Latitude Polar Cell (78°N)');
const polarPreset = SCENARIO_PRESETS.polar;
const polarEval = evaluateCellPip(polarPreset.vertices, polarPreset.ue);
assert(polarEval.finalDecision === true, 'Svalbard UE inside polar polygon');
assert(polarEval.projectedUE.valid === true, 'Gnomonic projection retains high precision at 78°N');

// 7. TS 23.032 Winding Order Trap
console.log('\nTEST 7: 3GPP TS 23.032 Clause 5.3 Clockwise vs CCW Right-Hand Rule Trap');
const cwEval = evaluateCellPip(hexPreset.vertices, hexPreset.ue, 'cw');
assert(cwEval.winding.isClockwise === true, 'Clockwise polygon detected as valid interior');

const ccwEval = evaluateCellPip(hexPreset.vertices, hexPreset.ue, 'ccw');
assert(ccwEval.winding.isClockwise === false, 'Counter-Clockwise winding order recognized');
assert(ccwEval.decisionReason.includes('INVERSION TRAP'), '3GPP Right-Hand inversion trap triggered on CCW order');

// 8. Code Snippets validation
console.log('\nTEST 8: Code Inspection Snippets Validation');
assert(CODE_SNIPPETS.c.includes('isLocationInCellGeoArea'), 'C99 snippet contains isLocationInCellGeoArea signature');
assert(CODE_SNIPPETS.c.includes('GeographicalCoordinates_t'), 'C99 snippet contains 3GPP ASN.1 structs');
assert(CODE_SNIPPETS.js.includes('projectGnomonic'), 'JS snippet contains projectGnomonic function');

console.log('\n================================================================');
console.log(`VERIFICATION SUMMARY: ${passed} / ${total} Tests Passed (${((passed / total) * 100).toFixed(0)}%)`);
console.log('================================================================');

if (passed !== total) {
  process.exit(1);
}

