import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { apiPost } from '../api';
import { distanceMeters, formatDistance, formatDuration, getProfile } from '../utils/geo';

const LOCATION_TASK_NAME = 'EASYFIN_BACKGROUND_LOCATION_TASK';

let globalLocationListener = null;

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
    if (error) {
      console.warn('[BackgroundLocation] Task error:', error);
      return;
    }
    if (data && data.locations && Array.isArray(data.locations)) {
      for (const loc of data.locations) {
        if (typeof globalLocationListener === 'function') {
          globalLocationListener(loc);
        }
      }
    }
  });
}

const MAP_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;padding:0}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map, line, startM, meM;
function init(){
  if(!window.L){ document.getElementById('map').innerHTML='<p style="padding:16px;font-family:sans-serif">Map could not load.</p>'; return; }
  map=L.map('map').setView([12.9716,77.5946],15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  line=L.polyline([],{color:'#1a56db',weight:5}).addTo(map);
}
window.updatePath=function(pts){
  if(!map||!pts.length) return;
  line.setLatLngs(pts);
  var last=pts[pts.length-1];
  if(!startM){startM=L.circleMarker(pts[0],{radius:8,color:'#fff',weight:2,fillColor:'#16a34a',fillOpacity:1}).addTo(map);}
  if(!meM){meM=L.circleMarker(last,{radius:9,color:'#fff',weight:3,fillColor:'#1a56db',fillOpacity:1}).addTo(map);}
  else{meM.setLatLng(last);}
  map.setView(last,Math.max(map.getZoom(),17));
};
init();
</script></body></html>`;

export default function ActiveRecoveryScreen({ route, navigation }) {
  useKeepAwake();
  const { session, transportMode, vehicleNumber } = route.params || {};
  const sessionId = (session && (session.sessionId || session._id)) || 'ACTIVE_SESSION';
  const localStartMsRef = useRef(Date.now());
  const localStartIsoRef = useRef(new Date(localStartMsRef.current).toISOString());

  // Resolve mode & profile: Mode comes from transportMode, then session.vehicleType, then WALK
  const effectiveMode = (transportMode || session?.vehicleType || 'WALK').toUpperCase().trim();
  const profile = getProfile(effectiveMode);

  const [path, setPath] = useState([]);
  const [meters, setMeters] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [latestAccuracy, setLatestAccuracy] = useState(null);
  const [isWeakGps, setIsWeakGps] = useState(false);
  const [hasStartedCounting, setHasStartedCounting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const pathRef = useRef([]);
  const metersRef = useRef(0);
  const movingSecondsRef = useRef(0);
  const pendingRef = useRef([]);
  const pendingMetersRef = useRef(0);
  const recentPointsRef = useRef([]);
  const consecutiveAcceptedRef = useRef(0);
  const hasStartedCountingRef = useRef(false);
  const lastAcceptedPointRef = useRef(null);
  const lastTimestampRef = useRef(null);

  const watchRef = useRef(null);
  const webRef = useRef(null);
  const allowLeave = useRef(false);

  const flush = async () => {
    if (!pendingRef.current.length) return;
    const points = pendingRef.current;
    const inc = pendingMetersRef.current;
    pendingRef.current = [];
    pendingMetersRef.current = 0;
    const batchId = 'BATCH_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    try {
      await apiPost(`/recovery/sessions/${sessionId}/points`, {
        points,
        incrementalDistanceMeters: Math.round(inc),
        batchId,
        movingSeconds: Math.round(movingSecondsRef.current),
      });
    } catch (e) {
      // Re-queue points locally if transient failure (offline save)
      pendingRef.current = points.concat(pendingRef.current);
      pendingMetersRef.current += inc;
    }
  };

  const addPoint = (p) => {
    if (!p) return;

    // Deduplicate identical timestamps between foreground watch and background task
    if (p.timestamp && lastTimestampRef.current === p.timestamp) {
      return;
    }
    lastTimestampRef.current = p.timestamp;

    if (p.accuracy != null) {
      setLatestAccuracy(p.accuracy);
    }

    // 1. Reject any point whose accuracy exceeds the profile's maxAcc
    if (p.accuracy == null || p.accuracy > profile.maxAcc) {
      setIsWeakGps(true);
      if (!hasStartedCountingRef.current) {
        consecutiveAcceptedRef.current = 0;
        recentPointsRef.current = [];
      }
      return;
    }

    // Point accepted within profile accuracy
    setIsWeakGps(false);
    consecutiveAcceptedRef.current += 1;

    // 2. Start counting only after 3 consecutive accepted points; until then show "Acquiring GPS"
    if (!hasStartedCountingRef.current) {
      recentPointsRef.current = [...recentPointsRef.current, p].slice(-3);
      if (consecutiveAcceptedRef.current < 3) {
        return;
      }

      // 3 consecutive accepted points reached! Start counting
      hasStartedCountingRef.current = true;
      setHasStartedCounting(true);

      let initialAnchor = p;
      if (profile.smooth) {
        const pts = recentPointsRef.current;
        const cnt = pts.length;
        const avgLat = pts.reduce((sum, pt) => sum + pt.latitude, 0) / cnt;
        const avgLng = pts.reduce((sum, pt) => sum + pt.longitude, 0) / cnt;
        initialAnchor = {
          ...p,
          latitude: avgLat,
          longitude: avgLng,
          pointId: p.pointId || ('PT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
        };
      } else {
        initialAnchor = {
          ...p,
          pointId: p.pointId || ('PT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
        };
      }

      pathRef.current = [initialAnchor];
      pendingRef.current.push(initialAnchor);
      lastAcceptedPointRef.current = p;
      setPath([initialAnchor]);
      return;
    }

    // 3. If speed is known and below 0.5 m/s, add 0 and do not move the anchor
    const isSpeedKnown = p.speed !== null && p.speed !== undefined;
    if (isSpeedKnown && p.speed < 0.5) {
      lastAcceptedPointRef.current = p;
      return;
    }

    const anchor = pathRef.current[pathRef.current.length - 1];
    if (!anchor) return;

    // 4. WALK: use the 3-point average and count a segment only if distance > minSegment(accuracy) and distance/time < maxSpeed
    if (profile.method === 'position') {
      const candidateBuffer = [...recentPointsRef.current, p].slice(-3);
      const cnt = candidateBuffer.length;
      const avgLat = candidateBuffer.reduce((sum, pt) => sum + pt.latitude, 0) / cnt;
      const avgLng = candidateBuffer.reduce((sum, pt) => sum + pt.longitude, 0) / cnt;
      const candidate = {
        ...p,
        latitude: avgLat,
        longitude: avgLng,
        pointId: p.pointId || ('PT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
      };

      const dist = distanceMeters(anchor, candidate);
      const prevTime = anchor.timestamp ? new Date(anchor.timestamp).getTime() : 0;
      const currTime = candidate.timestamp ? new Date(candidate.timestamp).getTime() : 0;
      const dt = (currTime && prevTime) ? (currTime - prevTime) / 1000 : 0;
      const calcSpeed = dt > 0 ? dist / dt : 0;
      const minRequired = typeof profile.minSegment === 'function'
        ? profile.minSegment(p.accuracy)
        : Math.max(5, 1.5 * p.accuracy);

      if (dist > minRequired && dt > 0 && calcSpeed < profile.maxSpeed) {
        recentPointsRef.current = candidateBuffer;
        lastAcceptedPointRef.current = p;
        pathRef.current = [...pathRef.current, candidate];
        metersRef.current += dist;
        pendingRef.current.push(candidate);
        pendingMetersRef.current += dist;

        // Track movingSeconds (sum of dt while speed >= 0.5)
        const effectiveSpeed = p.speed != null ? p.speed : calcSpeed;
        if (effectiveSpeed >= 0.5) {
          movingSecondsRef.current += dt;
        }

        setPath([...pathRef.current]);
        setMeters(metersRef.current);
      }
      return;
    }

    // 5. BIKE/CAR: add the average of the previous and current speed × dt (trapezoid),
    // where dt comes from the GPS point timestamps and is capped at 5 s, when speed is between 0.5 and maxSpeed.
    // If speed is null, use the Haversine distance only if it is > max(10 m, accuracy) and distance/time < maxSpeed.
    if (profile.method === 'speed') {
      const prevPt = lastAcceptedPointRef.current || anchor;
      const prevTime = prevPt.timestamp ? new Date(prevPt.timestamp).getTime() : 0;
      const currTime = p.timestamp ? new Date(p.timestamp).getTime() : 0;
      const rawDt = (currTime && prevTime) ? (currTime - prevTime) / 1000 : 0;
      const dt = Math.max(0, Math.min(5, rawDt));

      // Speed is between 0.5 and maxSpeed: trapezoid speed * dt
      if (p.speed != null && p.speed >= 0.5 && p.speed <= profile.maxSpeed) {
        const prevSpeed = (prevPt.speed != null && prevPt.speed >= 0.5) ? prevPt.speed : p.speed;
        const avgSpeed = (prevSpeed + p.speed) / 2;
        const incDist = avgSpeed * dt;

        if (dt > 0 && incDist > 0) {
          metersRef.current += incDist;
          pendingMetersRef.current += incDist;
          movingSecondsRef.current += dt;
        }

        const candidate = {
          ...p,
          pointId: p.pointId || ('PT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
        };
        pathRef.current = [...pathRef.current, candidate];
        pendingRef.current.push(candidate);
        lastAcceptedPointRef.current = p;
        setPath([...pathRef.current]);
        setMeters(metersRef.current);
        return;
      }

      // If speed is null, use Haversine distance only if > max(10 m, accuracy) and distance/time < maxSpeed
      if (p.speed == null) {
        const dist = distanceMeters(anchor, p);
        const calcSpeed = rawDt > 0 ? dist / rawDt : 0;

        if (dist > Math.max(10, p.accuracy) && rawDt > 0 && calcSpeed < profile.maxSpeed) {
          metersRef.current += dist;
          pendingMetersRef.current += dist;
          if (calcSpeed >= 0.5) {
            movingSecondsRef.current += dt;
          }

          const candidate = {
            ...p,
            pointId: p.pointId || ('PT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
          };
          pathRef.current = [...pathRef.current, candidate];
          pendingRef.current.push(candidate);
          lastAcceptedPointRef.current = p;
          setPath([...pathRef.current]);
          setMeters(metersRef.current);
          return;
        }
      }
      return;
    }
  };

  const handleIncomingLocation = (loc) => {
    if (!loc || !loc.coords) return;
    const c = loc.coords;
    if (c.accuracy != null) {
      setLatestAccuracy(c.accuracy);
    }
    // Pass raw GPS speed through (speed: c.speed; null stays null, -1 becomes null)
    const rawSpeed = (c.speed != null && c.speed >= 0) ? c.speed : null;
    addPoint({
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy != null ? c.accuracy : 10,
      speed: rawSpeed,
      timestamp: loc.timestamp ? new Date(loc.timestamp).toISOString() : new Date().toISOString(),
    });
  };

  useEffect(() => {
    globalLocationListener = handleIncomingLocation;
    return () => {
      if (globalLocationListener === handleIncomingLocation) {
        globalLocationListener = null;
      }
    };
  });

  useEffect(() => {
    if (!mapReady || !path.length || !webRef.current) return;
    const coords = path.map((p) => [p.latitude, p.longitude]);
    webRef.current.injectJavaScript(
      `window.updatePath && window.updatePath(${JSON.stringify(coords)}); true;`
    );
  }, [path, mapReady]);

  useEffect(() => {
    const t = setInterval(() => setSeconds((Date.now() - localStartMsRef.current) / 1000), 1000);
    const f = setInterval(flush, 10000);
    return () => { clearInterval(t); clearInterval(f); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Permission Needed', 'Please allow GPS location access to track your recovery route.');
        return;
      }

      // Request background permission if supported
      try {
        if (Location.requestBackgroundPermissionsAsync) {
          await Location.requestBackgroundPermissionsAsync();
        }
      } catch (e) {
        console.warn('[Location] Background permission request error:', e);
      }

      // Start background location updates with foregroundService notification
      try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!hasStarted) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 1,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'EasyFin Recovery',
              notificationBody: 'EasyFin recovery in progress',
              notificationColor: '#1A56DB',
            },
            pausesLocationUpdatesAutomatically: false,
          });
        }
      } catch (e) {
        console.warn('[Location] Failed to start background location updates:', e);
      }

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (loc) => {
          handleIncomingLocation(loc);
        }
      );
      if (cancelled) sub.remove(); else watchRef.current = sub;
    })();

    return () => {
      cancelled = true;
      watchRef.current?.remove();
    };
  }, []);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (allowLeave.current) return;
        e.preventDefault();
        Alert.alert('Recovery in Progress', 'Please tap Stop Recovery to finish before leaving this screen.');
      }),
    [navigation]
  );

  const doStop = async () => {
    setStopping(true);
    globalLocationListener = null;
    watchRef.current?.remove();
    watchRef.current = null;

    // Stop background location updates service
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch (e) {
      console.warn('[Location] Failed to stop background updates:', e);
    }

    let end = pathRef.current[pathRef.current.length - 1];
    try {
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const curAcc = cur.coords.accuracy != null ? cur.coords.accuracy : 10;
      if (cur.coords.accuracy != null) {
        setLatestAccuracy(cur.coords.accuracy);
      }
      // Add the final fix only if its accuracy <= profile.maxAcc
      if (curAcc <= profile.maxAcc) {
        const rawSpeed = (cur.coords.speed != null && cur.coords.speed >= 0) ? cur.coords.speed : null;
        const p = {
          latitude: cur.coords.latitude,
          longitude: cur.coords.longitude,
          accuracy: curAcc,
          speed: rawSpeed,
          timestamp: cur.timestamp ? new Date(cur.timestamp).toISOString() : new Date().toISOString(),
        };
        addPoint(p);
      }
      end = pathRef.current[pathRef.current.length - 1] || end;
    } catch (e) {}

    await flush();
    allowLeave.current = true;
    const exactDurationSeconds = (Date.now() - localStartMsRef.current) / 1000;
    navigation.replace('Complete', {
      session: {
        ...(session || {}),
        startTime: localStartIsoRef.current,
      },
      startTime: localStartIsoRef.current,
      distanceMeters: metersRef.current,
      durationSeconds: exactDurationSeconds,
      movingSeconds: Math.round(movingSecondsRef.current),
      startLocation: pathRef.current[0] || session?.startLocation || null,
      endLocation: end || pathRef.current[0] || null,
      transportMode: transportMode || session?.vehicleType || 'WALK',
      vehicleNumber: vehicleNumber || session?.vehicleNumber || '',
      startPhotoUri: route.params?.startPhotoUri || session?.startPhotoUri || null,
      allPoints: pathRef.current,
    });
  };

  const stop = () =>
    Alert.alert('Stop Recovery?', 'Route tracking will stop and you will proceed to the completion form.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop Recovery', style: 'destructive', onPress: doStop },
    ]);

  const modeLabel = effectiveMode;

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        style={styles.map}
        originWhitelist={['*']}
        source={{ html: MAP_HTML, baseUrl: 'https://easyfin-staff-recovery.onrender.com' }}
        javaScriptEnabled
        domStorageEnabled
        onLoadEnd={() => setMapReady(true)}
      />
      <View style={styles.panel}>
        {/* Header bar with Transport Mode badge, GPS accuracy, and acquiring/active indicator */}
        <View style={styles.topInfoRow}>
          <View style={styles.modeBadge}>
            <Ionicons
              name={
                modeLabel === 'WALK'
                  ? 'walk'
                  : modeLabel === 'BIKE'
                  ? 'bicycle'
                  : modeLabel === 'OTHER'
                  ? 'bus'
                  : 'car'
              }
              size={14}
              color="#2563EB"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.modeBadgeText}>{modeLabel}</Text>
          </View>
          {vehicleNumber ? (
            <Text style={styles.vehicleNumberText}>{vehicleNumber}</Text>
          ) : null}
          <View style={styles.gpsIndicator}>
            <View
              style={[
                styles.gpsDot,
                {
                  backgroundColor: isWeakGps
                    ? '#EF4444'
                    : hasStartedCounting
                    ? '#10B981'
                    : '#F59E0B',
                },
              ]}
            />
            <Text style={styles.gpsText}>
              {!hasStartedCounting
                ? 'Acquiring GPS'
                : latestAccuracy != null
                ? `GPS accuracy: ${Math.round(latestAccuracy)} m`
                : 'GPS Active'}
            </Text>
          </View>
        </View>

        {/* While points are being rejected: Distance paused: weak GPS */}
        {isWeakGps ? (
          <View style={styles.weakSignalBanner}>
            <Ionicons name="warning" size={14} color="#DC2626" style={{ marginRight: 6 }} />
            <Text style={styles.weakSignalText}>Distance paused: weak GPS</Text>
            {latestAccuracy != null ? (
              <Text style={styles.weakSignalAccText}>({Math.round(latestAccuracy)} m)</Text>
            ) : null}
          </View>
        ) : latestAccuracy != null ? (
          <View style={styles.accuracyBanner}>
            <Ionicons name="navigate-circle-outline" size={13} color="#475569" style={{ marginRight: 4 }} />
            <Text style={styles.accuracyText}>GPS accuracy: {Math.round(latestAccuracy)} m (limit: {profile.maxAcc} m)</Text>
          </View>
        ) : null}

        {/* Live Metrics */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>ELAPSED TIME</Text>
            <Text style={styles.metricValue}>{formatDuration(seconds)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>DISTANCE</Text>
            <Text style={styles.metricValue}>{formatDistance(meters)}</Text>
          </View>
        </View>

        {/* Stop Recovery Button */}
        <TouchableOpacity style={styles.stopBtn} onPress={stop} disabled={stopping} activeOpacity={0.85}>
          {stopping ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.stopBtnContent}>
              <Ionicons name="stop-circle" size={22} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.stopText}>STOP RECOVERY</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  map: { flex: 1 },
  panel: {
    backgroundColor: '#FFFFFF', padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 8,
  },
  topInfoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  weakSignalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  weakSignalText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  weakSignalAccText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991B1B',
    marginLeft: 4,
  },
  accuracyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 12,
  },
  accuracyText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  modeBadgeText: { fontSize: 12, fontWeight: '800', color: '#1E40AF', textTransform: 'uppercase' },
  vehicleNumberText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  gpsIndicator: { flexDirection: 'row', alignItems: 'center' },
  gpsDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  gpsText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  metricsGrid: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  metricCard: {
    flex: 1, backgroundColor: '#F8FAFC', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#E2E8F0',
  },
  metricLabel: { fontSize: 10, fontWeight: '700', color: '#64748B', letterSpacing: 0.5 },
  metricValue: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  stopBtn: {
    backgroundColor: '#DC2626', height: 54, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#DC2626', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  stopBtnContent: { flexDirection: 'row', alignItems: 'center' },
  stopText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});
