import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Image, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { apiUploadFile, apiPost } from '../api';
import { formatDistance, formatDuration } from '../utils/geo';
import { summarize } from '../utils/nlpSummarizer';
import { savePendingSession } from '../utils/offlineStore';

function isNetworkError(e) {
  if (!e) return false;
  if (e.isNetworkError) return true;
  const msg = e.message || '';
  return (
    msg === 'Network request failed' ||
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    e.status === 503 ||
    e.status === 502 ||
    e.name === 'AbortError'
  );
}

async function describe(p) {
  if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return 'Location recorded';
  const coords = `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
    if (r && r[0]) {
      const a = r[0];
      const line = [a.name, a.street, a.city].filter(Boolean).join(', ');
      if (line) return `${line} (${coords})`;
    }
  } catch (e) {}
  return coords;
}

const REMARK_SUGGESTIONS = [
  'Customer was not available during the visit.',
  'I met the customer. Payment will be made next week.',
  'Customer paid the outstanding loan amount.',
  'Customer refused to make the payment.',
  'Customer requested additional time for payment.',
];

export default function CompleteScreen({ route, navigation }) {
  const {
    session,
    distanceMeters: dist,
    durationSeconds,
    startLocation,
    endLocation,
    transportMode,
    vehicleNumber,
    startPhotoUri,
    allPoints,
  } = route.params || {};

  const sessionId = (session && (session.sessionId || session._id)) || `SESS-${Date.now()}`;
  const rawMode = (transportMode || session?.vehicleType || 'WALK').toUpperCase();

  // WALK and OTHER do not require ending photo; BIKE and CAR require it
  const needsEndPhoto = rawMode === 'BIKE' || rawMode === 'CAR';

  const [photo, setPhoto] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startText, setStartText] = useState('Locating...');
  const [endText, setEndText] = useState('Locating...');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    describe(startLocation).then(setStartText);
    describe(endLocation).then(setEndText);
  }, []);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (done.current) return;
        e.preventDefault();
        Alert.alert(
          'Complete Recovery Session',
          needsEndPhoto
            ? 'Please capture the ending speedometer photo and enter customer remarks to finish.'
            : 'Please enter customer visit remarks to finish this recovery.'
        );
      }),
    [navigation, needsEndPhoto]
  );

  const takeEndingPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera Permission Required', 'Camera access is required to capture the ending speedometer image. Gallery uploads are not permitted.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
    });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) {
      setPhoto(r.assets[0].uri);
    }
  };

  // Validation:
  // ALL modes: Remarks mandatory
  // BIKE/CAR: Ending speedometer photo mandatory
  // WALK/OTHER: No photo needed
  const canEndRecovery = (() => {
    if (!remarks.trim()) return false;
    if (needsEndPhoto && !photo) return false;
    if (submitting) return false;
    return true;
  })();

  const handleFinishSuccess = () => {
    done.current = true;
    Alert.alert(
      'Recovery Completed',
      'The recovery session has been successfully saved to the server.',
      [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }) }]
    );
  };

  const completeRecovery = async () => {
    if (!remarks.trim()) {
      Alert.alert('Remarks Required', 'Please enter customer visit remarks before submitting.');
      return;
    }
    if (needsEndPhoto && !photo) {
      Alert.alert('Ending Photo Required', 'Please capture the ending speedometer image.');
      return;
    }

    setSubmitting(true);
    const end = endLocation || {};

    try {
      if (!needsEndPhoto) {
        // WALK / OTHER: JSON finish endpoint
        await apiPost(`/recovery/sessions/${sessionId}/finish-walk`, {
          remarks: remarks.trim(),
          distanceMeters: Math.round(dist || 0),
          durationSeconds: Math.round(durationSeconds || 0),
          endLocation: {
            latitude: end.latitude || 0,
            longitude: end.longitude || 0,
            accuracy: end.accuracy || 0,
          },
        });
      } else {
        // BIKE / CAR: multipart with ending speedometer
        await apiUploadFile(
          `/recovery/sessions/${sessionId}/finish`,
          {
            remarks: remarks.trim(),
            distanceMeters: String(Math.round(dist || 0)),
            durationSeconds: String(Math.round(durationSeconds || 0)),
            endLocation: JSON.stringify({
              latitude: end.latitude || 0,
              longitude: end.longitude || 0,
              accuracy: end.accuracy || 0,
            }),
          },
          'endPhoto',
          photo
        );
      }
      handleFinishSuccess();
    } catch (e) {
      if (e.status === 409) {
        // Already finished — treat as success (idempotent)
        handleFinishSuccess();
        return;
      }

      if (isNetworkError(e)) {
        // Save offline, sync later
        try {
          const { nlpSummary, nlpCategory } = summarize(remarks.trim());
          await savePendingSession({
            deviceSessionId: session?.deviceSessionId || sessionId,
            sessionId: session?.sessionId || sessionId,
            agentId: session?.agentId,
            staffId: session?.staffId,
            assignmentId: session?.assignmentId,
            customerId: session?.customerId,
            loanId: session?.loanId,
            startTime: session?.startTime || session?.startedAt || new Date().toISOString(),
            endTime: new Date().toISOString(),
            status: 'COMPLETED',
            transportMode: rawMode,
            vehicleType: rawMode,
            vehicleNumber: vehicleNumber || session?.vehicleNumber || '',
            durationSeconds: Math.round(durationSeconds || 0),
            distanceMeters: Math.round(dist || 0),
            remarks: remarks.trim(),
            rawRemarks: remarks.trim(),
            nlpSummary,
            nlpCategory,
            startLocation: startLocation || session?.startLocation || null,
            endLocation: end || null,
            startPhotoUri: startPhotoUri || session?.startPhotoUri || null,
            endPhotoUri: needsEndPhoto ? (photo || null) : null,
            points: allPoints || [],
            _syncStatus: 'PENDING',
          });

          done.current = true;
          Alert.alert(
            'Saved Offline',
            'Network is unavailable. Your recovery has been saved on this device and will automatically sync to the server when connection is restored.',
            [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }) }]
          );
        } catch (saveErr) {
          Alert.alert('Error', 'Could not save recovery locally: ' + (saveErr.message || 'Storage error'));
        }
      } else {
        Alert.alert('Submission Error', e.message || 'Could not complete the recovery. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const modeIcon = rawMode === 'BIKE' ? 'bicycle-outline' : rawMode === 'CAR' ? 'car-outline' : rawMode === 'OTHER' ? 'bus-outline' : 'walk-outline';
  const modeColor = rawMode === 'BIKE' || rawMode === 'CAR' ? '#7C3AED' : rawMode === 'OTHER' ? '#0284C7' : '#059669';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>Recovery Completion</Text>
        <Text style={styles.subtitle}>Review session summary and submit your visit outcome</Text>
      </View>

      {/* ── TRIP SUMMARY CARD ──────────────────────────────────────────── */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryCardHeader}>
          <Text style={styles.summaryCardTitle}>TRIP SUMMARY</Text>
          <View style={[styles.modePill, { backgroundColor: modeColor + '18', borderColor: modeColor + '55' }]}>
            <Ionicons name={modeIcon} size={13} color={modeColor} style={{ marginRight: 4 }} />
            <Text style={[styles.modePillText, { color: modeColor }]}>{rawMode}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricBox}>
            <Ionicons name="time-outline" size={20} color="#2563EB" />
            <Text style={styles.metricValue}>{formatDuration(durationSeconds)}</Text>
            <Text style={styles.metricLabel}>Duration</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricBox}>
            <Ionicons name="navigate-outline" size={20} color="#059669" />
            <Text style={styles.metricValue}>{formatDistance(dist)}</Text>
            <Text style={styles.metricLabel}>Distance</Text>
          </View>
          {vehicleNumber ? (
            <>
              <View style={styles.metricDivider} />
              <View style={styles.metricBox}>
                <Ionicons name="car-outline" size={20} color="#7C3AED" />
                <Text style={[styles.metricValue, { fontSize: 13 }]}>{vehicleNumber}</Text>
                <Text style={styles.metricLabel}>Vehicle</Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.locationRow}>
          <View style={[styles.locationDot, { backgroundColor: '#059669' }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locLabel}>Start Location</Text>
            <Text style={styles.locValue} numberOfLines={2}>{startText}</Text>
          </View>
        </View>
        <View style={styles.locationConnector} />
        <View style={styles.locationRow}>
          <View style={[styles.locationDot, { backgroundColor: '#DC2626' }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locLabel}>End Location</Text>
            <Text style={styles.locValue} numberOfLines={2}>{endText}</Text>
          </View>
        </View>
      </View>

      {/* ── ENDING SPEEDOMETER (BIKE/CAR ONLY) ────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {needsEndPhoto ? '1. Ending Speedometer Image *' : '1. Ending Speedometer Image'}
        </Text>
        {!needsEndPhoto ? (
          <View style={styles.naCard}>
            <Ionicons name="checkmark-circle" size={20} color="#059669" style={{ marginRight: 8 }} />
            <Text style={styles.naText}>
              Not required for {rawMode === 'WALK' ? 'Walking' : 'Other'} mode
            </Text>
          </View>
        ) : photo ? (
          <View style={styles.previewBox}>
            <Image source={{ uri: photo }} style={styles.previewImage} resizeMode="cover" />
            <TouchableOpacity style={styles.retakeBtn} onPress={takeEndingPhoto}>
              <Ionicons name="camera-reverse-outline" size={16} color="#2563EB" style={{ marginRight: 6 }} />
              <Text style={styles.retakeBtnText}>Retake Photo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.cameraBtn} onPress={takeEndingPhoto} activeOpacity={0.85}>
            <View style={styles.cameraIconBox}>
              <Ionicons name="camera" size={32} color="#2563EB" />
            </View>
            <Text style={styles.cameraBtnTitle}>Capture Ending Speedometer</Text>
            <Text style={styles.cameraBtnSub}>Camera only · One photo required</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── CUSTOMER VISIT REMARKS ─────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Customer Visit Remarks *</Text>
        <Text style={styles.helperText}>
          Describe what happened during this visit. This will be processed by NLP to generate a recovery category.
        </Text>

        {/* Suggestion chips */}
        <TouchableOpacity
          style={styles.suggestionToggle}
          onPress={() => setShowSuggestions(!showSuggestions)}
        >
          <Ionicons name="bulb-outline" size={14} color="#2563EB" style={{ marginRight: 5 }} />
          <Text style={styles.suggestionToggleText}>
            {showSuggestions ? 'Hide suggestions' : 'Show example remarks'}
          </Text>
        </TouchableOpacity>

        {showSuggestions ? (
          <View style={styles.suggestionsBox}>
            {REMARK_SUGGESTIONS.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={styles.suggestionChip}
                onPress={() => {
                  setRemarks(s);
                  setShowSuggestions(false);
                }}
              >
                <Text style={styles.suggestionChipText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TextInput
          style={styles.textArea}
          placeholder="Enter customer visit remarks here..."
          placeholderTextColor="#94A3B8"
          multiline
          numberOfLines={5}
          value={remarks}
          onChangeText={setRemarks}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{remarks.trim().length} characters</Text>
      </View>

      {/* ── END RECOVERY BUTTON ──────────────────────────────────────────── */}
      <View style={styles.actionSection}>
        <TouchableOpacity
          style={[styles.completeBtn, !canEndRecovery && styles.btnDisabled]}
          onPress={completeRecovery}
          disabled={!canEndRecovery || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.completeBtnContent}>
              <Ionicons name="checkmark-done-circle" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.completeBtnText}>COMPLETE RECOVERY</Text>
            </View>
          )}
        </TouchableOpacity>

        {!canEndRecovery ? (
          <Text style={styles.validationNote}>
            {needsEndPhoto && !photo
              ? 'Capture ending speedometer photo and enter remarks to proceed'
              : !remarks.trim()
              ? 'Enter customer visit remarks to proceed'
              : ''}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { marginBottom: 18 },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 4, fontWeight: '500' },

  summaryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  summaryCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
  },
  summaryCardTitle: {
    fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 1, textTransform: 'uppercase',
  },
  modePill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  modePillText: { fontSize: 11, fontWeight: '800' },
  metricsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 14 },
  metricBox: { flex: 1, alignItems: 'center', gap: 4 },
  metricDivider: { width: 1, height: 40, backgroundColor: '#E2E8F0' },
  metricValue: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  metricLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 14 },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  locationDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 10, flexShrink: 0 },
  locationConnector: { width: 1, height: 14, backgroundColor: '#CBD5E1', marginLeft: 4.5, marginBottom: 2 },
  locLabel: { fontSize: 10, color: '#64748B', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  locValue: { fontSize: 12, color: '#334155', fontWeight: '500', marginTop: 1 },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginBottom: 10 },
  helperText: { fontSize: 12, color: '#64748B', marginBottom: 10, fontWeight: '500', lineHeight: 17 },

  naCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0FDF4', padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  naText: { fontSize: 13, color: '#15803D', fontWeight: '600' },

  cameraBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 2, borderStyle: 'dashed',
    borderColor: '#93C5FD', borderRadius: 14, padding: 22,
    alignItems: 'center',
  },
  cameraIconBox: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#EFF6FF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  cameraBtnTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  cameraBtnSub: { fontSize: 11, color: '#64748B', marginTop: 3 },

  previewBox: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  previewImage: { width: '100%', height: 190, borderRadius: 10 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12,
    paddingVertical: 7, paddingHorizontal: 14,
    backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  retakeBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  suggestionToggle: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 8,
  },
  suggestionToggleText: { fontSize: 12, color: '#2563EB', fontWeight: '600' },
  suggestionsBox: { marginBottom: 10, gap: 6 },
  suggestionChip: {
    backgroundColor: '#F1F5F9', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  suggestionChipText: { fontSize: 12, color: '#334155', fontWeight: '500' },

  textArea: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0',
    borderRadius: 12, padding: 14, fontSize: 14, color: '#0F172A',
    minHeight: 110, fontWeight: '500',
  },
  charCount: { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4 },

  actionSection: { marginTop: 6, marginBottom: 20 },
  completeBtn: {
    backgroundColor: '#1D4ED8', height: 56, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#1D4ED8', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 5,
  },
  completeBtnContent: { flexDirection: 'row', alignItems: 'center' },
  completeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  validationNote: {
    fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 10,
    fontWeight: '500', lineHeight: 17,
  },
});
