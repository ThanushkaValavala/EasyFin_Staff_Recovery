import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api';

const money = (n) =>
  '\u20B9' + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return p(x.getDate()) + '-' + p(x.getMonth() + 1) + '-' + x.getFullYear();
};

const NO_AREA = 'No area';

export default function CasesListScreen({ route, navigation }) {
  const { status } = route.params || { status: 'ALL' };

  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      let queryStatus = status;
      if (status === 'TODAY') queryStatus = 'ALL';

      const query = queryStatus === 'ALL' ? '' : `?status=${queryStatus}`;
      const res = await apiGet(`/cases${query}`);

      let fetchedCases = res.cases;

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

  const groups = {};
  cases.forEach((c) => {
    const key = (c.customer && c.customer.area) || NO_AREA;
    (groups[key] = groups[key] || []).push(c);
  });
  const areas = Object.keys(groups).sort((a, b) =>
    a === NO_AREA ? 1 : b === NO_AREA ? -1 : a.localeCompare(b)
  );

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

      {areas.map((area) => (
        <View key={area}>
          <View style={styles.areaHeader}>
            <Text style={styles.areaTitle}>{area}</Text>
            <Text style={styles.areaCount}>{groups[area].length} case{groups[area].length === 1 ? '' : 's'}</Text>
          </View>

          {groups[area].map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.caseCard}
              onPress={() => navigation.navigate('CaseDetail', { id: c.id })}
            >
              <View style={styles.caseTop}>
                <Text style={styles.caseName}>{c.customer.name}</Text>
                <Text style={styles.priority}>{c.priority}</Text>
              </View>
              <Text style={styles.address}>{c.customer.address}</Text>
              <Text style={styles.line}>Loan no: <Text style={styles.bold}>{c.loan.loanId}</Text></Text>
              <Text style={styles.line}>Loan date: {fmtDate(c.loan.loanDate)}</Text>
              <Text style={styles.line}>Loan type: {c.loan.loanType}</Text>
              <Text style={styles.pending}>Pending: {money(c.loan.outstandingAmount)}</Text>
              {Number(c.loan.penaltyAmount) > 0 ? (
                <Text style={styles.penalty}>Penalty: {money(c.loan.penaltyAmount)}</Text>
              ) : null}
              <View style={styles.statusRow}>
                <Text style={styles.caseStatus}>Status: {c.recoveryStatus}</Text>
                {c.loan.outstandingAmount < c.loan.totalAmount && c.loan.outstandingAmount > 0 && (
                  <Text style={styles.partialBadge}>Partial Paid</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  error: { color: '#c00', marginBottom: 12 },
  empty: { color: '#666', textAlign: 'center', marginTop: 20 },
  areaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  areaTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  areaCount: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  caseCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, elevation: 2 },
  caseTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  caseName: { fontSize: 16, fontWeight: '600' },
  priority: { fontSize: 12, fontWeight: '700', color: '#c2410c' },
  address: { color: '#444', marginBottom: 6 },
  line: { color: '#666', marginBottom: 2 },
  bold: { fontWeight: '700', color: '#0F172A' },
  pending: { fontSize: 16, fontWeight: 'bold', color: '#1a56db', marginTop: 6 },
  penalty: { fontSize: 14, fontWeight: '600', color: '#b91c1c', marginTop: 2 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  caseStatus: { color: '#666', fontSize: 13 },
  partialBadge: { backgroundColor: '#fef3c7', color: '#b45309', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontSize: 12, fontWeight: '600' },
});