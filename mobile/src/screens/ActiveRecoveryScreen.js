import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { apiPost } from '../api';
import { distanceMeters, formatDistance, formatDuration, isValidMovement } from '../utils/geo';

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
  const started = session?.startTime || session?.startedAt || session?.createdAt;
  const startedAt = useRef(started ? new Date(started).getTime() : Date.now());

  const [path, setPath] = useState([]);
  const [meters, setMeters] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const pathRef = useRef([]);
  const metersRef = useRef(0);
  const pendingRef = useRef([]);
  const pendingMetersRef = useRef(0);
  const watchRef = useRef(null);
  const webRef = useRef(null);
  const allowLeave = useRef(false);

  const flush = async () => {
    if (!pendingRef.current.length) return;
    const points = pendingRef.current;
    const inc = pendingMetersRef.current;
    pendingRef.current = [];
    pendingMetersRef.current = 0;
    try {
      await apiPost(`/recovery/sessions/${sessionId}/points`, {
        points,
        incrementalDistanceMeters: Math.round(inc),
      });
    } catch (e) {
      // Re-queue points locally if transient failure
      pendingRef.current = points.concat(pendingRef.current);
      pendingMetersRef.current += inc;
    }
  };

  const addPoint = (p) => {
    const last = pathRef.current[pathRef.current.length - 1];
    
    // Existing Drift & Jump Filter (strict preservation)
    if (last && !isValidMovement(last, p)) return; 
    
    // Existing Haversine calculation
    const d = last ? distanceMeters(last, p) : 0;

    pathRef.current = [...pathRef.current, p];
    metersRef.current += d;
    pendingRef.current.push(p);
    pendingMetersRef.current += d;
    setPath([...pathRef.current]);
    setMeters(metersRef.current);
  };

  useEffect(() => {
    if (!mapReady || !path.length || !webRef.current) return;
    const coords = path.map((p) => [p.latitude, p.longitude]);
    webRef.current.injectJavaScript(
      `window.updatePath && window.updatePath(${JSON.stringify(coords)}); true;`
    );
  }, [path, mapReady]);

  useEffect(() => {
    const t = setInterval(() => setSeconds((Date.now() - startedAt.current) / 1000), 1000);
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
      
      // Existing High-accuracy GPS tracking
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 2000 },
        (loc) => {
          const c = loc.coords;
          addPoint({
            latitude: c.latitude,
            longitude: c.longitude,
            accuracy: c.accuracy || 10,
            speed: c.speed && c.speed > 0 ? c.speed : 0,
            timestamp: new Date(loc.timestamp).toISOString(),
          });
        }
      );
      if (cancelled) sub.remove(); else watchRef.current = sub;
    })();
    return () => { cancelled = true; watchRef.current?.remove(); };
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
    watchRef.current?.remove();
    watchRef.current = null;
    let end = pathRef.current[pathRef.current.length - 1];
    try {
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const p = {
        latitude: cur.coords.latitude,
        longitude: cur.coords.longitude,
        accuracy: cur.coords.accuracy || 10,
        speed: 0,
        timestamp: new Date().toISOString(),
      };
      addPoint(p);
      end = pathRef.current[pathRef.current.length - 1] || end;
    } catch (e) {}

    await flush();
    allowLeave.current = true;
    navigation.replace('Complete', {
      session,
      distanceMeters: metersRef.current,
      durationSeconds: (Date.now() - startedAt.current) / 1000,
      startLocation: pathRef.current[0] || session?.startLocation || null,
      endLocation: end || pathRef.current[0] || null,
      transportMode: transportMode || session?.vehicleType || 'WALK',
      vehicleNumber: vehicleNumber || session?.vehicleNumber || '',
    });
  };

  const stop = () =>
    Alert.alert('Stop Recovery?', 'Route tracking will stop and you will proceed to the completion form.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop Recovery', style: 'destructive', onPress: doStop },
    ]);

  const modeLabel = transportMode || session?.vehicleType || 'WALK';

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
        {/* Header bar with Transport Mode badge */}
        <View style={styles.topInfoRow}>
          <View style={styles.modeBadge}>
            <Ionicons
              name={modeLabel === 'WALK' ? 'walk' : modeLabel === 'CYCLE' ? 'bicycle' : modeLabel === 'BIKE' ? 'bicycle' : 'car'}
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
            <View style={[styles.gpsDot, { backgroundColor: path.length ? '#10B981' : '#F59E0B' }]} />
            <Text style={styles.gpsText}>{path.length ? 'GPS Active' : 'Acquiring GPS'}</Text>
          </View>
        </View>

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
    marginBottom: 14,
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
