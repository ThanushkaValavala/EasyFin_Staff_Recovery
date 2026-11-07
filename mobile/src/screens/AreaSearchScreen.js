import { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api';

const msg = (e) => (e.message === 'Network request failed' ? 'Cannot reach the server. Check your internet.' : e.message);

export default function AreaSearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const res = await apiGet('/cases/areas?q=');
          if (alive) { setAreas(res.knownAreas || []); setError(''); }
        } catch (e) {
          if (alive) setError(msg(e));
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => { alive = false; };
    }, [])
  );

  const search = async (q) => {
    const text = String(q || '').trim();
    setError('');
    setSearching(true);
    try {
      const res = await apiGet('/cases/areas?q=' + encodeURIComponent(text));
      if (!res.total) {
        setError(text ? 'No customers found for "' + text + '".' : 'You have no customers assigned.');
        return;
      }
      navigation.navigate('SelectCases', { query: text, groups: res.groups, total: res.total });
    } catch (e) {
      setError(msg(e));
    } finally {
      setSearching(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Assigned Loans</Text>
      <Text style={styles.sub}>Enter an area or location to find customers.</Text>

      <TextInput
        style={styles.input}
        placeholder="Area, city, street or landmark"
        placeholderTextColor="#94A3B8"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => search(query)}
        returnKeyType="search"
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.btn} onPress={() => search(query)} disabled={searching}>
        {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Find customers</Text>}
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {areas.length > 0 ? (
        <View>
          <Text style={styles.label}>Your areas</Text>
          <View style={styles.chips}>
            {areas.map((a) => (
              <TouchableOpacity key={a} style={styles.chip} onPress={() => { setQuery(a); search(a); }}>
                <Text style={styles.chipText}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity style={styles.link} onPress={() => search('')}>
        <Text style={styles.linkText}>Show all my customers</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('CasesList', { status: 'ALL' })}>
        <Text style={styles.linkText}>Open full cases list</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  sub: { color: '#64748B', marginTop: 4, marginBottom: 20 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 16, height: 52, fontSize: 16, color: '#0F172A' },
  btn: { backgroundColor: '#2563EB', height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#DC2626', marginTop: 12, fontWeight: '500' },
  label: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginTop: 24, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginRight: 8, marginBottom: 8 },
  chipText: { fontSize: 15, color: '#0F172A', fontWeight: '600' },
  link: { marginTop: 18, alignItems: 'center' },
  linkText: { color: '#2563EB', fontWeight: '600', fontSize: 15 },
});