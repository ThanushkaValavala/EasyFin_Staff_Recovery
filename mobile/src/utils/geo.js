// Distance between two GPS points, in meters (haversine formula)
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// NEW: Filter out GPS drift and jumps
export function isValidMovement(prev, next) {
  if (!prev || !next) return false;

  // 1. Reject if the new point has very poor accuracy (worse than 30 meters)
  if (next.accuracy > 30) return false;

  const dist = distanceMeters(prev, next);
  const timeDiffSeconds = (new Date(next.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

  // 2. If they are the same time, reject
  if (timeDiffSeconds <= 0) return false;

  // 3. Reject impossible GPS jumps (Speed limit check)
  // If the calculated speed is > 40 m/s (144 km/h), they are in a vehicle, but it's likely a GPS jump.
  const speed = dist / timeDiffSeconds;
  if (speed > 40) return false;

  // 4. Reject small noise when standing still
  // The threshold is based on the GPS accuracy (error margin). 
  // If they moved less than the error margin of the GPS, it's just noise.
  const driftThreshold = Math.max(prev.accuracy, next.accuracy) * 0.8;
  if (dist < driftThreshold) return false;

  // 5. Reject small jumps based on time (if less than 1 meter per second and under 5 meters)
  if (dist < 5 && speed < 1.5) return false;

  return true;
}

export function formatDistance(m) {
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(sec);
}