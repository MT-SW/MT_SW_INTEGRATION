// Publiczne API silnika plannera łączy/zasięgu MT_SW (port z aplikacji Android). Dokumentacja: API.md.
//
//   import { planLink, planCoverage, createDefaultInput } from './planner/index.js';
//   const input = createDefaultInput();               // oba końce puste, preset Narrow Fast, 869.44165 MHz
//   input.a.lat = 50.87; input.a.lon = 20.63; input.b.lat = 50.95; input.b.lon = 20.80;
//   const res = await planLink(input);                // res.link.aToB.marginDb ...
//   const cov = await planCoverage({ ...input, coverageSide: 'A' }, { onProgress, signal });

// ---- główne funkcje ----
export {
  planLink, planCoverage, PlannerComputer, getSharedComputer, setSharedComputer, PlannerError, compareMeasured,
  feederLossOf, effectiveExtraLossDb, MIN_DISTANCE_M,
} from './planner.js';

// ---- domyślne wartości, limity, przejścia stanu ----
export {
  PLANNER_DEFAULTS, PLANNER_LIMITS, END_DEFAULTS, DEFAULT_K, DEFAULT_N0, CLUTTER_PRESETS, clutterPresetExtraDb,
  createDefaultInput, createDefaultEnd, normalizePlannerInput, noiseFloorDbm, dbmToWatts, wattsToDbm,
  applyBand, applyModemPreset, applyFrequency, applyBandwidth, applySpreadingFactor, applyClutterPreset, applyExtraLoss,
} from './defaults.js';

// ---- pasma i presety modemu ----
export {
  PLANNER_BANDS, MODEM_PRESETS, DEFAULT_PRESET_ID, DEFAULT_BAND_ID, FREE_ID, FREE_MIN_MHZ, FREE_MAX_MHZ, NARROW_868_MHZ,
  bandById, bandIdFor, defaultFrequencyMHz, bandwidthScale, clampMHz, radioFromPreset, regionFor,
} from './bands.js';

// ---- kable, złącza, feeder ----
export { CABLES, CONNECTORS, cableById, connectorById, cableLossDbPerM, connectorLossDb } from './cables.js';
export { FEEDER_PRESETS, computeFeeder, resizeFeeder, CUSTOM_ID as FEEDER_CUSTOM_ID, NONE_ID as FEEDER_NONE_ID, MAX_CONNECTORS } from './feeder.js';

// ---- skala jakości / kolorów zasięgu, legenda, raster ----
export {
  COVERAGE_MAX_DB, COVERAGE_CLASS_COUNT, COVERAGE_FILL_OPACITY, coverageClassOf, coverageColorOf, coverageRgbOf,
  coverageQuality, coverageLegend, coverageLegendGradientCss, coverageRaster, renderCoverageGeoJson,
} from './coverage-layer.js';
export { marginAt, computeCoverageSync, computeCoverageAsync, planCoverageGrid } from './coverage.js';

// ---- warstwa fizyki (niskopoziomowo) ----
export { itmPointToPoint, ItmMode, ItmPolarization, ITM_WARNINGS } from './itm.js';
export { analyzeLink, profileSeries, freeSpaceLossDb, verdictFromMargin, LinkVerdict, ITM_ERROR_LOSS_DB } from './linkbudget.js';
export { makeProfile, profileFromSampler, bulgeM, losHeightM, fresnelRadiusM } from './profile.js';
export { distanceM, bearingDeg, destination, interpolate, elevationAngleDeg, EARTH_RADIUS_M } from './geodesy.js';
export { sensitivityDbm, snrLimitDb } from './sensitivity.js';
export {
  refractivityN, kFactorFromGradient, surfaceRefractivityForItm, analyzeProfile, gasAttenuationDbPerKm,
  rainAttenuationDbPerKm, classifyDucting, DuctingLevel,
} from './atmosphere.js';

// ---- źródła danych ----
export {
  PlannerElevation, PlannerElevationError, PlannerElevationFailure, PmTilesReader, createPmTilesFetcher, createXyzTileFetcher,
  decodeTerrariumTile, TERRAIN_ATTRIBUTION, TERRAIN_ATTRIBUTION_URL,
} from './elevation.js';
export { PlannerWeather, PlannerWeatherError, parseOpenMeteo, buildWeatherUrl } from './weather.js';
export {
  PlannerOverpass, PlannerClutterError, PlannerClutterFailure, PlannerClutter, ClutterMap, ClutterPolygon, ClutterKind,
  OsmQueries, parseOverpass, withClutter, NoClutterSource, CLUTTER_HEIGHT_DEFAULTS,
} from './clutter.js';
