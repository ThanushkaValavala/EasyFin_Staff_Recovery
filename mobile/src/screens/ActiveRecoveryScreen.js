import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { apiPost } from '../api';
import { distanceMeters, formatDistance, formatDuration, isValidMovement } from '../utils/geo'; // ADDED isValidMovement

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
  const { session, caseId, customer, loan, cases, transportMode } = route.params;
  const sessionId = session.sessionId || session._id;
  const started = session.startTime || session.startedAt || session.createdAt;
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
      pendingRef.current = points.concat(pendingRef.current);
      pendingMetersRef.current += inc;
    }
  };

  const addPoint = (p) => {
    const last = pathRef.current[pathRef.current.length - 1];
    
    // NEW: Check if the movement is valid (filters noise and jumps)
    if (last && !isValidMovement(last, p)) return; 
    
    const d = last ? distanceMeters(last, p) : 0;

    pathRef.current = [...pathRef.current, p];
    metersRef.current += d;
    pendingRef.current.push(p);
    pendingMetersRef.current += d;
    setPath([...pathRef.current]); // Trigger re-render smoothly
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
        Alert.alert('Location needed', 'Please allow location access to track the recovery.');
        return;
      }
      
      // NEW: Changed timeInterval to 2000ms and distanceInterval to 2m for smoother tracking
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 2000 },
        (loc) => {
          const c = loc.coords;
          addPoint({
            latitude: c.latitude,
            longitude: c.longitude,
            accuracy: c.accuracy || 10, // Default to 10 if unknown
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
        Alert.alert('Recovery in progress', 'Tap Stop Recovery to finish before leaving.');
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
    if (!end) {
      Alert.alert('No location yet', 'Could not read your location. Move to an open area and try again.');
      setStopping(false);
      return;
    }
    await flush();
    allowLeave.current = true;
    navigation.replace('Complete', {
      cases,
      session,
      caseId,
      customer,
      loan,
      distanceMeters: metersRef.current,
      durationSeconds: (Date.now() - startedAt.current) / 1000,
      startLocation: pathRef.current[0] || session.startLocation || null,
      endLocation: end,
      transportMode,
    });
  };

  const stop = () =>
    Alert.alert('Stop recovery?', 'Tracking will end and you will add proof next.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: doStop },
    ]);

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
        <Text style={styles.name}>{cases && cases.length > 1 ? cases.length + ' customers' : (customer?.name || 'Recovery in progress')}</Text>
        <View style={styles.row}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatDuration(seconds)}</Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatDistance(meters)}</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
        </View>
        {path.length === 0 && <Text style={styles.wait}>Waiting for GPS signal...</Text>}
        <TouchableOpacity style={styles.stopBtn} onPress={stop} disabled={stopping}>
          {stopping ? <ActivityIndicator color="#fff" /> : <Text style={styles.stopText}>Stop Recovery</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  map: { flex: 1 },
  panel: { backgroundColor: '#fff', padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  name: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', marginBottom: 8 },
  stat: { flex: 1 },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { color: '#666' },
  wait: { color: '#b45309', marginBottom: 8 },
  stopBtn: { backgroundColor: '#b91c1c', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  stopText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});