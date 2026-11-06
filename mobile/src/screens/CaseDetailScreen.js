import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
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

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function CaseDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet(`/cases/${id}`)
      .then((d) => setItem(d.caseItem))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  }
  if (!item) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a56db" /></View>;
  }

  const { customer, loan } = item;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.sectionTitle}>Loan details</Text>
      <View style={styles.card}>
        <Row label="Loan no." value={loan.loanId} />
        <Row label="Loan date" value={fmtDate(loan.loanDate)} />
        <Row label="Loan type" value={loan.loanType} />
        <Row label="Pending amount" value={money(loan.outstandingAmount)} />
        {Number(loan.penaltyAmount) > 0 ? <Row label="Penalty" value={money(loan.penaltyAmount)} /> : null}
        <Row label="Status" value={loan.status} />
      </View>

      <Text style={styles.sectionTitle}>Customer</Text>
      <View style={styles.card}>
        <Row label="Name" value={customer.name} />
        <Row label="Phone" value={customer.phone} />
        {customer.aadhaar ? <Row label="Aadhaar" value={customer.aadhaar} /> : null}
        {customer.dob ? <Row label="Date of birth" value={fmtDate(customer.dob)} /> : null}
        <Row label="Area" value={customer.area || '-'} />
        <Row label="Address" value={customer.address} />
        <Row label="Landmark" value={customer.landmark || '-'} />
        <Row label="City" value={customer.city || '-'} />
      </View>

      {item.notes ? (
        <>
          <Text style={styles.sectionTitle}>Notes</Text>
          <View style={styles.card}><Text>{item.notes}</Text></View>
        </>
      ) : null}

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('StartRecovery', { caseId: id, customer, loan })}
      >
        <Text style={styles.buttonText}>Start Recovery</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: '#c00', textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: '#666', flex: 1 },
  rowValue: { fontWeight: '500', flex: 2, textAlign: 'right' },
  button: { backgroundColor: '#15803d', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 24, marginBottom: 24 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});