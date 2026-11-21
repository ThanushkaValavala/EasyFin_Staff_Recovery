import { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, Alert, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { apiUploadFile, apiPost, apiGet } from '../api';
import { getAccurateLocation } from '../utils/geo';
import { checkHasNumbers } from '../utils/speedometerCheck';

function generateDeviceSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `DSK-${ts}-${rand}`.toUpperCase();
}

// ─── Transport Mode Definitions ─────────────────────────────────────────────
const TRANSPORT_MODES = [
  {
    key: 'WALK',
    label: 'Walk',
    icon: 'walk-outline',
    sub: 'No vehicle required • Start immediately',
    color: '#059669',
    bgColor: '#ECFDF5',
    borderColor: '#6EE7B7',
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
  {
    key: 'OTHER',
    label: 'Other',
    icon: 'bus-outline',
    sub: 'General / public transit • Start immediately',
    color: '#0284C7',
    bgColor: '#E0F2FE',
    borderColor: '#7DD3FC',
    requiresVehicle: false,
    requiresPhoto: false,
  },
];

export default function StartRecoveryScreen({ route, navigation }) {
  const [transportMode, setTransportMode] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photo, setPhoto] = useState(null);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [speedometerFailedTries, setSpeedometerFailedTries] = useState(0);
  const [speedometerCheckError, setSpeedometerCheckError] = useState('');
  const [speedometerSkippedReason, setSpeedometerSkippedReason] = useState(null);
  const [lastSpeedometerPhoto, setLastSpeedometerPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Planned Location ──────────────────────────────────────────────────────
  const initialPlannedLoc = route?.params?.plannedLocation || (route?.params?.customer ? {
    name: route.params.customer.fullAddress || route.params.customer.location || 'Customer Address',
    latitude: route.params.customer.latitude || 0,
    longitude: route.params.customer.longitude || 0
  } : null);
  const initialPersonCount = route?.params?.plannedPersonCount ? String(route.params.plannedPersonCount) : (route?.params?.customer ? '1' : '');
  const initialNames = route?.params?.plannedNames || (route?.params?.customer?.customerName ? [route.params.customer.customerName] : (route?.params?.customer?.name ? [route.params.customer.name] : []));

  const [locationQuery, setLocationQuery] = useState(initialPlannedLoc?.name || '');
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [plannedLocation, setPlannedLocation] = useState(initialPlannedLoc); // { name, latitude, longitude }
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const debounceRef = useRef(null);

  // ── Person count & names ──────────────────────────────────────────────────
  const [plannedPersonCount, setPlannedPersonCount] = useState(initialPersonCount);
  const [plannedNames, setPlannedNames] = useState(initialNames);

  // Device-side session ID for idempotency & offline safety
  const deviceSessionId = useRef(generateDeviceSessionId()).current;

  const selectedMode = TRANSPORT_MODES.find((m) => m.key === transportMode);
  const needsVehicle = selectedMode?.requiresVehicle || false;
  const needsPhoto = selectedMode?.requiresPhoto || false;

  const personCount = parseInt(plannedPersonCount, 10);
  const validPersonCount = !isNaN(personCount) && personCount >= 1 && personCount <= 10;

  // ── Validation ────────────────────────────────────────────────────────────
  const canStart = (() => {
    if (!transportMode) return false;
    if (!plannedLocation) return false;
    if (!validPersonCount) return false;
    // All name boxes must be filled (trimmed non-empty)
    if (plannedNames.length !== personCount) return false;
    for (let i = 0; i < personCount; i++) {
      if (!(plannedNames[i] || '').trim()) return false;
    }
    if (!needsVehicle) return true;
    const vnClean = vehicleNumber.replace(/[\s-]/g, '').toUpperCase();
    return vnClean.length >= 4 && !!photo;
  })();

  // ── Place search (debounced, 400 ms, min 3 chars) ─────────────────────────
  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 3) {
      setLocationSuggestions([]);
      setLocationLoading(false);
      return;
    }
    setLocationLoading(true);
    setLocationError('');
    try {
      const res = await apiGet(`/places/search?q=${encodeURIComponent(q)}&limit=5`);
      const list = Array.isArray(res) ? res : (res.results || res.places || []);
      setLocationSuggestions(list.slice(0, 5));
    } catch (e) {
      // If suggestions fail, allow typing only
      setLocationSuggestions([]);
      setLocationError('Could not load suggestions. You may type the name instead.');
    } finally {
      setLocationLoading(false);
    }
  }, []);

  const handleLocationQueryChange = (text) => {
    setLocationQuery(text);
    // If user edits after picking, clear the confirmed selection
    if (plannedLocation && text !== plannedLocation.name) {
      setPlannedLocation(null);
    }
    setLocationError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(text);
    }, 400);
  };

  const pickSuggestion = (item) => {
    const loc = {
      name: item.name || item.displayName || locationQuery,
      latitude: item.latitude || item.lat,
      longitude: item.longitude || item.lon || item.lng,
    };
    setPlannedLocation(loc);
    setLocationQuery(loc.name);
    setLocationSuggestions([]);
    setLocationError('');
  };

  // ── Person count change — resize the names array ──────────────────────────
  const handlePersonCountChange = (val) => {
    // Allow only digits 1-10
    const cleaned = val.replace(/[^0-9]/g, '');
    setPlannedPersonCount(cleaned);
    const n = parseInt(cleaned, 10);
    if (!isNaN(n) && n >= 1 && n <= 10) {
      setPlannedNames((prev) => {
        const next = [...prev];
        while (next.length < n) next.push('');
        return next.slice(0, n);
      });
    } else {
      setPlannedNames([]);
    }
  };

  const setName = (idx, val) => {
    setPlannedNames((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

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
      const capturedUri = r.assets[0].uri;
      setCheckingPhoto(true);
      setSpeedometerCheckError('');
      try {
        const checkRes = await checkHasNumbers(capturedUri);
        if (checkRes.ok) {
          setPhoto(capturedUri);
          setError('');
          setSpeedometerCheckError('');
          setSpeedometerFailedTries(0);
          setLastSpeedometerPhoto(null);
          setSpeedometerSkippedReason(checkRes.skipped ? (checkRes.reason || 'error') : null);
        } else {
          setPhoto(null);
          setSpeedometerSkippedReason(null);
          const nextTries = speedometerFailedTries + 1;
          setSpeedometerFailedTries(nextTries);
          setLastSpeedometerPhoto(capturedUri);
          setSpeedometerCheckError('No numbers found in the photo. Take a clear photo showing the speedometer numbers.');
        }
      } catch (err) {
        // Technical failure must never block
        setPhoto(capturedUri);
        setError('');
        setSpeedometerCheckError('');
        setSpeedometerFailedTries(0);
        setLastSpeedometerPhoto(null);
        let reason = 'error';
        if (err && typeof err.name === 'string' && err.name && err.name !== 'Error' && /^[A-Za-z0-9_]+$/.test(err.name)) {
          reason = err.name;
        }
        setSpeedometerSkippedReason(reason);
      } finally {
        setCheckingPhoto(false);
      }
    }
  };

  const useAnyway = () => {
    if (lastSpeedometerPhoto) {
      setPhoto(lastSpeedometerPhoto);
      setError('');
      setSpeedometerCheckError('');
      setSpeedometerFailedTries(0);
      setLastSpeedometerPhoto(null);
      setSpeedometerSkippedReason(null);
    }
  };

  const start = async () => {
    console.log('[StartRecovery] START_BUTTON_PRESSED', { transportMode, needsVehicle, hasPhoto: !!photo });

    setError('');
    if (!transportMode) {
      setError('Please select a transport mode.');
      return;
    }
    if (!plannedLocation) {
      setError('Please select a location to visit from the suggestions.');
      return;
    }
    if (!validPersonCount) {
      setError('Please enter the number of persons to visit (1–10).');
      return;
    }
    for (let i = 0; i < personCount; i++) {
      if (!(plannedNames[i] || '').trim()) {
        setError(`Please enter the name for Person ${i + 1}.`);
        return;
      }
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

    // ── Declared outside try so catch/offline-fallback can always access it ──
    let initialLocation = null;

    const trimmedNames = plannedNames.slice(0, personCount).map((n) => n.trim());

    try {
      // ── Step 1: Location permission ────────────────────────────────────────
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        console.log('[StartRecovery] START_FAILED reason=location_permission_denied');
        setError('Location permission is required to track the recovery route. Please enable it in device settings.');
        setLoading(false);
        return;
      }
      console.log('[StartRecovery] LOCATION_PERMISSION_GRANTED');

      // ── Step 2: GPS acquisition: wait up to 15 s for accuracy <= 20 m (BestForNavigation) ──
      console.log('[StartRecovery] GPS_ACQUISITION_STARTED');

      let pos;
      try {
        pos = await getAccurateLocation({ timeoutMs: 15000, targetAccuracy: 20 });
      } catch (gpsErr) {
        if (gpsErr.message === 'GPS_TIMEOUT') {
          console.log('[StartRecovery] START_FAILED reason=gps_timeout');
          setError('GPS signal could not be obtained within 15 seconds. Move to an open area and try again.');
        } else {
          console.log('[StartRecovery] START_FAILED reason=gps_error message=' + gpsErr.message);
          setError('Could not obtain your current location. Please check GPS settings and try again.');
        }
        setLoading(false);
        return;
      }

      initialLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
        startLatitude: pos.coords.latitude,
        startLongitude: pos.coords.longitude,
        startAccuracy: pos.coords.accuracy || 0,
      };
      console.log('[StartRecovery] GPS_ACQUISITION_SUCCESS', {
        lat: initialLocation.latitude.toFixed(5),
        lng: initialLocation.longitude.toFixed(5),
        accuracy: initialLocation.accuracy,
      });

      // ── Step 3: API call ───────────────────────────────────────────────────
      console.log('[StartRecovery] API_REQUEST_STARTED', { vehicleType: transportMode, deviceSessionId });

      // Extra fields to include in the start call
      const extraFields = {
        plannedLocation: JSON.stringify(plannedLocation),
        plannedPersonCount: String(personCount),
        plannedNames: JSON.stringify(trimmedNames),
        customerId: route?.params?.customerId || route?.params?.customer?.customerId || '',
        customerRefId: route?.params?.customer?.customerId || route?.params?.customerId || '',
        customerName: route?.params?.customer?.customerName || route?.params?.customer?.name || '',
      };

      let data;
      if (!needsPhoto) {
        // WALK / OTHER: plain JSON start
        data = await apiPost('/recovery/start-with-photo', {
          vehicleType: transportMode,
          vehicleNumber: '',
          initialLocation,
          deviceSessionId,
          plannedLocation,
          plannedPersonCount: personCount,
          plannedNames: trimmedNames,
          customerId: route?.params?.customerId || route?.params?.customer?.customerId || '',
          customerRefId: route?.params?.customer?.customerId || route?.params?.customerId || '',
          customerName: route?.params?.customer?.customerName || route?.params?.customer?.name || '',
        });
      } else {
        // BIKE / CAR: multipart with starting speedometer photo
        data = await apiUploadFile(
          '/recovery/start-with-photo',
          {
            vehicleType: transportMode,
            vehicleNumber: vehicleNumber.trim().toUpperCase(),
            initialLocation: JSON.stringify(initialLocation),
            deviceSessionId,
            ...extraFields,
          },
          'startPhoto',
          photo
        );
      }

      console.log('[StartRecovery] API_REQUEST_SUCCESS', { sessionId: data?.session?.sessionId });

      const createdSession = (data && data.session) ? {
        ...data.session,
        startLocation: data.session.startLocation || initialLocation,
        startLatitude: initialLocation.latitude,
        startLongitude: initialLocation.longitude,
        startAccuracy: initialLocation.accuracy,
      } : {
        sessionId: deviceSessionId,
        deviceSessionId,
        vehicleType: transportMode,
        vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
        startLocation: initialLocation,
        startLatitude: initialLocation.latitude,
        startLongitude: initialLocation.longitude,
        startAccuracy: initialLocation.accuracy,
        startTime: new Date().toISOString(),
        plannedLocation,
        plannedPersonCount: personCount,
        plannedNames: trimmedNames,
      };

      console.log('[StartRecovery] NAVIGATING_TO_ACTIVE_RECOVERY', { sessionId: createdSession.sessionId });
      navigation.replace('ActiveRecovery', {
        session: createdSession,
        transportMode,
        vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
        startPhotoUri: photo || createdSession.startPhotoUri || null,
        plannedLocation,
        plannedPersonCount: personCount,
        plannedNames: trimmedNames,
        customer: route?.params?.customer,
        customerId: route?.params?.customerId || route?.params?.customer?.customerId,
      });

    } catch (e) {
      // ── 409: existing active session — offer Resume ────────────────────────
      if (e.status === 409 && e.data && e.data.session) {
        console.log('[StartRecovery] START_FAILED reason=active_session_exists sessionId=' + e.data.session.sessionId);
        setLoading(false);
        Alert.alert(
          'Recovery Already Active',
          'You already have an active recovery session in progress.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Resume',
              onPress: () => {
                console.log('[StartRecovery] NAVIGATING_TO_ACTIVE_RECOVERY reason=resume', { sessionId: e.data.session.sessionId });
                navigation.replace('ActiveRecovery', {
                  session: e.data.session,
                  transportMode: e.data.session.vehicleType || transportMode,
                  vehicleNumber: e.data.session.vehicleNumber || '',
                  startPhotoUri: photo || null,
                  plannedLocation: e.data.session.plannedLocation || plannedLocation,
                  plannedPersonCount: e.data.session.plannedPersonCount || personCount,
                  plannedNames: e.data.session.plannedNames || trimmedNames,
                });
              },
            },
          ]
        );
        return;
      }

      // ── 4xx client / validation error — show message, do NOT go offline ───
      if (e.status && e.status >= 400 && e.status < 500) {
        console.log('[StartRecovery] START_FAILED reason=client_error status=' + e.status + ' message=' + e.message);
        setError(e.message || 'Request was rejected by the server. Please check your details.');
        setLoading(false);
        return;
      }

      // ── Network / server error — offline fallback ──────────────────────────
      if (e.isNetworkError || e.message === 'Network request failed' || (e.status && e.status >= 500)) {
        console.log('[StartRecovery] OFFLINE_FALLBACK', {
          reason: e.message,
          status: e.status || 'no_status',
          hasLocation: !!initialLocation,
        });

        const offlineSession = {
          sessionId: deviceSessionId,
          deviceSessionId,
          vehicleType: transportMode,
          vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
          startTime: new Date().toISOString(),
          // initialLocation is always available here because GPS succeeded before the API call.
          // If GPS failed we would have returned early above, never reaching this catch block.
          startLocation: initialLocation,
          startPhotoUri: photo || null,
          plannedLocation,
          plannedPersonCount: personCount,
          plannedNames: trimmedNames,
          _syncStatus: 'PENDING',
        };

        console.log('[StartRecovery] NAVIGATING_TO_ACTIVE_RECOVERY reason=offline_fallback', { sessionId: deviceSessionId });
        navigation.replace('ActiveRecovery', {
          session: offlineSession,
          transportMode,
          vehicleNumber: needsVehicle ? vehicleNumber.trim().toUpperCase() : '',
          startPhotoUri: photo || null,
          plannedLocation,
          plannedPersonCount: personCount,
          plannedNames: trimmedNames,
        });
        return;
      }

      // ── Unexpected error ───────────────────────────────────────────────────
      console.log('[StartRecovery] START_FAILED reason=unexpected message=' + e.message);
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
                    setSpeedometerSkippedReason(null);
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

        {/* ── STEP 2: LOCATION TO VISIT ────────────────────────────────── */}
        <Text style={styles.sectionLabel}>2. Location you want to visit *</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="location-outline" size={20} color="#64748B" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Search for a location..."
            placeholderTextColor="#94A3B8"
            autoCorrect={false}
            value={locationQuery}
            onChangeText={handleLocationQueryChange}
          />
          {locationLoading ? (
            <ActivityIndicator size="small" color="#2563EB" style={{ marginLeft: 6 }} />
          ) : null}
          {plannedLocation ? (
            <Ionicons name="checkmark-circle" size={20} color="#059669" style={{ marginLeft: 6 }} />
          ) : null}
        </View>
        {locationError ? (
          <Text style={styles.locationErrorText}>{locationError}</Text>
        ) : null}
        {locationSuggestions.length > 0 ? (
          <View style={styles.suggestionsBox}>
            {locationSuggestions.map((item, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.suggestionItem,
                  idx < locationSuggestions.length - 1 && styles.suggestionItemBorder,
                ]}
                onPress={() => pickSuggestion(item)}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={14} color="#64748B" style={{ marginRight: 8 }} />
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {item.name || item.displayName || ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* ── STEP 3: NUMBER OF PERSONS ─────────────────────────────────── */}
        <Text style={styles.sectionLabel}>3. Number of persons you want to visit *</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="people-outline" size={20} color="#64748B" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter a number (1–10)"
            placeholderTextColor="#94A3B8"
            keyboardType="numeric"
            maxLength={2}
            value={plannedPersonCount}
            onChangeText={handlePersonCountChange}
          />
        </View>

        {/* ── PERSON NAME BOXES ─────────────────────────────────────────── */}
        {validPersonCount
          ? Array.from({ length: personCount }).map((_, i) => (
            <View key={i} style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={20} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder={`Person ${i + 1} name`}
                placeholderTextColor="#94A3B8"
                autoCorrect={false}
                value={plannedNames[i] || ''}
                onChangeText={(val) => setName(i, val)}
              />
            </View>
          ))
          : null}

        {/* ── STEP 4: VEHICLE NUMBER (BIKE/CAR only) ──────────────────── */}
        {needsVehicle ? (
          <>
            <Text style={styles.sectionLabel}>4. Vehicle Registration Number</Text>
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

            <Text style={styles.sectionLabel}>5. Starting Speedometer Evidence</Text>
            <Text style={styles.helperText}>
              Camera only — capture the speedometer reading before you begin.
            </Text>

            {checkingPhoto ? (
              <View style={styles.checkingBox}>
                <ActivityIndicator size="small" color="#2563EB" />
                <Text style={styles.checkingText}>Checking photo...</Text>
              </View>
            ) : photo ? (
              <View style={styles.previewBox}>
                <Image source={{ uri: photo }} style={styles.previewImage} resizeMode="cover" />
                {speedometerSkippedReason ? (
                  <Text style={styles.speedometerSkippedText}>
                    Number check could not run ({speedometerSkippedReason}). Photo accepted.
                  </Text>
                ) : null}
                <TouchableOpacity style={styles.retakeBtn} onPress={takeSpeedometer}>
                  <Ionicons name="camera-reverse-outline" size={16} color="#2563EB" style={{ marginRight: 6 }} />
                  <Text style={styles.retakeBtnText}>Retake Photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {speedometerCheckError ? (
                  <View style={styles.speedometerErrorBox}>
                    <Ionicons name="alert-circle-outline" size={18} color="#DC2626" style={{ marginRight: 8, marginTop: 1 }} />
                    <Text style={styles.speedometerErrorText}>{speedometerCheckError}</Text>
                  </View>
                ) : null}

                {speedometerFailedTries >= 3 && lastSpeedometerPhoto ? (
                  <TouchableOpacity style={styles.useAnywayBtn} onPress={useAnyway} activeOpacity={0.85}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#15803D" style={{ marginRight: 6 }} />
                    <Text style={styles.useAnywayBtnText}>Use this photo anyway</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity style={styles.cameraBtn} onPress={takeSpeedometer} activeOpacity={0.85}>
                  <View style={styles.cameraIconBg}>
                    <Ionicons name="camera" size={32} color="#2563EB" />
                  </View>
                  <Text style={styles.cameraBtnTitle}>Capture Speedometer Photo</Text>
                  <Text style={styles.cameraBtnSub}>Camera only · Gallery upload not allowed</Text>
                </TouchableOpacity>
              </View>
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
                <Text style={styles.startBtnText}>START RECOVERY</Text>
              </View>
            )}
          </TouchableOpacity>

          {transportMode && !canStart ? (
            <Text style={styles.validationHint}>
              {!plannedLocation
                ? 'Pick a location suggestion to proceed'
                : !validPersonCount
                ? 'Enter the number of persons (1–10)'
                : needsVehicle
                ? 'Enter vehicle number and take starting speedometer photo to proceed'
                : 'Fill all required fields to proceed'}
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
    paddingHorizontal: 14, height: 52, marginBottom: 10,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontWeight: '500', color: '#0F172A' },

  locationErrorText: { fontSize: 12, color: '#D97706', marginBottom: 8, fontWeight: '500' },

  suggestionsBox: {
    backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1.5,
    borderColor: '#E2E8F0', marginBottom: 10, overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  suggestionItemBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  suggestionText: { fontSize: 13, color: '#0F172A', fontWeight: '500', flex: 1 },

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
  speedometerSkippedText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 12, paddingVertical: 7, paddingHorizontal: 14,
    backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  retakeBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  checkingBox: {
    backgroundColor: '#EFF6FF', borderRadius: 14, padding: 24,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
    borderColor: '#BFDBFE', marginBottom: 16, flexDirection: 'row',
  },
  checkingText: { fontSize: 14, fontWeight: '600', color: '#2563EB', marginLeft: 8 },
  speedometerErrorBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10,
    marginBottom: 12, borderWidth: 1, borderColor: '#FCA5A5',
  },
  speedometerErrorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', flex: 1, lineHeight: 18 },
  useAnywayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F0FDF4', borderWidth: 1.5, borderColor: '#86EFAC',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 12,
  },
  useAnywayBtnText: { color: '#15803D', fontSize: 14, fontWeight: '700' },

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
