import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { apiPost, apiUpload } from '../api';

const TYPES = [
  { key: 'BIKE', label: 'Bike' },
  { key: 'SCOOTER', label: 'Scooter' },
  { key: 'CAR', label: 'Car' },
  { key: 'AUTO', label: 'Auto' },
  { key: 'OTHER', label: 'Other' },
];

export default function StartRecoveryScreen({ route, navigation }) {
  const { caseId, customer, loan } = route.params;
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const takeSpeedometer = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera permission is needed to take the speedometer photo.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled && r.assets && r.assets[0] && r.assets[0].uri) {
      setPhoto(r.assets[0].uri);
      setError('');
    }
  };

  const start = async () => {
    setError('');

    if (!vehicleType) {
      setError('Select the vehicle type.');
      return;
    }
    if (vehicleNumber.replace(/[\s-]/g, '').length < 6) {
      setError('Enter the vehicle number (for example KA01AB1234).');
      return;
    }
    if (!photo) {
      setError('Take a photo of the speedometer before starting.');
      return;
    }

    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission is needed to track the recovery route.');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const initialLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
      };

      const data = await apiPost('/recovery/start', {
        assignmentId: caseId,
        customerId: customer._id || customer.id,
        loanId: loan._id || loan.id,
        vehicleType,
        vehicleNumber,
        initialLocation,
      });

      const sessionId = data.session.sessionId || data.session._id;
      await apiUpload(
        '/recovery/sessions/' + sessionId + '/evidence',
        {
          caption: 'Speedometer (start)',
          latitude: initialLocation.latitude,
          longitude: initialLocation.longitude,
        },
        photo
      );

      navigation.replace('ActiveRecovery', {
        session: data.session,
        caseId,
        customer,
        loan,
        startLocation: initialLocation,
      });
    } catch (e) {
      setError(
        e.message === 'Network request failed'
          ? 'Cannot reach the server. Check your internet.'
          : e.message + ' Tap Start Recovery again to retry.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.customer}>{customer.name}</Text>
      <Text style={styles.loan}>Loan no: {loan.loanId}</Text>

      <Text style={styles.label}>Type of vehicle</Text>
      <View style={styles.chips}>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.chip, vehicleType === t.key && styles.chipActive]}
            onPress={() => setVehicleType(t.key)}
          >
            <Text style={[styles.chipText, vehicleType === t.key && styles.chipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Vehicle number</Text>
      <TextInput
        style={styles.input}
        placeholder="KA01AB1234"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={14}
        value={vehicleNumber}
        onChangeText={setVehicleNumber}
      />

      <Text style={styles.label}>Speedometer photo (required)</Text>
      {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : null}
      <TouchableOpacity style={styles.camBtn} onPress={takeSpeedometer}>
        <Text style={styles.camText}>{photo ? 'Retake speedometer photo' : 'Take speedometer photo'}</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={start} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Start Recovery</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.note}>
        Your location is recorded from the moment you start until you stop.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  customer: { fontSize: 20, fontWeight: 'bold' },
  loan: { color: '#666', marginBottom: 12 },
  label: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff',
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginRight: 8, marginBottom: 8,
  },
  chipActive: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  chipText: { fontSize: 15 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff',
    borderRadius: 8, padding: 14, fontSize: 16,
  },
  photo: { width: '100%', height: 200, borderRadius: 10, marginBottom: 10 },
  camBtn: { backgroundColor: '#1a56db', padding: 14, borderRadius: 10, alignItems: 'center' },
  camText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#c00', marginTop: 12 },
  button: {
    backgroundColor: '#15803d', padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 24,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  note: { color: '#666', textAlign: 'center', marginTop: 12 },
});