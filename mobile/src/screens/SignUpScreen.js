import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiPost } from '../api';

const FIELDS = [
  { key: 'employeeId', label: 'Employee ID', placeholder: 'e.g. EF-REC-106', caps: 'characters' },
  { key: 'name', label: 'Full name', placeholder: 'Your name', caps: 'words' },
  { key: 'email', label: 'Email', placeholder: 'you@example.com', caps: 'none', keyboard: 'email-address' },
  { key: 'phone', label: 'Phone', placeholder: '10-digit number', caps: 'none', keyboard: 'phone-pad' },
  { key: 'assignedArea', label: 'Assigned area', placeholder: 'e.g. Zone A', caps: 'words' },
  { key: 'password', label: 'Password (min 8 characters)', placeholder: 'Choose a password', caps: 'none', secure: true },
  { key: 'signupCode', label: 'Sign-up code', placeholder: 'Given by your supervisor', caps: 'none', secure: true },
];

export default function SignUpScreen({ navigation }) {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    for (const f of FIELDS) {
      if (!String(form[f.key] || '').trim()) {
        setError('Please fill in: ' + f.label);
        return;
      }
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/auth/register', {
        employeeId: form.employeeId.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        assignedArea: form.assignedArea.trim(),
        password: form.password,
        signupCode: form.signupCode.trim(),
      });
      Alert.alert('Account created', 'You can log in now.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setError(e.message === 'Network request failed' ? 'Cannot reach the server. Check your internet.' : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Field staff sign-up</Text>

          {FIELDS.map((f) => (
            <View key={f.key}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={styles.input}
                placeholder={f.placeholder}
                placeholderTextColor="#94A3B8"
                autoCapitalize={f.caps}
                autoCorrect={false}
                keyboardType={f.keyboard || 'default'}
                secureTextEntry={!!f.secure}
                value={form[f.key] || ''}
                onChangeText={(v) => set(f.key, v)}
              />
            </View>
          ))}

          {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign up</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.linkText}>Already have an account? Log in</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 24 },
  title: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 14, color: '#64748B', marginBottom: 24, marginTop: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#0F172A', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 16, height: 52, fontSize: 16, color: '#0F172A', marginBottom: 16 },
  primaryBtn: { backgroundColor: '#2563EB', height: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkBtn: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#2563EB', fontSize: 14, fontWeight: '600' },
  errorBox: { backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#FCA5A5' },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },
});