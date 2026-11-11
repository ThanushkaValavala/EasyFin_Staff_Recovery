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

// Mode profile configuration
// Mode comes from transportMode, then session.vehicleType, then WALK. CYCLE and OTHER use WALK.
export function getProfile(mode) {
  let m = 'WALK';
  if (typeof mode === 'string') {
    m = mode.toUpperCase().trim();
  } else if (mode && typeof mode === 'object') {
    m = (mode.transportMode || mode.vehicleType || mode.mode || 'WALK').toUpperCase().trim();
  }

  if (m === 'BIKE') {
    return {
      maxAcc: 25,
      maxSpeed: 20,
      method: 'speed',
      smooth: false,
    };
  }

  if (m === 'CAR') {
    return {
      maxAcc: 30,
      maxSpeed: 55,
      method: 'speed',
      smooth: false,
    };
  }

  // CYCLE and OTHER use WALK
  return {
    maxAcc: 15,
    minSegment: (acc) => Math.max(5, 1.5 * acc),
    maxSpeed: 4,
    method: 'position',
    smooth: true,
  };
}

// NEW: Filter out GPS drift, jumps, and stationary jitter based on precise accuracy and speed rules
export function isValidMovement(prev, next) {
  if (!next) return false;

  // 1. Reject any point with accuracy > 20 m
  const nextAcc = typeof next.accuracy === 'number' ? next.accuracy : 10;
  if (nextAcc > 20) return false;

  // Accept the first point only if accuracy <= 20
  if (!prev) return true;

  const dist = distanceMeters(prev, next);
  const prevTime = prev.timestamp ? new Date(prev.timestamp).getTime() : 0;
  const nextTime = next.timestamp ? new Date(next.timestamp).getTime() : 0;
  const timeDiffSeconds = prevTime && nextTime ? (nextTime - prevTime) / 1000 : 0;

  // 2. Reject segments where distance / time > 45 m/s
  if (timeDiffSeconds > 0) {
    const calcSpeed = dist / timeDiffSeconds;
    if (calcSpeed > 45) return false;
  } else if (timeDiffSeconds <= 0 && prevTime && nextTime && dist > 0) {
    return false;
  }

  const speed = typeof next.speed === 'number' ? next.speed : 0;

  // 3. Stationary handling: if speed < 0.3 m/s and the movement is less than the accuracy,
  // add 0 and do not move the anchor point.
  if (speed < 0.3 && dist < nextAcc) {
    return false;
  }

  // 4. Movement check: count the segment only if distance > max(2 m, 0.5 x accuracy)
  // OR the GPS-reported speed (coords.speed) is > 0.5 m/s. Reject segments where distance / time > 45 m/s.
  // Do not drop slow walking.
  const meetsDist = dist > Math.max(2, 0.5 * nextAcc);
  const meetsSpeed = speed > 0.5;

  if (!meetsDist && !meetsSpeed) {
    return false;
  }

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