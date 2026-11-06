import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from '../api';

const money = (n) =>
  '\u20B9' + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function StatCard({ label, value, color, icon, onPress }) {
  return (
    <TouchableOpacity style={styles.statCard} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <View style={styles.statIcon}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('staff');
    navigation.replace('Login');
  }, [navigation]);

  const load = useCallback(async () => {
    setError('');
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));
      const dash = await apiGet('/analytics/dashboard');
      setStats(dash.stats);
    } catch (e) {
      if (e.status === 401) {
        await logout();
        return;
      }
      setError(e.message === 'Network request failed' ? 'Cannot reach the server. Check Wi-Fi.' : e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [logout]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /></View>;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{staff ? staff.name : 'Staff'}</Text>
        </View>
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarSmallText}>{staff?.name?.charAt(0) || 'S'}</Text>
        </View>
      </View>

      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

      {stats && (
        <View style={styles.grid}>
          <StatCard label="Assigned Today" value={stats.totalAssignedToday} icon="calendar-outline" color="#2563EB" onPress={() => navigation.navigate('Cases', { status: 'TODAY' })} />
          <StatCard label="Pending Cases" value={stats.pendingCases} icon="time-outline" color="#F59E0B" onPress={() => navigation.navigate('Cases', { status: 'PENDING' })} />
          <StatCard label="Partially Paid" value={stats.partialCases} icon="pie-chart-outline" color="#8B5CF6" onPress={() => navigation.navigate('Cases', { status: 'PARTIALLY_RECOVERED' })} />
          <StatCard label="Fully Recovered" value={stats.completedCases} icon="checkmark-done-outline" color="#10B981" onPress={() => navigation.navigate('Cases', { status: 'COMPLETED' })} />
          
          <TouchableOpacity style={styles.fullWidthCard} onPress={() => navigation.navigate('CollectionsHistory', { filter: 'TODAY' })}>
            <View>
              <Text style={styles.cardLabel}>Today's Collection</Text>
              <Text style={styles.cardAmount}>{money(stats.todayRecoveredAmount)}</Text>
            </View>
            <Ionicons name="trending-up" size={24} color="#10B981" />
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  greeting: { fontSize: 14, color: '#64748B', fontWeight: '500', marginBottom: 2 },
  name: { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  avatarSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E0E7FF', justifyContent: 'center', alignItems: 'center' },
  avatarSmallText: { fontSize: 20, fontWeight: '700', color: '#2563EB' },
  errorBox: { backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5' },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 24 },
  statCard: { width: '48%', backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  statIcon: { marginBottom: 12 },
  statValue: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  statLabel: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  fullWidthCard: { width: '100%', backgroundColor: '#0F172A', borderRadius: 16, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 6 },
  cardLabel: { fontSize: 14, color: '#94A3B8', fontWeight: '500', marginBottom: 4 },
  cardAmount: { fontSize: 28, fontWeight: '800', color: '#fff' },
});