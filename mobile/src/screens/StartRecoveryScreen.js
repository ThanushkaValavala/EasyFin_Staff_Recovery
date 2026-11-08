import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { apiUploadFile, apiPost } from '../api';

function generateDeviceSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `DSK-${ts}-${rand}`.toUpperCase();
}

// ─── Transport Mode Definitions ─────────────────────────────────────────────
const TRANSPORT_MODES = [
  {
    key: 'WALK',
    label: 'Walking',
    icon: 'walk-outline',
    sub: 'No vehicle required • Start immediately',
    color: '#059669',
    bgColor: '#ECFDF5',
    borderColor: '#6EE7B7',
    requiresVehicle: false,
    requiresPhoto: false,
  },
  {
    key: 'CYCLE',
    label: 'Cycle',
    icon: 'bicycle-outline',
    sub: 'No vehicle number or speedometer required',
    color: '#0284C7',
    bgColor: '#E0F2FE',
    borderColor: '#7DD3FC',
    requiresVehicle: false,
    requiresPhoto: false,
  },
  {
    key: 'BIKE',
    label: 'Bike',
    icon: 'bicycle-outline',
    sub: 'Registration number + starting speedometer photo',
    color: '#D97706',
    bgColor: '#FFFBEB',
    borderColor: '#FCD34D',
    requiresVehicle: true,
    requiresPhoto: true,
  },
  {
    key: 'CAR',
    label: 'Car',
    icon: 'car-outline',
    sub: 'Registration number + starting speedometer photo',
    color: '#7C3AED',
    bgColor: '#F5F3FF',
    borderColor: '#C4B5FD',
    requiresVehicle: true,
    requiresPhoto: true,
  },
];

export default function StartRecoveryScreen({ route, navigation }) {
  const [transportMode, setTransportMode] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Device-side session ID for idempotency & offline safety
  const deviceSessionId = useRef(generateDeviceSessionId()).current;

  const selectedMode = TRANSPORT_MODES.find((m) => m.key === transportMode);
  const needsVehicle = selectedMode?.requiresVehicle || false;
  const needsPhoto = selectedMode?.requiresPhoto || false;

  // Validation Rules:
  // WALK/CYCLE: Transport selected only → ready to start
  // BIKE/CAR: Valid vehicle number (>= 4 alphanumeric) AND camera image
  const canStart = (() => {
    if (!transportMode) return false;
    if (!needsVehicle) return true;
    const vnClean = vehicleNumber.replace(/[\s-]/g, '').toUpperCase();
    return vnClean.length >= 4 && !!photo;
  })();

  const takeSpeedometer = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera Permission Required', 'Please allow camera access to capture the speedometer photo. Gallery uploads are not permitted.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      // Camera only — no gallery
    });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) {
      setPhoto(r.assets[0].uri);
      setError('');
    }
  };

  const start = async () => {
    setError('');
    if (!transportMode) {
      setError('Please select a transport mode.');
      return;
    }
    if (needsVehicle) {
      if (!vehicleNumber.trim()) {
        setError('Vehicle registration number is required.');
        return;
      }
      const vnClean = vehicleNumber.replace(/[\s-]/g, '');
      if (vnClean.length < 4) {
        setError('Enter a valid vehicle registration number (min. 4 characters).');
        return;
      }
      if (!photo) {
        setError('Starting speedometer photo is mandatory for ' + selectedMode.label + '.');
        return;
      }
    }

    setLoading(true);
    try {
      // Request location permission
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission is required to track the recovery route. Please enable it in device settings.');
        setLoading(false);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const initialLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
      };

      let data;
      if (!needsPhoto) {
        // WALK / CYCLE: JSON start
        data = await apiPost('/recovery/start-with-photo', {
          vehicleType: transportMode,
          vehicleNumber: '',
          initialLocation,
          deviceSessionId,
        });
      } else {
        // BIKE / CAR: multipart with starting speedometer
        data = await apiUploadFile(
          '/recovery/start-with-photo',
          {
            vehicleType: transportMode,
            vehicleNumber: vehicleNumber.trim().toUpperCase(),
            initialLocation: JSON.stringify(initialLocation),
            deviceSessionId,
          },
          'startPhoto',
          photo
        );
      }

      const createdSession = (data && data.session) ? data.session : {
        sessionId: deviceSessionId,
        deviceSessionId,
        vehicleType: transportMode,
        vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
        startLocation: initialLocation,
        startTime: new Date().toISOString(),
      };

      navigation.replace('ActiveRecovery', {
        session: createdSession,
        transportMode,
        vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
      });
    } catch (e) {
      if (e.status === 409 && e.data && e.data.session) {
        Alert.alert(
          'Recovery Already Active',
          'You already have an active recovery session in progress.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Resume',
              onPress: () =>
                navigation.replace('ActiveRecovery', {
                  session: e.data.session,
                  transportMode: e.data.session.vehicleType || transportMode,
                  vehicleNumber: e.data.session.vehicleNumber || '',
                }),
            },
          ]
        );
        return;
      }

      // Backend unreachable → start offline
      if (e.isNetworkError || e.message === 'Network request failed' || (e.status && e.status >= 500)) {
        console.warn('[StartRecovery] Backend unreachable — starting offline session');
        const offlineSession = {
          sessionId: deviceSessionId,
          deviceSessionId,
          vehicleType: transportMode,
          vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
          startTime: new Date().toISOString(),
          startPhotoUri: photo,
          _syncStatus: 'PENDING',
        };
        navigation.replace('ActiveRecovery', {
          session: offlineSession,
          transportMode,
          vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
        });
        return;
      }

      setError(e.message || 'Could not start recovery. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Recovery Preparation</Text>
          <Text style={styles.subtitle}>Select your transport mode and provide required details</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#DC2626" style={{ marginRight: 8 }} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── STEP 1: TRANSPORT MODE ───────────────────────────────────── */}
        <Text style={styles.sectionLabel}>1. Select Transport Mode</Text>
        <View style={styles.modesContainer}>
          {TRANSPORT_MODES.map((mode) => {
            const selected = transportMode === mode.key;
            return (
              <TouchableOpacity
                key={mode.key}
                style={[
                  styles.modeCard,
                  selected && { borderColor: mode.color, backgroundColor: mode.bgColor },
                ]}
                onPress={() => {
                  setTransportMode(mode.key);
                  setError('');
                  if (!mode.requiresVehicle) {
                    setVehicleNumber('');
                    setPhoto(null);
                  }
                }}
                activeOpacity={0.85}
              >
                <View style={styles.modeCardInner}>
                  <View style={[
                    styles.modeIconBg,
                    selected && { backgroundColor: mode.color + '22' },
                  ]}>
                    <Ionicons
                      name={mode.icon}
                      size={26}
                      color={selected ? mode.color : '#64748B'}
                    />
                  </View>
                  <View style={styles.modeTextBlock}>
                    <Text style={[styles.modeLabel, selected && { color: mode.color }]}>
                      {mode.label}
                    </Text>
                    <Text style={styles.modeSub}>{mode.sub}</Text>
                  </View>
                  <View style={[styles.radioOuter, selected && { borderColor: mode.color }]}>
                    {selected ? <View style={[styles.radioInner, { backgroundColor: mode.color }]} /> : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── STEP 2: VEHICLE NUMBER (BIKE/CAR only) ──────────────────── */}
        {needsVehicle ? (
          <>
            <Text style={styles.sectionLabel}>2. Vehicle Registration Number</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="car-outline" size={20} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="e.g. KA 01 AB 1234"
                placeholderTextColor="#94A3B8"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={15}
                value={vehicleNumber}
                onChangeText={(t) => setVehicleNumber(t.toUpperCase())}
              />
            </View>

            <Text style={styles.sectionLabel}>3. Starting Speedometer Evidence</Text>
            <Text style={styles.helperText}>
              Camera only — capture the speedometer reading before you begin.
            </Text>

            {photo ? (
              <View style={styles.previewBox}>
                <Image source={{ uri: photo }} style={styles.previewImage} resizeMode="cover" />
                <TouchableOpacity style={styles.retakeBtn} onPress={takeSpeedometer}>
                  <Ionicons name="camera-reverse-outline" size={16} color="#2563EB" style={{ marginRight: 6 }} />
                  <Text style={styles.retakeBtnText}>Retake Photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.cameraBtn} onPress={takeSpeedometer} activeOpacity={0.85}>
                <View style={styles.cameraIconBg}>
                  <Ionicons name="camera" size={32} color="#2563EB" />
                </View>
                <Text style={styles.cameraBtnTitle}>Capture Speedometer Photo</Text>
                <Text style={styles.cameraBtnSub}>Camera only · Gallery upload not allowed</Text>
              </TouchableOpacity>
            )}
          </>
        ) : null}

        {/* ── STEP: START RECOVERY ─────────────────────────────────────── */}
        <View style={styles.actionArea}>
          <TouchableOpacity
            style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
            onPress={start}
            disabled={loading || !canStart}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <View style={styles.startBtnContent}>
                <Ionicons name="play-circle" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.startBtnText}>Start Recovery</Text>
              </View>
            )}
          </TouchableOpacity>

          {transportMode && !canStart ? (
            <Text style={styles.validationHint}>
              {needsVehicle
                ? 'Enter vehicle number and take starting speedometer photo to proceed'
                : 'Ready — tap Start Recovery'}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 4, fontWeight: '500' },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10,
    marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', flex: 1 },

  sectionLabel: {
    fontSize: 13, fontWeight: '700', color: '#334155',
    marginBottom: 10, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  modesContainer: { gap: 10, marginBottom: 4 },
  modeCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  modeCardInner: { flexDirection: 'row', alignItems: 'center' },
  modeIconBg: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center',
  },
  modeTextBlock: { flex: 1, marginLeft: 12 },
  modeLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  modeSub: { fontSize: 11, color: '#64748B', marginTop: 2, fontWeight: '500' },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center',
  },
  radioInner: { width: 12, height: 12, borderRadius: 6 },

  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
    paddingHorizontal: 14, height: 52, marginBottom: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0F172A', letterSpacing: 0.5 },
  helperText: { fontSize: 12, color: '#64748B', marginBottom: 12, marginTop: -4, fontWeight: '500' },

  cameraBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 2, borderStyle: 'dashed',
    borderColor: '#93C5FD', borderRadius: 14, padding: 22,
    alignItems: 'center', marginBottom: 16,
  },
  cameraIconBg: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#EFF6FF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  cameraBtnTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  cameraBtnSub: { fontSize: 11, color: '#64748B', marginTop: 3 },

  previewBox: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16,
  },
  previewImage: { width: '100%', height: 190, borderRadius: 10 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 12, paddingVertical: 7, paddingHorizontal: 14,
    backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  retakeBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  actionArea: { marginTop: 24, marginBottom: 20 },
  startBtn: {
    backgroundColor: '#1D4ED8', height: 56, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#1D4ED8', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  startBtnContent: { flexDirection: 'row', alignItems: 'center' },
  startBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  startBtnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  validationHint: {
    fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 10, fontWeight: '500',
  },
});
