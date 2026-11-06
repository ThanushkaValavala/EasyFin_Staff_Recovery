import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Image, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { apiPost, apiUpload } from '../api';
import { formatDistance, formatDuration } from '../utils/geo';

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
  const { session, customer, loan, distanceMeters: dist, durationSeconds, startLocation, endLocation } = route.params;
  const sessionId = session.sessionId || session._id;

  const [photo, setPhoto] = useState(null);
  const [paid, setPaid] = useState(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startText, setStartText] = useState('Finding address...');
  const [endText, setEndText] = useState('Finding address...');
  const uploaded = useRef(false);
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
        Alert.alert('Almost done', 'Add the proof photo and submit to finish this recovery.');
      }),
    [navigation]
  );

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Please allow camera access to take the proof photo.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) setPhoto(r.assets[0].uri);
  };

  const amountNum = Number(amount);
  const detailsOk = (paid === 'yes' ? amountNum > 0 : paid === 'no') && notes.trim().length >= 3;
  const canSubmit = !!photo && detailsOk && !submitting;

  const submit = async () => {
    setSubmitting(true);
    try {
      if (!uploaded.current) {
        await apiUpload(
          `/recovery/sessions/${sessionId}/evidence`,
          { caption: 'Recovery proof', latitude: endLocation.latitude, longitude: endLocation.longitude },
          photo
        );
        uploaded.current = true;
      }
      
      // 1. End the session
      await apiPost(`/recovery/sessions/${sessionId}/end`, {
        outcome: paid === 'yes' ? 'PAYMENT_COLLECTED' : 'FOLLOW_UP_REQUIRED',
        visitNotes: notes.trim(),
        paymentAmount: paid === 'yes' ? amountNum : 0,
        distanceMeters: Math.round(dist),
        durationSeconds: Math.round(durationSeconds),
        endLocation: {
          latitude: endLocation.latitude,
          longitude: endLocation.longitude,
          accuracy: endLocation.accuracy || 0,
        },
      });

      // 2. Submit the actual report to update dashboard money
      await apiPost(`/reports`, {
        sessionId,
        outcome: paid === 'yes' ? 'PAYMENT_COLLECTED' : 'FOLLOW_UP_REQUIRED',
        visitNotes: notes.trim(),
        paymentAmount: paid === 'yes' ? amountNum : 0,
        durationSeconds: Math.round(durationSeconds),
        distanceMeters: Math.round(dist),
        placesVisited: [],
        evidence: []
      });

      done.current = true;
      Alert.alert('Submitted', 'Recovery saved.', [
        { text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }) },
      ]);
    } catch (e) {
      Alert.alert('Could not submit', e.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{customer?.name || 'Recovery'} - summary</Text>
      <View style={styles.card}>
        <Row k="Total time" v={formatDuration(durationSeconds)} />
        <Row k="Distance" v={formatDistance(dist)} />
        <Row k="Start" v={startText} />
        <Row k="End" v={endText} />
      </View>

      <Text style={styles.label}>1. Proof photo (camera only)</Text>
      {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : null}
      <TouchableOpacity style={styles.camBtn} onPress={takePhoto}>
        <Text style={styles.camText}>{photo ? 'Retake photo' : 'Take photo'}</Text>
      </TouchableOpacity>

      {photo ? (
        <View>
          <Text style={styles.label}>2. Did the customer pay?</Text>
          <View style={styles.chips}>
            <TouchableOpacity style={[styles.chip, paid === 'yes' && styles.chipOn]} onPress={() => setPaid('yes')}>
              <Text style={[styles.chipText, paid === 'yes' && styles.chipTextOn]}>Paid</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, paid === 'no' && styles.chipOn]} onPress={() => setPaid('no')}>
              <Text style={[styles.chipText, paid === 'no' && styles.chipTextOn]}>Not paid</Text>
            </TouchableOpacity>
          </View>

          {paid === 'yes' ? (
            <View>
              <Text style={styles.label}>Amount collected (Rs.)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                placeholder={loan?.overdueAmount ? 'Due: ' + loan.overdueAmount : 'Amount'}
              />
            </View>
          ) : null}

          {paid ? (
            <View>
              <Text style={styles.label}>Remarks (required)</Text>
              <TextInput
                style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
                multiline
                value={notes}
                onChangeText={setNotes}
                placeholder={paid === 'yes' ? 'Remarks about this visit' : 'Why was payment not made?'}
              />
            </View>
          ) : null}

          <TouchableOpacity style={[styles.submit, !canSubmit && styles.disabled]} onPress={submit} disabled={!canSubmit}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.hint}>Take the proof photo to continue.</Text>
      )}
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  k: { color: '#666', width: 90 },
  v: { flex: 1, textAlign: 'right', fontWeight: '600' },
  label: { fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  photo: { width: '100%', height: 220, borderRadius: 10, marginBottom: 10 },
  camBtn: { backgroundColor: '#1a56db', padding: 14, borderRadius: 10, alignItems: 'center' },
  camText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: '#b45309', marginTop: 16, textAlign: 'center' },
  chips: { flexDirection: 'row' },
  chip: { borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 20, marginRight: 10 },
  chipOn: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  chipText: { fontSize: 15 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff', borderRadius: 8, padding: 14, fontSize: 16 },
  submit: { backgroundColor: '#15803d', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});