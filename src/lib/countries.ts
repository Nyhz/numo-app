// Taxonomía geográfica. Los pesos se almacenan por país (clave inglesa
// normalizada, como la rotula JustETF), pero el gráfico agrupa por REGIÓN
// (continente). Client-safe: sin imports de servidor. Solo geografía: cripto,
// oro y posiciones sin país no aparecen (los omite el read layer).

/** Cola agregada que el propio fondo reporta como «Other». */
export const OTHER_COUNTRIES = "other";

/** Región residual: el «Other» del fondo y cualquier país sin mapear. */
export const OTHER_REGION = "other";

/** Normaliza un nombre de país de JustETF («United States», «South Korea»,
 *  «Other») a una clave canónica en minúsculas con guiones bajos. */
export function normalizeCountryKey(raw: string): string {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (k === "other" || k === "others") return OTHER_COUNTRIES;
  return k;
}

const REGION_LABELS: Record<string, string> = {
  north_america: "Norteamérica",
  europe: "Europa",
  asia: "Asia",
  oceania: "Oceanía",
  latin_america: "Latinoamérica",
  middle_east_africa: "Oriente Medio y África",
  other: "Otros",
};

/** Orden de color estable (fija --chart-N por región). */
const REGION_ORDER = [
  "north_america",
  "europe",
  "asia",
  "oceania",
  "latin_america",
  "middle_east_africa",
] as const;

/** País → región. Cubre los países desarrollados y los emergentes grandes que
 *  JustETF reporta; lo no listado cae en «Otros» vía `countryRegion`. */
const REGION_BY_COUNTRY: Record<string, string> = {
  // Norteamérica
  united_states: "north_america",
  canada: "north_america",
  // Europa (UE, Reino Unido, EFTA, nórdicos y este de Europa)
  united_kingdom: "europe",
  switzerland: "europe",
  germany: "europe",
  france: "europe",
  netherlands: "europe",
  ireland: "europe",
  spain: "europe",
  italy: "europe",
  sweden: "europe",
  denmark: "europe",
  finland: "europe",
  norway: "europe",
  belgium: "europe",
  austria: "europe",
  portugal: "europe",
  luxembourg: "europe",
  poland: "europe",
  czech_republic: "europe",
  czechia: "europe",
  greece: "europe",
  hungary: "europe",
  russia: "europe",
  romania: "europe",
  iceland: "europe",
  liechtenstein: "europe",
  jersey: "europe",
  guernsey: "europe",
  isle_of_man: "europe",
  cyprus: "europe",
  malta: "europe",
  slovenia: "europe",
  slovakia: "europe",
  estonia: "europe",
  lithuania: "europe",
  latvia: "europe",
  croatia: "europe",
  ukraine: "europe",
  bulgaria: "europe",
  // Asia (desarrollada y emergente)
  japan: "asia",
  china: "asia",
  taiwan: "asia",
  south_korea: "asia",
  korea: "asia",
  india: "asia",
  hong_kong: "asia",
  singapore: "asia",
  indonesia: "asia",
  thailand: "asia",
  malaysia: "asia",
  philippines: "asia",
  vietnam: "asia",
  pakistan: "asia",
  kazakhstan: "asia",
  bangladesh: "asia",
  sri_lanka: "asia",
  macao: "asia",
  macau: "asia",
  // Oceanía
  australia: "oceania",
  new_zealand: "oceania",
  // Latinoamérica
  brazil: "latin_america",
  mexico: "latin_america",
  chile: "latin_america",
  colombia: "latin_america",
  peru: "latin_america",
  argentina: "latin_america",
  uruguay: "latin_america",
  panama: "latin_america",
  // Oriente Medio y África
  israel: "middle_east_africa",
  saudi_arabia: "middle_east_africa",
  united_arab_emirates: "middle_east_africa",
  qatar: "middle_east_africa",
  kuwait: "middle_east_africa",
  bahrain: "middle_east_africa",
  oman: "middle_east_africa",
  jordan: "middle_east_africa",
  turkey: "middle_east_africa",
  south_africa: "middle_east_africa",
  egypt: "middle_east_africa",
  nigeria: "middle_east_africa",
  morocco: "middle_east_africa",
  kenya: "middle_east_africa",
  ghana: "middle_east_africa",
};

/** Región de un país (clave normalizada). El «Other» del fondo y cualquier
 *  país no mapeado caen en la región residual «Otros». */
export function countryRegion(countryKey: string): string {
  if (countryKey === OTHER_COUNTRIES) return OTHER_REGION;
  return REGION_BY_COUNTRY[countryKey] ?? OTHER_REGION;
}

export function regionLabel(key: string): string {
  return REGION_LABELS[key] ?? key;
}

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** Stable theme-tracked colour per region. Known regions map to a fixed
 *  --chart-N; the residual «Otros» uses a neutral muted tone. */
export function regionColor(key: string): string {
  if (key === OTHER_REGION) return "hsl(var(--muted-foreground))";
  const idx = (REGION_ORDER as readonly string[]).indexOf(key);
  const n = idx >= 0 ? idx + 1 : (hashKey(key) % 10) + 1;
  return `hsl(var(--chart-${n}))`;
}
