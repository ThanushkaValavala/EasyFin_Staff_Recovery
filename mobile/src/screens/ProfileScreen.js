import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from '../api';

const money = (n) =>
  '\u20B9' + String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function ProfileScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));
      const dash = await apiGet('/analytics/dashboard'); 
      setStats(dash.stats);
    } catch (e) {
      setError(e.message === 'Network request failed' ? 'Cannot reach server.' : e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Sign Out', 
        style: 'destructive',
        onPress: async () => {
          await SecureStore.deleteItemAsync('token');
          await SecureStore.deleteItemAsync('staff');
          navigation.replace('Login');
        }
      }
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /></View>;

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

      <View style={styles.profileHeader}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>{staff?.name ? staff.name.charAt(0).toUpperCase() : 'S'}</Text>
        </View>
        <Text style={styles.profileName}>{staff?.name || 'Staff Name'}</Text>
        <Text style={styles.profileRole}>Recovery Agent</Text>
        
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons name="id-card-outline" size={16} color="#64748B" />
            <Text style={styles.infoText}>{staff?.employeeId || 'N/A'}</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="call-outline" size={16} color="#64748B" />
            <Text style={styles.infoText}>{staff?.phone || 'N/A'}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Performance Overview</Text>
      <View style={styles.statGroup}>
        <View style={styles.statRow}>
          <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}><Ionicons name="briefcase-outline" size={20} color="#2563EB" /></View>
          <Text style={styles.statLabel}>Total Cases Handled</Text>
          <Text style={styles.statVal}>{stats?.totalAssigned || 0}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}><Ionicons name="checkmark-done-outline" size={20} color="#10B981" /></View>
          <Text style={styles.statLabel}>Fully Recovered</Text>
          <Text style={styles.statVal}>{stats?.completedCases || 0}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <View style={[styles.iconBox, { backgroundColor: '#F5F3FF' }]}><Ionicons name="cash-outline" size={20} color="#8B5CF6" /></View>
          <Text style={styles.statLabel}>Total Collected</Text>
          <Text style={styles.statVal}>{money(stats?.totalRecoveredAmount)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statRow}>
          <View style={[styles.iconBox, { backgroundColor: '#FFFBEB' }]}><Ionicons name="today-outline" size={20} color="#F59E0B" /></View>
          <Text style={styles.statLabel}>Collected Today</Text>
          <Text style={styles.statVal}>{money(stats?.todayRecoveredAmount)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color="#DC2626" />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileHeader: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, padding: 24, marginBottom: 24, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 2 },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2563EB', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 4, borderColor: '#EFF6FF' },
  avatarLargeText: { fontSize: 32, color: '#fff', fontWeight: '800' },
  profileName: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  profileRole: { fontSize: 14, color: '#64748B', fontWeight: '500', marginBottom: 16 },
  infoRow: { flexDirection: 'row', gap: 16 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  infoText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 12, marginLeft: 4 },
  statGroup: { backgroundColor: '#fff', borderRadius: 20, padding: 8, marginBottom: 32, borderWidth: 1, borderColor: '#F1F5F9' },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  statLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#334155' },
  statVal: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginLeft: 68, marginRight: 12 },
  errorBox: { backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5' },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  logoutBtn: { flexDirection: 'row', backgroundColor: '#FEF2F2', padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#FECACA' },
  logoutText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },
});