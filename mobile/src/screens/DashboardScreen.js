import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from '../api';
import { syncPendingSessions } from '../utils/offlineStore';

export default function DashboardScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));

      // Fetch live profile with stats
      try {
        const profRes = await apiGet('/agent/profile');
        if (profRes && profRes.staff) {
          setStaff(profRes.staff);
          await SecureStore.setItemAsync('staff', JSON.stringify(profRes.staff));
        }
      } catch (pe) {
        // Profile fetch failed — use cached staff (already set above)
        console.warn('[Dashboard] Profile fetch error:', pe.message);
      }

      // Fetch actual assignments from the backend
      try {
        const data = await apiGet('/assignments');
        if (data && data.cases) {
          setAssignments(data.cases);
        } else if (data && data.assignments) {
          setAssignments(data.assignments);
        } else if (Array.isArray(data)) {
          setAssignments(data);
        }
      } catch (e) {
        console.warn('[Dashboard] /assignments fetch error:', e.message);
        try {
          const fallback = await apiGet('/cases');
          if (fallback && fallback.cases) setAssignments(fallback.cases);
        } catch (err2) {
          console.warn('[Dashboard] /cases fetch error:', err2.message);
        }
      }

      // Trigger background sync of any pending offline recoveries
      syncPendingSessions().catch(() => {});
    } catch (e) {
      setError(
        e.isNetworkError || e.message === 'Network request failed'
          ? 'Cannot reach the server. Showing cached data.'
          : e.message
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Connecting to server...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          colors={['#2563EB']}
        />
      }
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{staff ? staff.name : 'Recovery Agent'}</Text>
          <Text style={styles.phoneSub}>{staff?.phone || ''}</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{staff?.name?.charAt(0)?.toUpperCase() || 'A'}</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#DC2626" style={{ marginRight: 6 }} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CARD 1: ASSIGNED TASKS (DISPLAY ONLY - NOT CLICKABLE)                 */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <View style={[styles.card, styles.cardAssigned]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBg, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="briefcase" size={24} color="#2563EB" />
            </View>
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.cardTitle}>Assigned Tasks</Text>
              <Text style={styles.cardSub}>Customer recovery cases assigned to you</Text>
            </View>
          </View>
          <View style={styles.badgeViewOnly}>
            <Text style={styles.badgeViewOnlyText}>DISPLAY ONLY</Text>
          </View>
        </View>

        {assignments.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={36} color="#94A3B8" />
            <Text style={styles.emptyStateText}>No assigned cases currently.</Text>
          </View>
        ) : (
          <View style={styles.assignmentsList}>
            {assignments.map((item, index) => {
              const cust = item.customer || item.customerId || {};
              const loan = item.loan || item.loanId || {};
              const status = item.recoveryStatus || 'PENDING';

              return (
                <View key={item._id || item.assignmentId || index} style={styles.taskItem}>
                  <View style={styles.taskItemHeader}>
                    <Text style={styles.customerName}>{cust.name || 'Customer'}</Text>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>{status}</Text>
                    </View>
                  </View>

                  <View style={styles.taskDetailRow}>
                    <Ionicons name="call-outline" size={14} color="#64748B" style={styles.detailIcon} />
                    <Text style={styles.detailText}>{cust.phone || cust.mobileNumber || '—'}</Text>
                  </View>

                  <View style={styles.taskDetailRow}>
                    <Ionicons name="document-text-outline" size={14} color="#64748B" style={styles.detailIcon} />
                    <Text style={styles.detailText}>Loan A/C: {loan.accountNumber || loan.loanId || '—'}</Text>
                  </View>

                  <View style={styles.financialRow}>
                    <View style={styles.financialCol}>
                      <Text style={styles.financialLabel}>Loan Amount</Text>
                      <Text style={styles.financialValue}>₹{Number(loan.totalAmount || loan.loanAmount || 0).toLocaleString()}</Text>
                    </View>
                    <View style={styles.financialCol}>
                      <Text style={styles.financialLabel}>Outstanding</Text>
                      <Text style={[styles.financialValue, { color: '#DC2626' }]}>
                        ₹{Number(loan.outstandingAmount || 0).toLocaleString()}
                      </Text>
                    </View>
                    <View style={styles.financialCol}>
                      <Text style={styles.financialLabel}>Due Amount</Text>
                      <Text style={[styles.financialValue, { color: '#B45309' }]}>
                        ₹{Number(loan.dueAmount || loan.emiAmount || 0).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {cust.address ? (
                    <View style={[styles.taskDetailRow, { marginTop: 6 }]}>
                      <Ionicons name="location-outline" size={14} color="#64748B" style={styles.detailIcon} />
                      <Text style={styles.addressText} numberOfLines={2}>{cust.address}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CARD 2: START RECOVERY (CLICKABLE → GOES DIRECTLY TO TRANSPORT SELECTION) */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <TouchableOpacity
        style={[styles.card, styles.cardStart]}
        onPress={() => navigation.navigate('StartRecovery')}
        activeOpacity={0.88}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBg, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="navigate" size={26} color="#059669" />
            </View>
            <View style={{ marginLeft: 14 }}>
              <Text style={styles.cardTitle}>Start Recovery</Text>
              <Text style={styles.cardSub}>Select transport, record speedometer & track route</Text>
            </View>
          </View>
          <View style={styles.actionIconBg}>
            <Ionicons name="arrow-forward" size={20} color="#059669" />
          </View>
        </View>
      </TouchableOpacity>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CARD 3: PROFILE (CLICKABLE - REPLACES OLD HISTORY CARD)               */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <TouchableOpacity
        style={[styles.card, styles.cardProfile]}
        onPress={() => navigation.navigate('Profile')}
        activeOpacity={0.88}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBg, { backgroundColor: '#F5F3FF' }]}>
              <Ionicons name="person" size={26} color="#7C3AED" />
            </View>
            <View style={{ marginLeft: 14 }}>
              <Text style={styles.cardTitle}>Profile & History</Text>
              <Text style={styles.cardSub}>Agent identity, details & completed recovery history</Text>
            </View>
          </View>
          <View style={[styles.actionIconBg, { backgroundColor: '#EDE9FE' }]}>
            <Ionicons name="arrow-forward" size={20} color="#7C3AED" />
          </View>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748B', fontWeight: '500' },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 24,
  },
  greeting: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  name: { fontSize: 22, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  phoneSub: { fontSize: 12, color: '#2563EB', fontWeight: '600', marginTop: 2 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#BFDBFE',
  },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#2563EB' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10,
    marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', flex: 1 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18,
    marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 3,
  },
  cardAssigned: { borderTopWidth: 4, borderTopColor: '#2563EB' },
  cardStart: { borderTopWidth: 4, borderTopColor: '#059669' },
  cardProfile: { borderTopWidth: 4, borderTopColor: '#7C3AED' },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconBg: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  actionIconBg: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center',
    marginLeft: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  cardSub: { fontSize: 12, color: '#64748B', fontWeight: '500', marginTop: 2 },
  badgeViewOnly: {
    backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, borderColor: '#CBD5E1',
  },
  badgeViewOnlyText: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 0.5 },
  emptyState: {
    alignItems: 'center', paddingVertical: 24,
  },
  emptyStateText: { marginTop: 8, fontSize: 13, color: '#64748B', fontWeight: '500' },
  assignmentsList: { marginTop: 14 },
  taskItem: {
    backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0',
  },
  taskItemHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6,
  },
  customerName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  statusPill: {
    backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: { fontSize: 10, fontWeight: '700', color: '#1D4ED8' },
  taskDetailRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  detailIcon: { marginRight: 6 },
  detailText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  addressText: { fontSize: 11, color: '#64748B', flex: 1 },
  financialRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 10,
    marginTop: 8, borderWidth: 1, borderColor: '#E2E8F0',
  },
  financialCol: { alignItems: 'center' },
  financialLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  financialValue: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginTop: 2 },
});
