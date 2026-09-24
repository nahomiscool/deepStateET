/* Geometry and comparison helpers shared by the map page. */
window.Geo = (function () {
  'use strict';

  const R = 6378137; // WGS84 equatorial radius, metres

  // Area of a ring of [lng, lat] points on the sphere, in m² (same method as Leaflet.draw).
  function ringArea(ring) {
    let area = 0;
    const n = ring.length;
    if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[(i + 1) % n];
      area += (lng2 - lng1) * Math.PI / 180 *
        (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
    }
    return Math.abs(area * R * R / 2);
  }

  function polygonArea(rings) {
    return rings.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring), 0);
  }

  // Area of any GeoJSON geometry in km² (0 for points and lines).
  function areaKm2(geometry) {
    if (!geometry) return 0;
    switch (geometry.type) {
      case 'Polygon': return polygonArea(geometry.coordinates) / 1e6;
      case 'MultiPolygon': return geometry.coordinates.reduce((s, p) => s + polygonArea(p), 0) / 1e6;
      case 'GeometryCollection': return geometry.geometries.reduce((s, g) => s + areaKm2(g), 0);
      default: return 0;
    }
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString();
  }

  // Parse a date-like value from a My Maps column (ISO, "2026-09-20", "20/09/2026", "Sep 20, 2026").
  function parseDate(value) {
    if (!value) return null;
    const s = String(value).trim();
    let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/); // day/month/year
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  return { areaKm2, formatNumber, parseDate };
})();
