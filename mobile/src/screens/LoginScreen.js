import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiPost, warmUpServer } from '../api';

const BRANCH_OPTIONS = ['Branch 1', 'Branch 2'];

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

// ─── Digit sanitiser (strips non-digits, handles +91 paste, max 10) ─────────
function sanitisePhone(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 10);
}

export default function LoginScreen({ navigation }) {
  useEffect(() => { warmUpServer(); }, []);
  const [step, setStep] = useState('PHONE'); // 'PHONE' | 'OTP'
  const [branch, setBranch] = useState(''); // Default is nothing selected
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [displayedOtp, setDisplayedOtp] = useState(''); // shown on screen for demo
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const handlePhoneChange = (raw) => {
    setPhone(sanitisePhone(raw));
    setError('');
  };

  const requestOtp = async () => {
    setError('');
    if (!branch) {
      setError('Please select a branch.');
      return;
    }
    const trimmed = phone.trim();
    if (trimmed.length !== 10) {
      setError('Enter a 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      console.log('[Login] Requesting OTP from backend for phone:', trimmed);
      const data = await apiPost('/auth/otp/generate', { phone: trimmed, branch });
      console.log('[Login] OTP received from backend');
      setDisplayedOtp(data.otp || '');
      setIsOfflineMode(false);
      setStep('OTP');
    } catch (e) {
      if (e.status === 403) {
        console.warn('[Login] OTP generate error 403:', e.message);
        setError(e.message || 'This number is not registered under the selected branch.');
      } else if (isNetworkError(e)) {
        console.warn('[Login] Backend unreachable, server warming up.');
        setError('Server is waking up. Wait 30 seconds and tap Generate OTP again.');
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
          assignedArea: branch || 'Demo Area',
        };
        await SecureStore.setItemAsync('token', 'offline_demo_token');
        await SecureStore.setItemAsync('staff', JSON.stringify(demoStaff));
        console.log('[Login] Offline login success');
        navigation.replace('MainTabs');
      } else {
        console.log('[Login] Verifying OTP with backend');
        const data = await apiPost('/auth/otp/verify', { phone: phone.trim(), otp: trimmedOtp, branch });
        await SecureStore.setItemAsync('token', data.token);
        await SecureStore.setItemAsync('staff', JSON.stringify(data.staff));
        console.log('[Login] Backend OTP verify success, staff:', data.staff?.name);
        navigation.replace('MainTabs');
      }
    } catch (e) {
      console.warn('[Login] OTP verify error:', e.status, e.message);
      if (e.status === 403) {
        setError(e.message || 'This number is not registered under the selected branch.');
      } else if (isNetworkError(e)) {
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

  // ─── OTP step ───────────────────────────────────────────────────────────────
  if (step === 'OTP') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Top strip — same as PHONE step ───────────────────────────── */}
            <View style={styles.topStrip}>
              <View style={styles.logoCircle}>
                <Ionicons name="shield-checkmark" size={42} color="#2563EB" />
              </View>
              <Text style={styles.title}>EasyFin Recovery</Text>
              <View style={styles.subtitleRow}>
                <View style={styles.subtitleLine} />
                <Text style={styles.subtitle}>Staff Portal</Text>
                <View style={styles.subtitleLine} />
              </View>
            </View>

            {/* ── OTP form card ─────────────────────────────────────────────── */}
            <View style={styles.formCard}>

              {/* "OTP sent to <number>" with icon */}
              <View style={styles.otpSentRow}>
                <Ionicons name="checkmark-circle" size={16} color="#2563EB" style={{ marginRight: 6 }} />
                <Text style={styles.stepInfo}>
                  OTP sent to <Text style={styles.phoneHighlight}>{phone}</Text>
                </Text>
              </View>

              {/* Offline banner */}
              {isOfflineMode ? (
                <View style={styles.offlineBanner}>
                  <Ionicons name="wifi-outline" size={16} color="#92400E" style={{ marginRight: 6 }} />
                  <Text style={styles.offlineText}>Offline mode — backend unreachable</Text>
                </View>
              ) : null}

              {/* Demo OTP display — light blue card, dashed-style border */}
              {displayedOtp ? (
                <View style={styles.otpDisplayBox}>
                  <Text style={styles.otpDisplayLabel}>Your OTP (Demo)</Text>
                  <Text style={styles.otpDisplayValue}>{displayedOtp}</Text>
                </View>
              ) : null}

              {/* Enter OTP label */}
              <Text style={styles.fieldLabel}>
                <Ionicons name="lock-closed-outline" size={13} color="#2563EB" /> {'  '}Enter OTP
              </Text>

              {/* OTP input — blue outline, single field, 6 digits, numeric */}
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

              {/* Error */}
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Verify OTP button — shield-checkmark icon, same disabled/loading behaviour */}
              <TouchableOpacity
                style={[styles.primaryBtn, otp.trim().length !== 6 && styles.btnDisabled]}
                onPress={verifyOtp}
                disabled={loading || otp.trim().length !== 6}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.btnInner}>
                    <Text style={styles.primaryBtnText}>Verify OTP</Text>
                    <Ionicons name="shield-checkmark" size={18} color="#fff" style={{ marginLeft: 8 }} />
                  </View>
                )}
              </TouchableOpacity>

              {/* Change number — existing handler, restyled as small text link */}
              <TouchableOpacity style={styles.linkBtn} onPress={resetToPhone}>
                <Text style={styles.linkText}>← Change number</Text>
              </TouchableOpacity>

            </View>

            {/* ── Footer security note — same as PHONE step ────────────────── */}
            <View style={styles.securityCard}>
              <Ionicons name="lock-closed-outline" size={14} color="#2563EB" style={{ marginRight: 6 }} />
              <Text style={styles.securityText}>
                Your access is securely verified through the EasyFin centralized system.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── OTP step ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Top decorative strip (solid, no SVG needed) ─────────────────── */}
          <View style={styles.topStrip}>
            {/* Logo: soft blue circle behind shield */}
            <View style={styles.logoCircle}>
              <Ionicons name="shield-checkmark" size={42} color="#2563EB" />
            </View>
            <Text style={styles.title}>EasyFin Recovery</Text>
            <View style={styles.subtitleRow}>
              <View style={styles.subtitleLine} />
              <Text style={styles.subtitle}>Staff Portal</Text>
              <View style={styles.subtitleLine} />
            </View>
          </View>

          {/* ── Welcome card ─────────────────────────────────────────────────── */}
          <View style={styles.welcomeCard}>
            <Ionicons name="people-outline" size={22} color="#1E40AF" style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.welcomeTitle}>Welcome back!</Text>
              <Text style={styles.welcomeSub}>
                Please select your branch and verify your mobile number.
              </Text>
            </View>
          </View>

          {/* ── Main form card ───────────────────────────────────────────────── */}
          <View style={styles.formCard}>
            {/* Select Branch */}
            <Text style={styles.fieldLabel}>
              <Ionicons name="business-outline" size={13} color="#2563EB" /> {'  '}Select Branch
            </Text>
            <TouchableOpacity
              style={[styles.dropdownWrapper, branchDropdownOpen && styles.dropdownWrapperOpen]}
              onPress={() => setBranchDropdownOpen(!branchDropdownOpen)}
              activeOpacity={0.8}
            >
              <Ionicons name="business-outline" size={20} color="#64748B" style={styles.inputIcon} />
              <Text style={[styles.dropdownText, !branch && styles.dropdownPlaceholder]}>
                {branch || 'Select Branch'}
              </Text>
              <Ionicons
                name={branchDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color="#64748B"
              />
            </TouchableOpacity>

            {branchDropdownOpen && (
              <View style={styles.dropdownMenu}>
                {BRANCH_OPTIONS.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[
                      styles.dropdownItem,
                      branch === item && styles.dropdownItemSelected,
                    ]}
                    onPress={() => {
                      setBranch(item);
                      setBranchDropdownOpen(false);
                      setError('');
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        branch === item && styles.dropdownItemTextSelected,
                      ]}
                    >
                      {item}
                    </Text>
                    {branch === item && (
                      <Ionicons name="checkmark-circle" size={18} color="#2563EB" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Mobile Number */}
            <Text style={styles.fieldLabel}>
              <Ionicons name="call-outline" size={13} color="#2563EB" /> {'  '}Mobile Number
            </Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={20} color="#64748B" style={styles.inputIcon} />
              {/* Fixed +91 prefix — display only, never stored or sent */}
              <Text style={styles.dialCode}>+91</Text>
              <View style={styles.dialDivider} />
              <TextInput
                style={styles.input}
                placeholder="Enter your mobile number"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                autoCorrect={false}
                maxLength={10}
                value={phone}
                onChangeText={handlePhoneChange}
                onSubmitEditing={requestOtp}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Generate OTP button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (loading || !branch || phone.trim().length !== 10) && styles.btnDisabled,
              ]}
              onPress={requestOtp}
              disabled={loading || !branch || phone.trim().length !== 10}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.btnInner}>
                  <Text style={styles.primaryBtnText}>Generate OTP</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Footer security note ─────────────────────────────────────────── */}
          <View style={styles.securityCard}>
            <Ionicons name="lock-closed-outline" size={14} color="#2563EB" style={{ marginRight: 6 }} />
            <Text style={styles.securityText}>
              Your access is securely verified through the EasyFin centralized system.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#EFF6FF' },
  flex: { flex: 1 },

  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },

  // ── Top strip (solid light-blue block, no SVG) ───────────────────────────
  topStrip: {
    backgroundColor: '#DBEAFE',
    paddingTop: 44,
    paddingBottom: 36,
    alignItems: 'center',
    // Soft bottom "bump" effect via borderRadius on bottom corners
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    marginBottom: 20,
  },

  // Logo: soft white/light-blue circle behind shield icon
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 2,
    borderColor: '#BFDBFE',
  },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
    marginBottom: 6,
  },

  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subtitleLine: {
    flex: 1,
    maxWidth: 50,
    height: 1,
    backgroundColor: '#93C5FD',
  },
  subtitle: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // ── Welcome card ──────────────────────────────────────────────────────────
  welcomeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#DBEAFE',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  welcomeTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E40AF',
    marginBottom: 3,
  },
  welcomeSub: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '500',
    lineHeight: 19,
  },

  // ── Main form card ────────────────────────────────────────────────────────
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Dropdown ──────────────────────────────────────────────────────────────
  dropdownWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: 12,
    marginBottom: 18,
    paddingHorizontal: 14,
    height: 54,
  },
  dropdownWrapperOpen: { borderColor: '#2563EB' },
  dropdownText: { flex: 1, fontSize: 15, color: '#0F172A', fontWeight: '500' },
  dropdownPlaceholder: { color: '#94A3B8' },
  dropdownMenu: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    marginTop: -10,
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemSelected: { backgroundColor: '#EFF6FF' },
  dropdownItemText: { fontSize: 15, color: '#334155', fontWeight: '500' },
  dropdownItemTextSelected: { color: '#2563EB', fontWeight: '700' },

  // ── Input row ─────────────────────────────────────────────────────────────
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: 12,
    marginBottom: 18,
    paddingHorizontal: 14,
    height: 54,
  },
  inputIcon: { marginRight: 10 },
  dialCode: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E40AF',
    marginRight: 8,
  },
  dialDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#CBD5E1',
    marginRight: 10,
  },
  input: { flex: 1, fontSize: 16, color: '#0F172A', fontWeight: '500' },

  // ── OTP display (demo) — light blue card, dashed-style blue border ──────
  otpDisplayBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderStyle: 'dashed',
  },
  otpDisplayLabel: { fontSize: 12, color: '#2563EB', fontWeight: '600', marginBottom: 4 },
  otpDisplayValue: { fontSize: 32, fontWeight: '800', color: '#1E40AF', letterSpacing: 8 },

  // ── "OTP sent to" row with icon ───────────────────────────────────────────
  otpSentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },

  offlineBanner: {
    backgroundColor: '#FEF9C3',
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  offlineText: { fontSize: 13, color: '#92400E', fontWeight: '500' },

  stepInfo: { fontSize: 14, color: '#64748B', textAlign: 'center' },
  phoneHighlight: { fontWeight: '700', color: '#0F172A' },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorBox: {
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },

  // ── Generate OTP / Verify OTP button ─────────────────────────────────────
  primaryBtn: {
    backgroundColor: '#2563EB',
    height: 54,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.45 },
  btnInner: { flexDirection: 'row', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  linkBtn: { marginTop: 18, alignItems: 'center' },
  linkText: { color: '#2563EB', fontSize: 14, fontWeight: '600' },

  // ── Footer security card ──────────────────────────────────────────────────
  securityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  securityText: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
    lineHeight: 16,
  },
});
