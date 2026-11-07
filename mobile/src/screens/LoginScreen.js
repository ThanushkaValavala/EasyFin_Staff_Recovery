import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiPost } from '../api';

// ─── Helpers to detect transient/connectivity errors ──────────────────────
function isNetworkError(e) {
  if (!e) return false;
  if (e.isNetworkError) return true;
  const msg = e.message || '';
  return (
    msg === 'Network request failed' ||
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    msg.includes('AbortError') ||
    msg.includes('fetch') ||
    e.name === 'AbortError'
  );
}

// ─── Local OTP fallback (used when backend is unreachable) ──────────────────
let _localOtp = null;
let _localPhone = null;

function generateLocalOtp(phone) {
  _localOtp = String(Math.floor(100000 + Math.random() * 900000));
  _localPhone = phone;
  return _localOtp;
}

function verifyLocalOtp(phone, otp) {
  return _localPhone === phone && _localOtp === otp;
}

export default function LoginScreen({ navigation }) {
  const [step, setStep] = useState('PHONE'); // 'PHONE' | 'OTP'
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [displayedOtp, setDisplayedOtp] = useState(''); // shown on screen for demo
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const requestOtp = async () => {
    setError('');
    const trimmed = phone.trim();
    if (trimmed.length < 7) {
      setError('Enter a valid phone number.');
      return;
    }
    setLoading(true);
    try {
      console.log('[Login] Requesting OTP from backend for phone:', trimmed);
      const data = await apiPost('/auth/otp/generate', { phone: trimmed });
      console.log('[Login] OTP received from backend');
      setDisplayedOtp(data.otp || '');
      setIsOfflineMode(false);
      setStep('OTP');
    } catch (e) {
      // Any connectivity / server error → fall back to local demo OTP
      if (isNetworkError(e)) {
        console.warn('[Login] Backend unreachable, using local OTP fallback. Reason:', e.message);
        const localOtp = generateLocalOtp(trimmed);
        setDisplayedOtp(localOtp);
        setIsOfflineMode(true);
        setStep('OTP');
      } else {
        // Auth-level error (e.g. 400 bad request) — show the message
        console.warn('[Login] OTP generate error (non-network):', e.status, e.message);
        setError(e.message || 'Could not generate OTP. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError('');
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    setLoading(true);
    try {
      if (isOfflineMode) {
        // Local verification
        console.log('[Login] Verifying OTP locally (offline mode)');
        if (!verifyLocalOtp(phone.trim(), trimmedOtp)) {
          setError('Incorrect OTP. Please try again.');
          setLoading(false);
          return;
        }
        // Create a local demo staff session
        const demoStaff = {
          _id: `local_${Date.now()}`,
          employeeId: 'DEMO001',
          name: 'Demo Agent',
          phone: phone.trim(),
          role: 'field_officer',
          assignedArea: 'Demo Area',
        };
        await SecureStore.setItemAsync('token', 'offline_demo_token');
        await SecureStore.setItemAsync('staff', JSON.stringify(demoStaff));
        console.log('[Login] Offline login success');
        navigation.replace('MainTabs');
      } else {
        console.log('[Login] Verifying OTP with backend');
        const data = await apiPost('/auth/otp/verify', { phone: phone.trim(), otp: trimmedOtp });
        await SecureStore.setItemAsync('token', data.token);
        await SecureStore.setItemAsync('staff', JSON.stringify(data.staff));
        console.log('[Login] Backend OTP verify success, staff:', data.staff?.name);
        navigation.replace('MainTabs');
      }
    } catch (e) {
      console.warn('[Login] OTP verify error:', e.status, e.message);
      if (isNetworkError(e)) {
        setError('Cannot reach the server. Check your internet and try again.');
      } else {
        setError(e.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetToPhone = () => {
    setStep('PHONE');
    setOtp('');
    setDisplayedOtp('');
    setError('');
    setIsOfflineMode(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.headerContainer}>
          <View style={styles.logoBox}>
            <Ionicons name="shield-checkmark" size={36} color="#fff" />
          </View>
          <Text style={styles.title}>EasyFin Recovery</Text>
          <Text style={styles.subtitle}>Staff Portal</Text>
        </View>

        {step === 'PHONE' ? (
          <View style={styles.formContainer}>
            <Text style={styles.label}>Mobile Number</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={20} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your mobile number"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                autoCorrect={false}
                maxLength={15}
                value={phone}
                onChangeText={setPhone}
                onSubmitEditing={requestOtp}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, phone.trim().length < 7 && styles.btnDisabled]}
              onPress={requestOtp}
              disabled={loading || phone.trim().length < 7}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Generate OTP</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.formContainer}>
            <Text style={styles.stepInfo}>
              OTP sent to <Text style={styles.phoneHighlight}>{phone}</Text>
            </Text>

            {isOfflineMode ? (
              <View style={styles.offlineBanner}>
                <Ionicons name="wifi-outline" size={16} color="#92400E" style={{ marginRight: 6 }} />
                <Text style={styles.offlineText}>Offline mode — backend unreachable</Text>
              </View>
            ) : null}

            {displayedOtp ? (
              <View style={styles.otpDisplayBox}>
                <Text style={styles.otpDisplayLabel}>Your OTP (Demo)</Text>
                <Text style={styles.otpDisplayValue}>{displayedOtp}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Enter OTP</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="keypad-outline" size={20} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="6-digit OTP"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                maxLength={6}
                autoCorrect={false}
                value={otp}
                onChangeText={setOtp}
                onSubmitEditing={verifyOtp}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, otp.trim().length !== 6 && styles.btnDisabled]}
              onPress={verifyOtp}
              disabled={loading || otp.trim().length !== 6}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify OTP</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkBtn} onPress={resetToPhone}>
              <Text style={styles.linkText}>← Change number</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 48 },
  logoBox: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: '#2563EB',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    shadowColor: '#2563EB', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#64748B', marginTop: 4, fontWeight: '500' },
  formContainer: { width: '100%' },
  stepInfo: { fontSize: 14, color: '#64748B', marginBottom: 16, textAlign: 'center' },
  phoneHighlight: { fontWeight: '700', color: '#0F172A' },
  label: {
    fontSize: 13, fontWeight: '600', color: '#0F172A',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12,
    marginBottom: 20, paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#0F172A', fontWeight: '500' },
  otpDisplayBox: {
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#BFDBFE',
  },
  otpDisplayLabel: { fontSize: 12, color: '#2563EB', fontWeight: '600', marginBottom: 4 },
  otpDisplayValue: { fontSize: 32, fontWeight: '800', color: '#1E40AF', letterSpacing: 8 },
  offlineBanner: {
    backgroundColor: '#FEF9C3', borderRadius: 8, padding: 10,
    flexDirection: 'row', alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: '#FDE047',
  },
  offlineText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  primaryBtn: {
    backgroundColor: '#2563EB', height: 56, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#2563EB', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkBtn: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#2563EB', fontSize: 14, fontWeight: '600' },
  errorBox: {
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8,
    marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },
});
