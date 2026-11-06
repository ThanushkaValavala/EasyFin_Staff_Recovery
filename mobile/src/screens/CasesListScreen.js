import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api';

const money = (n) =>
  '\u20B9' + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function CasesListScreen({ route, navigation }) {
  // Default to 'ALL' if no status is passed
  const { status } = route.params || { status: 'ALL' };
  
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Map the status for the backend query
      let queryStatus = status;
      if (status === 'TODAY') queryStatus = 'ALL'; // Today filter is handled client-side or needs a new backend route
      
      const query = queryStatus === 'ALL' ? '' : `?status=${queryStatus}`;
      const res = await apiGet(`/cases${query}`);
      
      let fetchedCases = res.cases;
      
      // Client-side filter for TODAY
      if (status === 'TODAY') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        fetchedCases = fetchedCases.filter(c => new Date(c.assignedDate) >= today);
      }

      setCases(fetchedCases);
    } catch (e) {
      setError(e.message === 'Network request failed' ? 'Cannot reach the server.' : e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a56db" /></View>;
  }

  const getTitle = () => {
    if (status === 'TODAY') return 'Assigned Today';
    if (status === 'PENDING') return 'Pending Cases';
    if (status === 'PARTIALLY_RECOVERED') return 'Partially Recovered';
    if (status === 'COMPLETED') return 'Fully Recovered';
    return 'All Cases';
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={styles.headerTitle}>{getTitle()}</Text>
      
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cases.length === 0 && !error ? (
        <Text style={styles.empty}>No cases found for this category.</Text>
      ) : null}

      {cases.map((c) => (
        <TouchableOpacity
          key={c.id}
          style={styles.caseCard}
          onPress={() => navigation.navigate('CaseDetail', { id: c.id })}
        >
          <View style={styles.caseTop}>
            <Text style={styles.caseName}>{c.customer.name}</Text>
            <Text style={styles.priority}>{c.priority}</Text>
          </View>
          <Text style={styles.caseLoan}>{c.loan.loanId} - {c.loan.loanType}</Text>
          <Text style={styles.caseDue}>To collect: {money(c.loan.overdueAmount)}</Text>
          <View style={styles.statusRow}>
            <Text style={styles.caseStatus}>Status: {c.recoveryStatus}</Text>
            {c.loan.outstandingAmount < c.loan.totalAmount && c.loan.outstandingAmount > 0 && (
              <Text style={styles.partialBadge}>Partial Paid</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  error: { color: '#c00', marginBottom: 12 },
  empty: { color: '#666', textAlign: 'center', marginTop: 20 },
  caseCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, elevation: 2 },
  caseTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  caseName: { fontSize: 16, fontWeight: '600' },
  priority: { fontSize: 12, fontWeight: '700', color: '#c2410c' },
  caseLoan: { color: '#666', marginBottom: 8 },
  caseDue: { fontSize: 16, fontWeight: 'bold', color: '#1a56db', marginBottom: 8 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caseStatus: { color: '#666', fontSize: 13 },
  partialBadge: { backgroundColor: '#fef3c7', color: '#b45309', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontSize: 12, fontWeight: '600' },
});