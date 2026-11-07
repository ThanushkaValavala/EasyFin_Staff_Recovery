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

// Match the same classifier as api.js
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
  if (!p) return 'Not available';
  const coords = p.latitude.toFixed(5) + ', ' + p.longitude.toFixed(5);
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
    if (r && r[0]) {
      const a = r[0];
      const line = [a.name, a.street, a.city].filter(Boolean).join(', ');
      if (line) return line + ' (' + coords + ')';
    }
  } catch (e) {}
  return coords;
}

export default function CompleteScreen({ route, navigation }) {
  const {
    session, cases, customer,
    distanceMeters: dist, durationSeconds,
    startLocation, endLocation,
    transportMode,
  } = route.params;

  const sessionId = session.sessionId || session._id;
  const isWalk = (transportMode || session.vehicleType || '').toUpperCase() === 'WALK';
  const names = cases && cases.length
    ? cases.map((c) => (c.customer && c.customer.name) || 'Customer')
    : [customer && customer.name].filter(Boolean);

  const [photo, setPhoto] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startText, setStartText] = useState('Finding address...');
  const [endText, setEndText] = useState('Finding address...');
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
          'Almost done',
          isWalk
            ? 'Enter remarks and submit to finish this recovery.'
            : 'Add remarks and the ending speedometer photo, then submit to finish.'
        );
      }),
    [navigation]
  );

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Please allow camera access to take the speedometer photo.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.5,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) setPhoto(r.assets[0].uri);
  };

  // Validation
  const canSubmit = (() => {
    if (!notes.trim()) return false;
    if (!isWalk && !photo) return false;
    if (submitting) return false;
    return true;
  })();

  const finished = () => {
    done.current = true;
    Alert.alert('Recovery Submitted', 'Recovery session saved successfully.', [
      {
        text: 'OK',
        onPress: () =>
          navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }),
      },
    ]);
  };

  const submit = async () => {
    if (!notes.trim()) {
      Alert.alert('Remarks required', 'Please enter remarks.');
      return;
    }
    if (!isWalk && !photo) {
      Alert.alert('Photo required', 'Please take the ending speedometer photo.');
      return;
    }

    setSubmitting(true);
    const end = endLocation || {};

    try {
      if (isWalk) {
        // Walk: JSON submit (no photo)
        await apiPost('/recovery/sessions/' + sessionId + '/finish-walk', {
          remarks: notes.trim(),
          distanceMeters: Math.round(dist || 0),
          durationSeconds: Math.round(durationSeconds || 0),
          endLocation: { latitude: end.latitude, longitude: end.longitude, accuracy: end.accuracy || 0 },
        });
      } else {
        await apiUploadFile(
          '/recovery/sessions/' + sessionId + '/finish',
          {
            remarks: notes.trim(),
            distanceMeters: Math.round(dist || 0),
            durationSeconds: Math.round(durationSeconds || 0),
            endLocation: JSON.stringify({
              latitude: end.latitude,
              longitude: end.longitude,
              accuracy: end.accuracy || 0,
            }),
          },
          'endPhoto',
          photo
        );
      }
      finished();
    } catch (e) {
      if (e.status === 409) {
        finished();
        return;
      }

      // Backend unreachable — save locally
      if (isNetworkError(e)) {
        try {
          const { nlpSummary, nlpCategory } = summarize(notes.trim());
          await savePendingSession({
            deviceSessionId: sessionId,
            sessionId,
            assignmentId: session.assignmentId,
            customerId: session.customerId,
            loanId: session.loanId,
            startTime: session.startTime || session.startedAt,
            endTime: new Date().toISOString(),
            status: 'COMPLETED',
            outcome: 'FOLLOW_UP_REQUIRED',
            vehicleType: transportMode || session.vehicleType || '',
            vehicleNumber: session.vehicleNumber || '',
            durationSeconds: Math.round(durationSeconds || 0),
            distanceMeters: Math.round(dist || 0),
            remarks: notes.trim(),
            rawRemarks: notes.trim(),
            nlpSummary,
            nlpCategory,
            startLocation: startLocation || null,
            endLocation: end || null,
            area: session.area || '',
            // ── Photo references preserved for sync upload ──
            // isWalk sessions have no photos — endPhotoUri will be null
            endPhotoUri: isWalk ? null : (photo || null),
            _syncStatus: 'PENDING',
          });
          Alert.alert(
            'Saved Offline',
            'Recovery saved locally. It will sync to the server when connectivity is restored.',
            [{ text: 'OK', onPress: () => {
              done.current = true;
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
            }}]
          );
        } catch (saveErr) {
          Alert.alert('Save failed', 'Could not save the recovery. Please try again.');
        }
        return;
      }

      Alert.alert(
        'Could not submit',
        e.message === 'Network request failed'
          ? 'Cannot reach the server. Check your internet and try again.'
          : e.message
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Stop Recovery</Text>

      <View style={styles.card}>
        <Row k="Customers" v={names.length ? names.join(', ') : '-'} />
        <Row k="Mode" v={(transportMode || session.vehicleType || '-').charAt(0).toUpperCase() + (transportMode || session.vehicleType || '-').slice(1).toLowerCase()} />
        {!isWalk && session.vehicleNumber ? <Row k="Vehicle" v={session.vehicleNumber} /> : null}
        <Row k="Total time" v={formatDuration(durationSeconds)} />
        <Row k="Distance" v={formatDistance(dist)} />
        <Row k="Start" v={startText} />
        <Row k="End" v={endText} />
      </View>

      {/* Remarks */}
      <Text style={styles.label}>
        {isWalk ? '1.' : '1.'} Remarks (required)
      </Text>
      <TextInput
        style={[styles.input, { height: 110, textAlignVertical: 'top' }]}
        multiline
        value={notes}
        onChangeText={setNotes}
        placeholder="Write remarks about this recovery visit"
        placeholderTextColor="#94A3B8"
      />

      {/* Speedometer photo — only for Bike/Car */}
      {!isWalk ? (
        <>
          <Text style={styles.label}>2. Ending Speedometer Photo (required)</Text>
          {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : null}
          <TouchableOpacity style={styles.camBtn} onPress={takePhoto}>
            <Ionicons name="camera-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.camText}>
              {photo ? 'Retake Speedometer Photo' : 'Take Speedometer Photo'}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submit, !canSubmit && styles.disabled]}
        onPress={submit}
        disabled={!canSubmit}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Stop and Submit Recovery</Text>
        )}
      </TouchableOpacity>

      {!canSubmit && !submitting ? (
        <Text style={styles.hint}>
          {!notes.trim()
            ? 'Enter remarks to submit.'
            : !isWalk && !photo
            ? 'Take the ending speedometer photo to submit.'
            : ''}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Row({ k, v }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  k: { color: '#666', width: 80, fontSize: 13 },
  v: { flex: 1, textAlign: 'right', fontWeight: '600', fontSize: 13 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 16, marginBottom: 8, color: '#0F172A' },
  photo: { width: '100%', height: 220, borderRadius: 10, marginBottom: 10 },
  camBtn: {
    backgroundColor: '#1a56db', padding: 14, borderRadius: 10,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  camText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: '#b45309', marginTop: 12, textAlign: 'center', fontSize: 13 },
  input: {
    borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, fontSize: 16,
  },
  submit: {
    backgroundColor: '#15803d', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
  },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
