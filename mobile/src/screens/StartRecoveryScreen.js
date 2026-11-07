import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, Alert,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { apiUploadFile, apiPost } from '../api';

// Generate a stable unique session ID on the device for idempotency
function generateDeviceSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `DSK-${ts}-${rand}`.toUpperCase();
}

const TRANSPORT_MODES = [
  { key: 'WALK', label: 'Walk', icon: 'walk-outline' },
  { key: 'BIKE', label: 'Bike', icon: 'bicycle-outline' },
  { key: 'CAR', label: 'Car', icon: 'car-outline' },
];

const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return p(x.getDate()) + '-' + p(x.getMonth() + 1) + '-' + x.getFullYear();
};

export default function StartRecoveryScreen({ route, navigation }) {
  const p = route.params || {};
  const cases = p.cases && p.cases.length
    ? p.cases
    : [{ id: p.caseId, customer: p.customer || {}, loan: p.loan || {} }];
  const area = p.area || (cases[0].customer && cases[0].customer.area) || '';

  const [idx, setIdx] = useState(0);
  const [transportMode, setTransportMode] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Stable device-side session ID — generated once per mount for idempotency
  const deviceSessionId = useRef(generateDeviceSessionId()).current;

  const cur = cases[idx];
  const customer = cur.customer || {};
  const loan = cur.loan || {};

  const isWalk = transportMode === 'WALK';
  const needsVehicle = transportMode === 'BIKE' || transportMode === 'CAR';

  // Validation for Start button
  const canStart = (() => {
    if (!transportMode) return false;
    if (isWalk) return true;
    if (needsVehicle) {
      const vnClean = vehicleNumber.replace(/[\s-]/g, '');
      return vnClean.length >= 4 && !!photo;
    }
    return false;
  })();

  const takeSpeedometer = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Please allow camera access to take the speedometer photo.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.5,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) {
      setPhoto(r.assets[0].uri);
      setError('');
    }
  };

  const goActive = (session) =>
    navigation.replace('ActiveRecovery', {
      session,
      cases,
      caseId: cases[0].id,
      customer: cases[0].customer,
      loan: cases[0].loan,
      transportMode,
    });

  const start = async () => {
    setError('');
    if (!transportMode) {
      setError('Select a transport mode.');
      return;
    }
    if (needsVehicle) {
      if (!photo) {
        setError('Take a photo of the starting speedometer first.');
        return;
      }
      if (vehicleNumber.replace(/[\s-]/g, '').length < 4) {
        setError('Enter a valid vehicle number.');
        return;
      }
    }

    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission is needed to track the recovery route.');
        setLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const initialLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
      };

      const fields = {
        assignmentIds: JSON.stringify(cases.map((c) => c.id)),
        vehicleType: transportMode,
        vehicleNumber: isWalk ? '' : vehicleNumber,
        area,
        initialLocation: JSON.stringify(initialLocation),
        deviceSessionId,
      };

      let data;
      if (isWalk) {
        // Walk: JSON submit (no photo) — start-with-photo handles Walk too
        data = await apiPost('/recovery/start-with-photo', {
          assignmentIds: cases.map((c) => c.id),
          vehicleType: 'WALK',
          vehicleNumber: '',
          area,
          initialLocation,
          deviceSessionId,
        });
      } else {
        data = await apiUploadFile(
          '/recovery/start-with-photo',
          fields,
          'startPhoto',
          photo
        );
      }
      goActive(data.session);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.session) {
        Alert.alert(
          'Recovery already active',
          'You already have a recovery in progress.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Resume it', onPress: () => goActive(e.data.session) },
          ]
        );
        return;
      }
      setError(
        e.message === 'Network request failed'
          ? 'Cannot reach the server. Check your internet.'
          : e.message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Case tabs */}
      {cases.length > 1 ? (
        <View>
          <Text style={styles.caseLabel}>Case {idx + 1} of {cases.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {cases.map((c, i) => (
              <TouchableOpacity
                key={c.id || i}
                style={[styles.tab, i === idx && styles.tabOn]}
                onPress={() => setIdx(i)}
              >
                <Text style={[styles.tabText, i === idx && styles.tabTextOn]}>
                  {(i + 1) + '. ' + ((c.customer && c.customer.name) || 'Customer')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Customer info */}
      <View style={styles.card}>
        <Text style={styles.section}>CUSTOMER DETAILS</Text>
        <Text style={styles.k}>Customer Name</Text>
        <Text style={styles.v}>{customer.name || '-'}</Text>
        <Text style={styles.k}>Address</Text>
        <Text style={styles.v}>{customer.address || '-'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>LOAN DETAILS</Text>
        <Text style={styles.k}>Loan Number</Text>
        <Text style={styles.v}>{loan.loanId || '-'}</Text>
        <Text style={styles.k}>Loan Date</Text>
        <Text style={styles.v}>{fmtDate(loan.loanDate)}</Text>
        <Text style={styles.k}>Loan Type</Text>
        <Text style={styles.v}>{loan.loanType || '-'}</Text>
      </View>

      {/* ── STEP 1: Transport Mode ───────────────────────────────────────── */}
      <Text style={styles.stepLabel}>Step 1: Select Transport Mode</Text>
      <View style={styles.transportRow}>
        {TRANSPORT_MODES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.transportCard, transportMode === t.key && styles.transportCardActive]}
            onPress={() => {
              setTransportMode(t.key);
              setError('');
            }}
          >
            <Ionicons
              name={t.icon}
              size={28}
              color={transportMode === t.key ? '#fff' : '#475569'}
            />
            <Text style={[styles.transportLabel, transportMode === t.key && styles.transportLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── STEP 2: Vehicle Details (only for Bike/Car) ──────────────────── */}
      {needsVehicle ? (
        <>
          <Text style={styles.stepLabel}>Step 2: Vehicle Details</Text>
          <Text style={styles.fieldLabel}>Vehicle Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. KA01AB1234"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={14}
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
          />

          <Text style={styles.fieldLabel}>Starting Speedometer Photo (required)</Text>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : null}
          <TouchableOpacity style={styles.camBtn} onPress={takeSpeedometer}>
            <Ionicons name="camera-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.camText}>
              {photo ? 'Retake Speedometer Photo' : 'Take Speedometer Photo'}
            </Text>
          </TouchableOpacity>
        </>
      ) : isWalk ? (
        <View style={styles.walkNotice}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#15803D" style={{ marginRight: 8 }} />
          <Text style={styles.walkNoticeText}>Walk mode — no vehicle details needed</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Start button */}
      <TouchableOpacity
        style={[styles.button, !canStart && styles.disabled]}
        onPress={start}
        disabled={loading || !canStart}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="play-circle" size={22} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Start Recovery</Text>
          </>
        )}
      </TouchableOpacity>

      {!canStart && transportMode ? (
        <Text style={styles.note}>
          {isWalk
            ? ''
            : needsVehicle && !photo
            ? 'Take the starting speedometer photo to enable Start Recovery.'
            : needsVehicle && vehicleNumber.replace(/[\s-]/g, '').length < 4
            ? 'Enter a valid vehicle number.'
            : ''}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  caseLabel: { fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  tab: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1',
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8,
  },
  tabOn: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  tabText: { color: '#0F172A', fontWeight: '600' },
  tabTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  section: { fontSize: 12, fontWeight: '800', color: '#2563EB', letterSpacing: 0.8, marginBottom: 8 },
  k: { color: '#64748B', fontSize: 12, marginTop: 6 },
  v: { color: '#0F172A', fontSize: 16, fontWeight: '600' },
  stepLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginTop: 16, marginBottom: 12 },
  transportRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  transportCard: {
    flex: 1, marginHorizontal: 4, backgroundColor: '#fff', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: '#E2E8F0',
  },
  transportCardActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  transportLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 6 },
  transportLabelActive: { color: '#fff' },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12, color: '#0F172A' },
  input: {
    borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 4,
  },
  photo: { width: '100%', height: 200, borderRadius: 10, marginBottom: 10 },
  camBtn: {
    backgroundColor: '#1a56db', padding: 14, borderRadius: 10,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  camText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  walkNotice: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7',
    borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#86EFAC',
  },
  walkNoticeText: { color: '#15803D', fontWeight: '600', fontSize: 14 },
  error: { color: '#c00', marginTop: 12, fontWeight: '500' },
  button: {
    backgroundColor: '#15803d', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24, flexDirection: 'row', justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  note: { color: '#b45309', textAlign: 'center', marginTop: 10, fontSize: 13 },
});
