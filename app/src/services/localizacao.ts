// GeoJSON e Redis recebem longitude primeiro, latitude depois.
export function coordenadasValidas(longitude: unknown, latitude: unknown, limiteLatitude = 90): boolean {
  return typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= limiteLatitude;
}

export function lerBuscaPorRaio(query: { longitude?: unknown; latitude?: unknown; raioKm?: unknown }, limiteLatitude = 90) {
  const valores = [query.longitude, query.latitude, query.raioKm];
  if (valores.some(v => typeof v !== "string" || !v.trim())) return null;
  const [longitude, latitude, raioKm] = valores.map(Number);
  if (!coordenadasValidas(longitude, latitude, limiteLatitude) || !Number.isFinite(raioKm) || raioKm <= 0 || raioKm > 30) return null;
  return { longitude, latitude, raioKm };
}
