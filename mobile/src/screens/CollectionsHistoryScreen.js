import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api';

const money = (n) =>
  '\u20B9' + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function CollectionsHistoryScreen({ route }) {
  const { filter } = route.params || { filter: 'ALL' }; // 'TODAY' or 'ALL'
  
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Fixed: was incorrectly calling /recovery/collections which doesn't exist.
      // The correct backend endpoint is /analytics/collections
      const url = filter === 'TODAY'
        ? '/analytics/collections?filter=today'
        : '/analytics/collections';
      const res = await apiGet(url);
      
      // Assuming your backend returns { collections: [...] }
      setRecords(res.collections || res.data || []);
    } catch (e) {
      setError(e.message === 'Network request failed' 
        ? 'Cannot reach the server. Check Wi-Fi.' 
        : e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      
      {records.length === 0 && !error ? (
        <Text style={styles.empty}>No collections found.</Text>
      ) : null}

      {records.map((r, index) => (
        <View key={r._id || index} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.customerName}>{r.customerName || r.customer?.name || 'Customer'}</Text>
            <Text style={styles.amount}>+ {money(r.paymentAmount || r.amount)}</Text>
          </View>
          <Text style={styles.date}>
            Date: {new Date(r.createdAt || r.collectedAt).toLocaleString()}
          </Text>
          <Text style={styles.notes}>Notes: {r.visitNotes || 'Collected via app'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#c00', marginBottom: 12 },
  empty: { color: '#666', textAlign: 'center', marginTop: 20 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#15803d' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  customerName: { fontSize: 16, fontWeight: '600' },
  amount: { fontSize: 16, fontWeight: 'bold', color: '#15803d' },
  date: { color: '#666', fontSize: 13, marginBottom: 2 },
  notes: { color: '#444', fontSize: 13, fontStyle: 'italic' },
});