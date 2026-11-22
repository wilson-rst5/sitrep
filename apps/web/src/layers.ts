export const layers = [
  ['Emergency incidents', ['natural_incident', 'emergency', 'flood']],
  ['Wildfires', ['wildfire']],
  ['Satellite fire detections', ['fire_detection']],
  ['Road accidents', ['road_accident']],
  ['Traffic incidents', ['traffic', 'road_weather']],
  ['Road closures', ['road_closure']],
  ['Roadworks', ['roadworks']],
  ['Bridges', ['bridge', 'road_watch']],
  ['Public cameras', ['camera']],
  ['Weather warnings', ['weather_warning']],
  ['Earthquakes', ['earthquake']],
  ['Live aircraft', ['aircraft']],
  ['Vessels', ['vessel']],
  ['Satellite / radar', ['radar']],
  ['Geolocated news', ['news']],
] as const;

export const operationalCategories: string[] = layers.flatMap(([, values]) => [...values]).filter(
  category => !['bridge', 'road_watch', 'camera', 'news', 'radar'].includes(category),
);

export function distanceKm(a: { latitude: number; longitude: number }, b: typeof a) {
  const lat = (b.latitude - a.latitude) * Math.PI / 180;
  const lon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) *
    Math.cos(b.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
