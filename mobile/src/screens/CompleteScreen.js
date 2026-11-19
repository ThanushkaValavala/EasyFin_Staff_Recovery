import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { apiUploadFile, apiPost, apiUploadFiles, apiGet } from '../api';
import { formatDistance, formatDuration } from '../utils/geo';
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

async function getReadableAddress(p) {
  if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return '';
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5000)
    );
    const geocodePromise = Location.reverseGeocodeAsync({
      latitude: p.latitude,
      longitude: p.longitude,
    });
    const r = await Promise.race([geocodePromise, timeoutPromise]);
    if (r && r[0]) {
      const a = r[0];
      const cityOrSub = a.subregion || a.city || '';
      const parts = [a.name, a.street, cityOrSub].filter(Boolean);
      const uniqueParts = parts.filter((part, idx) => parts.indexOf(part) === idx);
      return uniqueParts.join(', ') || '';
    }
  } catch (e) {}
  return '';
}

/** Format seconds as mm:ss */
function fmtRecordTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MAX_RECORD_SECONDS = 180; // 3 minutes

/**
 * VoiceRecorder component
 * States: idle → recording → recorded → (can re-record or play)
 * Props:
 *   onRecorded(uri, durationSeconds) — called when a recording is finalized
 *   onCleared() — called when recording is cleared
 */
function VoiceRecorder({ onRecorded, onCleared }) {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recorderState, setRecorderState] = useState('idle'); // idle | recording | recorded
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [permDenied, setPermDenied] = useState(false);
  const [playerState, setPlayerState] = useState('stopped'); // stopped | playing
  const timerRef = useRef(null);
  const playerRef = useRef(null); // expo-audio Sound ref

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (playerRef.current) {
        playerRef.current.remove().catch(() => {});
      }
    };
  }, []);

  const startRecording = async () => {
    // Request permission only on tap Record
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      setPermDenied(true);
      return;
    }
    setPermDenied(false);
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecorderState('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORD_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      Alert.alert('Recording Error', err.message || 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      const uri = await audioRecorder.stop();
      const dur = elapsed;
      setRecordedUri(uri);
      setRecordedDuration(dur);
      setRecorderState('recorded');
      onRecorded && onRecorded(uri, dur);
    } catch (err) {
      Alert.alert('Recording Error', err.message || 'Could not stop recording.');
      setRecorderState('idle');
    }
  };

  const reRecord = async () => {
    // Clear previous
    setRecordedUri(null);
    setRecordedDuration(0);
    setElapsed(0);
    setRecorderState('idle');
    setPlayerState('stopped');
    if (playerRef.current) {
      await playerRef.current.remove().catch(() => {});
      playerRef.current = null;
    }
    onCleared && onCleared();
  };

  const playRecording = async () => {
    if (!recordedUri) return;
    if (playerState === 'playing') {
      // stop playback
      if (playerRef.current) {
        await playerRef.current.pauseAsync().catch(() => {});
      }
      setPlayerState('stopped');
      return;
    }
    try {
      const { AudioPlayer } = await import('expo-audio');
      if (playerRef.current) {
        await playerRef.current.remove().catch(() => {});
      }
      const player = new AudioPlayer(recordedUri);
      playerRef.current = player;
      player.play();
      setPlayerState('playing');
      // Reset icon when done
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          setPlayerState('stopped');
        }
      });
    } catch (err) {
      Alert.alert('Playback Error', err.message || 'Could not play recording.');
    }
  };

  if (permDenied) {
    return (
      <View style={recStyles.permDeniedBox}>
        <Ionicons name="mic-off-outline" size={22} color="#DC2626" style={{ marginRight: 8 }} />
        <Text style={recStyles.permDeniedText}>Microphone permission denied. Use the text option below.</Text>
      </View>
    );
  }

  if (recorderState === 'idle') {
    return (
      <TouchableOpacity style={recStyles.recordBtn} onPress={startRecording} activeOpacity={0.85}>
        <Ionicons name="mic-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
        <Text style={recStyles.recordBtnText}>Record Voice Note</Text>
      </TouchableOpacity>
    );
  }

  if (recorderState === 'recording') {
    return (
      <View style={recStyles.recordingBox}>
        <View style={recStyles.recordingIndicator}>
          <View style={recStyles.recordingDot} />
          <Text style={recStyles.recordingLabel}>Recording</Text>
          <Text style={recStyles.recordingTimer}>{fmtRecordTime(elapsed)} / {fmtRecordTime(MAX_RECORD_SECONDS)}</Text>
        </View>
        <TouchableOpacity style={recStyles.stopBtn} onPress={stopRecording} activeOpacity={0.85}>
          <Ionicons name="stop-circle-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={recStyles.stopBtnText}>Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // recorded
  return (
    <View style={recStyles.recordedBox}>
      <Ionicons name="checkmark-circle" size={20} color="#059669" style={{ marginRight: 8 }} />
      <Text style={recStyles.recordedDur}>Voice note: {fmtRecordTime(recordedDuration)}</Text>
      <View style={recStyles.recordedActions}>
        <TouchableOpacity style={recStyles.playBtn} onPress={playRecording} activeOpacity={0.8}>
          <Ionicons name={playerState === 'playing' ? 'pause-outline' : 'play-outline'} size={18} color="#2563EB" />
          <Text style={recStyles.playBtnText}>{playerState === 'playing' ? 'Pause' : 'Play'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={recStyles.reRecordBtn} onPress={reRecord} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={16} color="#64748B" />
          <Text style={recStyles.reRecordBtnText}>Re-record</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const recStyles = StyleSheet.create({
  recordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#DC2626', borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 20,
  },
  recordBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  recordingBox: {
    backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  recordingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626', marginRight: 8,
  },
  recordingLabel: { fontSize: 13, fontWeight: '700', color: '#DC2626', flex: 1 },
  recordingTimer: { fontSize: 13, fontWeight: '700', color: '#7F1D1D' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7F1D1D', borderRadius: 10, paddingVertical: 10,
  },
  stopBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  recordedBox: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#BBF7D0', gap: 8,
  },
  recordedDur: { fontSize: 13, fontWeight: '600', color: '#15803D', flex: 1 },
  recordedActions: { flexDirection: 'row', gap: 10 },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#EFF6FF',
    borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  playBtnText: { fontSize: 12, color: '#2563EB', fontWeight: '700' },
  reRecordBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#F8FAFC',
    borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0',
  },
  reRecordBtnText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  permDeniedBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2',
    borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FCA5A5',
  },
  permDeniedText: { fontSize: 13, color: '#DC2626', fontWeight: '500', flex: 1 },
});

// ─────────────────────────────────────────────────────────────────────────────

export default function CompleteScreen({ route, navigation }) {
  const {
    session,
    distanceMeters: dist,
    durationSeconds,
    movingSeconds,
    idleSeconds,
    unknownSeconds,
    startLocation,
    endLocation,
    transportMode,
    vehicleNumber,
    startPhotoUri,
    allPoints,
    plannedNames: routePlannedNames,
  } = route.params || {};

  const sessionId = (session && (session.sessionId || session._id)) || `SESS-${Date.now()}`;
  const rawMode = (transportMode || session?.vehicleType || 'WALK').toUpperCase();

  // WALK and OTHER do not require ending photo; BIKE and CAR require it
  const needsEndPhoto = rawMode === 'BIKE' || rawMode === 'CAR';

  // Pre-fill names from plannedNames (up to 5 editable slots, max 5)
  const initialNames = (() => {
    const src = routePlannedNames || session?.plannedNames || [];
    return src.slice(0, 5).map((n) => n || '');
  })();

  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [startText, setStartText] = useState('Locating...');
  const [endText, setEndText] = useState('Locating...');
  const startAddressRef = useRef('');
  const endAddressRef = useRef('');
  const done = useRef(false);
  const scrollViewRef = useRef(null);

  // ── Customer visited / not visited ────────────────────────────────────────
  const [customerMet, setCustomerMet] = useState(null); // null | true | false

  // ── Visited: editable names ───────────────────────────────────────────────
  const [visitedNames, setVisitedNames] = useState(initialNames);

  // ── Visited: voice note ───────────────────────────────────────────────────
  const [voiceUri, setVoiceUri] = useState(null);
  const [voiceDuration, setVoiceDuration] = useState(0);

  // ── Not visited: voice note OR typed reason ───────────────────────────────
  const [notMetVoiceUri, setNotMetVoiceUri] = useState(null);
  const [notMetVoiceDuration, setNotMetVoiceDuration] = useState(0);
  const [showTypedReason, setShowTypedReason] = useState(false);
  const [notMetReason, setNotMetReason] = useState('');
  const [metAt, setMetAt] = useState('');

  useEffect(() => {
    describe(startLocation).then(setStartText);
    describe(endLocation).then(setEndText);
    getReadableAddress(startLocation).then((addr) => {
      startAddressRef.current = addr || '';
    });
    getReadableAddress(endLocation).then((addr) => {
      endAddressRef.current = addr || '';
    });
  }, []);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (done.current) return;
        e.preventDefault();
        Alert.alert(
          'Complete Recovery Session',
          needsEndPhoto
            ? 'Please capture the ending speedometer photo and submit your visit outcome to finish.'
            : 'Please submit your visit outcome to finish this recovery.'
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

  // ── Visited name helpers ──────────────────────────────────────────────────
  const setVisitedName = (idx, val) => {
    setVisitedNames((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };
  const addAnotherName = () => {
    if (visitedNames.length < 5) setVisitedNames((prev) => [...prev, '']);
  };
  const removeVisitedName = (idx) => {
    setVisitedNames((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const canEndRecovery = (() => {
    if (submitting) return false;
    if (customerMet === null) return false;
    if (needsEndPhoto && !photo) return false;

    if (customerMet === true) {
      // At least one non-empty name required
      const filled = visitedNames.filter((n) => n.trim()).length;
      if (filled === 0) return false;
      return true;
    }

    if (customerMet === false) {
      // Voice note OR typed reason required
      if (notMetVoiceUri) return true;
      if (notMetReason.trim()) return true;
      return false;
    }

    return false;
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
    if (customerMet === null) {
      Alert.alert('Required', 'Please select Visited or Not visited.');
      return;
    }
    if (needsEndPhoto && !photo) {
      Alert.alert('Ending Photo Required', 'Please capture the ending speedometer image.');
      return;
    }
    if (customerMet === true) {
      const filled = visitedNames.filter((n) => n.trim()).length;
      if (filled === 0) {
        Alert.alert('Names Required', 'Please enter at least one name for Visited.');
        return;
      }
    }
    if (customerMet === false) {
      if (!notMetVoiceUri && !notMetReason.trim()) {
        Alert.alert('Required', 'Please record a voice note or type a reason.');
        return;
      }
    }

    setSubmitting(true);
    const end = endLocation || {};

    let sAddr = startAddressRef.current;
    if (!sAddr && startLocation) {
      try {
        sAddr = await getReadableAddress(startLocation);
        startAddressRef.current = sAddr || '';
      } catch (e) {}
    }
    let eAddr = endAddressRef.current;
    if (!eAddr && (endLocation || end)) {
      try {
        eAddr = await getReadableAddress(endLocation || end);
        endAddressRef.current = eAddr || '';
      } catch (e) {}
    }
    sAddr = sAddr || '';
    eAddr = eAddr || '';

    const customerNames = customerMet ? visitedNames.filter((n) => n.trim()).map((n) => n.trim()) : [];
    const activeVoiceUri = customerMet ? voiceUri : notMetVoiceUri;
    const activeVoiceDuration = customerMet ? voiceDuration : notMetVoiceDuration;

    // Build base remarks string for NLP (keep legacy field for backend compat)
    const remarksText = customerMet
      ? (customerNames.length > 0 ? `Visited: ${customerNames.join(', ')}` : 'Visited customer')
      : (notMetReason.trim() || 'Not visited customer');

    try {
      let nlpDetailsStr = '';
      try {
        // nlpDetails summarization — graceful no-op if summarize is unavailable
        nlpDetailsStr = '';
      } catch (_e) {}

      if (!needsEndPhoto && !activeVoiceUri) {
        // WALK / OTHER without voice: JSON finish endpoint
        await apiPost(`/recovery/sessions/${sessionId}/finish-walk`, {
          remarks: remarksText,
          customerMet,
          customerNames,
          metAt: metAt.trim() || null,
          notMetReason: customerMet ? undefined : (notMetReason.trim() || null),
          distanceMeters: Math.round(dist || 0),
          durationSeconds: Math.round(durationSeconds || 0),
          movingSeconds: movingSeconds != null ? Math.round(movingSeconds) : null,
          idleSeconds: idleSeconds != null ? Math.round(idleSeconds) : null,
          unknownSeconds: unknownSeconds != null ? Math.round(unknownSeconds) : null,
          startAddress: sAddr,
          endAddress: eAddr,
          endLocation: {
            latitude: end.latitude || 0,
            longitude: end.longitude || 0,
            accuracy: end.accuracy || 0,
          },
          nlpDetails: nlpDetailsStr,
        });
      } else {
        // Multipart: photo and/or voice
        const fields = {
          remarks: remarksText,
          customerMet: String(customerMet),
          customerNames: JSON.stringify(customerNames),
          metAt: metAt.trim() || '',
          notMetReason: customerMet ? '' : (notMetReason.trim() || ''),
          distanceMeters: String(Math.round(dist || 0)),
          durationSeconds: String(Math.round(durationSeconds || 0)),
          movingSeconds: movingSeconds != null ? String(Math.round(movingSeconds)) : '',
          idleSeconds: idleSeconds != null ? String(Math.round(idleSeconds)) : '',
          unknownSeconds: unknownSeconds != null ? String(Math.round(unknownSeconds)) : '',
          startAddress: sAddr,
          endAddress: eAddr,
          endLocation: JSON.stringify({
            latitude: end.latitude || 0,
            longitude: end.longitude || 0,
            accuracy: end.accuracy || 0,
          }),
          nlpDetails: nlpDetailsStr,
          voiceDurationSeconds: activeVoiceUri ? String(activeVoiceDuration) : '',
        };

        const filesMap = {};
        if (photo) filesMap.endPhoto = photo;
        if (activeVoiceUri) filesMap.voice = activeVoiceUri;

        const endpoint = needsEndPhoto
          ? `/recovery/sessions/${sessionId}/finish`
          : `/recovery/sessions/${sessionId}/finish-walk`;

        await apiUploadFiles(endpoint, fields, filesMap);
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
            movingSeconds: movingSeconds != null ? Math.round(movingSeconds) : null,
            idleSeconds: idleSeconds != null ? Math.round(idleSeconds) : null,
            unknownSeconds: unknownSeconds != null ? Math.round(unknownSeconds) : null,
            startAddress: sAddr,
            endAddress: eAddr,
            remarks: remarksText,
            rawRemarks: remarksText,
            nlpSummary: '',
            nlpCategory: '',
            nlpDetails: '',
            startLocation: startLocation || session?.startLocation || null,
            endLocation: end || null,
            startPhotoUri: startPhotoUri || session?.startPhotoUri || null,
            endPhotoUri: needsEndPhoto ? (photo || null) : null,
            voiceUri: activeVoiceUri || null,
            voiceDurationSeconds: activeVoiceUri ? activeVoiceDuration : null,
            customerMet,
            customerNames,
            metAt: metAt.trim() || null,
            notMetReason: customerMet ? null : (notMetReason.trim() || null),
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
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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

      {/* ── CUSTOMER VISITED / NOT VISITED ─────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Customer Visit Outcome *</Text>

        {/* Option buttons */}
        <View style={styles.metRow}>
          <TouchableOpacity
            style={[styles.metBtn, customerMet === true && styles.metBtnActive]}
            onPress={() => { setCustomerMet(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle-outline" size={18}
              color={customerMet === true ? '#059669' : '#64748B'} style={{ marginRight: 6 }} />
            <Text style={[styles.metBtnText, customerMet === true && { color: '#059669' }]}>
              Visited the customer
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.metBtn, customerMet === false && styles.metBtnNotActive]}
            onPress={() => { setCustomerMet(false); }}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle-outline" size={18}
              color={customerMet === false ? '#DC2626' : '#64748B'} style={{ marginRight: 6 }} />
            <Text style={[styles.metBtnText, customerMet === false && { color: '#DC2626' }]}>
              Not visited the customer
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── VISITED: Names + voice ──────────────────────────────────────── */}
        {customerMet === true ? (
          <View style={styles.outcomeSub}>
            <Text style={styles.subLabel}>Names of persons visited *</Text>
            {visitedNames.map((name, idx) => (
              <View key={idx} style={styles.nameRow}>
                <TextInput
                  style={styles.nameInput}
                  placeholder={`Person ${idx + 1} name`}
                  placeholderTextColor="#94A3B8"
                  value={name}
                  onChangeText={(v) => setVisitedName(idx, v)}
                  autoCorrect={false}
                />
                {visitedNames.length > 1 ? (
                  <TouchableOpacity onPress={() => removeVisitedName(idx)} style={styles.removeNameBtn}>
                    <Ionicons name="close-circle" size={20} color="#94A3B8" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {visitedNames.length < 5 ? (
              <TouchableOpacity style={styles.addNameBtn} onPress={addAnotherName} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={16} color="#2563EB" style={{ marginRight: 6 }} />
                <Text style={styles.addNameBtnText}>+ Add another name</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={[styles.subLabel, { marginTop: 14 }]}>Voice note (optional)</Text>
            <VoiceRecorder
              onRecorded={(uri, dur) => { setVoiceUri(uri); setVoiceDuration(dur); }}
              onCleared={() => { setVoiceUri(null); setVoiceDuration(0); }}
            />
          </View>
        ) : null}

        {/* ── NOT VISITED: Voice or typed reason ─────────────────────────── */}
        {customerMet === false ? (
          <View style={styles.outcomeSub}>
            <Text style={styles.subLabel}>Reason for not visiting *</Text>
            {!showTypedReason ? (
              <>
                <VoiceRecorder
                  onRecorded={(uri, dur) => { setNotMetVoiceUri(uri); setNotMetVoiceDuration(dur); }}
                  onCleared={() => { setNotMetVoiceUri(null); setNotMetVoiceDuration(0); }}
                />
                <TouchableOpacity
                  style={styles.typeInsteadLink}
                  onPress={() => setShowTypedReason(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.typeInsteadText}>Type a reason instead</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.textArea}
                  placeholder="Enter reason for not visiting..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={4}
                  value={notMetReason}
                  onChangeText={setNotMetReason}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={styles.typeInsteadLink}
                  onPress={() => setShowTypedReason(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.typeInsteadText}>Record voice note instead</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
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
              <Text style={styles.completeBtnText}>END RECOVERY</Text>
            </View>
          )}
        </TouchableOpacity>

        {!canEndRecovery ? (
          <Text style={styles.validationNote}>
            {customerMet === null
              ? 'Select Visited or Not visited to proceed'
              : needsEndPhoto && !photo
              ? 'Capture ending speedometer photo to proceed'
              : customerMet === true && visitedNames.filter((n) => n.trim()).length === 0
              ? 'Enter at least one name to proceed'
              : customerMet === false && !notMetVoiceUri && !notMetReason.trim()
              ? 'Record a voice note or type a reason to proceed'
              : ''}
          </Text>
        ) : null}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: '#F8FAFC' },
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

  // Customer visited buttons
  metRow: { gap: 10, marginBottom: 14 },
  metBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  metBtnActive: { borderColor: '#059669', backgroundColor: '#F0FDF4' },
  metBtnNotActive: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  metBtnText: { fontSize: 14, fontWeight: '600', color: '#64748B' },

  outcomeSub: {
    backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  subLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  nameInput: {
    flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0F172A', fontWeight: '500',
  },
  removeNameBtn: { marginLeft: 8, padding: 4 },
  addNameBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, marginBottom: 4,
  },
  addNameBtnText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },

  typeInsteadLink: { marginTop: 10, alignSelf: 'center', paddingVertical: 4 },
  typeInsteadText: { fontSize: 13, color: '#2563EB', fontWeight: '600', textDecorationLine: 'underline' },

  textArea: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0',
    borderRadius: 12, padding: 14, fontSize: 14, color: '#0F172A',
    minHeight: 100, fontWeight: '500',
  },

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
