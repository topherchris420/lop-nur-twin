/**
 * Every number the research ecology uses, with its class.
 *
 * Almost all are `model` values: invented for this simulation, chosen to be of
 * a plausible order and named as choices. A `published` value cites its
 * source. The ecology is versioned on its own (`ECOLOGY_VERSION`); nothing in
 * production imports it (`src/bethesda/firstContact/isolation.test.ts`).
 */
import type { Citation } from "../fly/params.js";

/** Bump on any change to what the ecology computes. */
export const ECOLOGY_VERSION = "research-ecology/1";

export interface EcoParam {
  value: number;
  unit: string;
  kind: "published" | "model";
  source?: Citation;
  note: string;
}
const model = (value: number, unit: string, note: string): EcoParam => ({
  value,
  unit,
  kind: "model",
  note,
});

export const ECOLOGY_PARAMS = {
  // --- the clock -------------------------------------------------------------
  stepS: model(1, "s", "the ecology's step; the fly steps 200 times faster"),
  // --- atmosphere (pure functions of the seed and the time) ------------------
  dayS: model(86_400, "s", "length of a day"),
  meanTempC: model(22, "°C", "mean air temperature"),
  dailyTempAmpC: model(5, "°C", "half the day-night swing, warmest at 15:00"),
  synopticTempAmpC: model(3, "°C", "slow weather swing, over about three days"),
  cloudCooling: model(3, "°C", "how much full cloud cools the day"),
  windMeanMS: model(0.8, "m/s", "mean wind speed near the ground"),
  windGustShare: model(
    0.6,
    "fraction",
    "gust amplitude as a share of the mean, over 15 min",
  ),
  windVeerRad: model(1.0, "rad", "how far the wind direction wanders, over 2 h"),
  rainMaxMmH: model(4, "mm/h", "the heaviest rain"),
  rainThreshold: model(
    0.55,
    "noise",
    "rain falls where the slow rain noise exceeds this",
  ),
  nightLight: model(0.002, "relative light", "light at night (1 is clear midday)"),
  cloudDimming: model(0.75, "fraction", "how much full cloud dims daylight"),
  // --- odour transport -------------------------------------------------------
  cellM: model(0.5, "m", "side of an odour and moisture cell"),
  odourDiffusionM2S: model(
    0.05,
    "m²/s",
    "turbulent diffusivity of odour near the ground (an eddy diffusivity, not molecular)",
  ),
  odourDecayPerS: model(
    1 / 300,
    "1/s",
    "loss of odour from the near-ground layer (lifting, dilution, breakdown): a 5 min time constant",
  ),
  odourScale: model(
    2,
    "relative odour per (µg/m²)",
    "converts near-ground odour (µg per m²) to the fly's relative odour units, so that a ripe fermenting fruit reads about 1 within a metre in light wind",
  ),
  // --- moisture --------------------------------------------------------------
  soilWaterMaxMm: model(
    20,
    "mm",
    "the most water a cell's surface layer holds; more drains",
  ),
  evaporationPerS: model(
    1 / 21_600,
    "1/s",
    "evaporation rate constant of surface water at 20 °C in still, dry air (6 h)",
  ),
  // --- fruit -----------------------------------------------------------------
  fruitSugarMg: model(
    2_000,
    "mg",
    "sugar in a fallen fruit when it falls (about 20 g of fruit)",
  ),
  fruitDropsPerDay: model(6, "per tree per day", "fruit falling from a tree, at 22 °C"),
  fruitScatterM: model(1.5, "m", "how far from its trunk a fruit lands, at most"),
  ripenS: model(129_600, "s", "time from fall to ripe at 20 °C (1.5 days)"),
  q10: model(2, "unitless", "temperature coefficient of ripening, yeast growth and rot"),
  yeastStart: model(0.05, "yeast units", "the wild yeast a fallen fruit carries"),
  yeastMax: model(1, "yeast units", "the most yeast a fruit supports"),
  yeastGrowthPerS: model(
    1 / 21_600,
    "1/s",
    "logistic growth rate of yeast on a ripe fruit",
  ),
  fermentPerS: model(
    1 / 172_800,
    "1/s at full yeast",
    "share of a fruit's sugar fermented per second at full yeast (a 2-day time constant)",
  ),
  fermentOdourUgPerMg: model(
    40,
    "µg odour per mg sugar",
    "volatiles released per mg of sugar fermented",
  ),
  rotRipeness: model(2.5, "ripeness", "past this a fruit rots"),
  rotPerS: model(1 / 86_400, "1/s", "share of a rotting fruit's sugar lost per second"),
  fruitGoneShare: model(
    0.02,
    "fraction",
    "below this share of its sugar a fruit is gone",
  ),
  fruitRadiusM: model(0.03, "m", "radius of a fallen fruit, as a food patch"),
  inoculumPerFeedS: model(
    0.002,
    "yeast units per s",
    "yeast a feeding fly leaves on a fruit; flies carry and spread yeast, this amount is ours",
  ),
  // --- nectar ----------------------------------------------------------------
  nectarSecretUlPerH: model(0.5, "µL/h", "nectar a flower secretes in full daylight"),
  nectarMaxUl: model(2, "µL", "the most nectar a flower holds"),
  nectarSugarMgPerUl: model(0.25, "mg/µL", "sugar in fresh nectar (25% w/v)"),
  nectarEvaporationPerS: model(
    1 / 7_200,
    "1/s",
    "evaporation of nectar's water in dry air (2 h); the sugar stays",
  ),
  nectarMinSugarMg: model(0.002, "mg", "below this a flower offers nothing to feed on"),
  nectarOdourUgPerS: model(0.05, "µg/s", "scent a flower with nectar releases"),
  flowerRadiusM: model(0.02, "m", "radius of a flower, as a food patch"),
  // --- the fly's food ---------------------------------------------------------
  sugarJPerMg: model(
    16.7,
    "J/mg",
    "energy in a mg of sugar (about 4 kcal per g of carbohydrate), to turn the body's intake into sugar taken",
  ),
} as const satisfies Record<string, EcoParam>;

export type EcoParamName = keyof typeof ECOLOGY_PARAMS;
/** A parameter's value. */
export const P = (k: EcoParamName): number => ECOLOGY_PARAMS[k].value;
