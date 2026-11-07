import { useCallback, useEffect, useState } from 'react';
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
  const [assignedCount, setAssignedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));

      // Try fetching assigned task count from backend
      try {
        const dash = await apiGet('/analytics/dashboard');
        setAssignedCount(dash.stats?.totalAssignedToday ?? dash.stats?.totalAssigned ?? null);
      } catch (e) {
        // Non-fatal — we just won't show a count number
        console.warn('[Dashboard] analytics fetch failed:', e.message);
      }

      // Sync any pending offline sessions in the background
      syncPendingSessions().catch(() => {});
    } catch (e) {
      setError(e.message === 'Network request failed'
        ? 'Cannot reach the server. Check Wi-Fi.'
        : e.message);
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
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{staff ? staff.name : 'Agent'}</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{staff?.name?.charAt(0)?.toUpperCase() || 'A'}</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Card A: Assigned Tasks (view-only) ─────────────────────────── */}
      <View style={[styles.card, styles.cardAssigned]}>
        <View style={styles.cardIconRow}>
          <View style={[styles.iconBg, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="briefcase-outline" size={28} color="#2563EB" />
          </View>
        </View>
        <Text style={styles.cardTitle}>Assigned Tasks</Text>
        <Text style={styles.cardCount}>
          {assignedCount !== null ? assignedCount : '—'}
        </Text>
        <Text style={styles.cardSub}>Tasks assigned to you today</Text>
        <View style={styles.viewOnlyBadge}>
          <Text style={styles.viewOnlyText}>VIEW ONLY</Text>
        </View>
      </View>

      {/* ── Card B: Start Recovery (clickable) ─────────────────────────── */}
      <TouchableOpacity
        style={[styles.card, styles.cardStart]}
        onPress={() => navigation.navigate('Cases')}
        activeOpacity={0.85}
      >
        <View style={styles.cardIconRow}>
          <View style={[styles.iconBg, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="play-circle-outline" size={28} color="#10B981" />
          </View>
          <Ionicons name="chevron-forward" size={20} color="#10B981" />
        </View>
        <Text style={styles.cardTitle}>Start Recovery</Text>
        <Text style={styles.cardSub}>Begin a new recovery session</Text>
      </TouchableOpacity>

      {/* ── Card C: Profile (clickable) ────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.card, styles.cardHistory]}
        onPress={() => navigation.navigate('Profile')}
        activeOpacity={0.85}
      >
        <View style={styles.cardIconRow}>
          <View style={[styles.iconBg, { backgroundColor: '#F5F3FF' }]}>
            <Ionicons name="person-circle-outline" size={28} color="#7C3AED" />
          </View>
          <Ionicons name="chevron-forward" size={20} color="#7C3AED" />
        </View>
        <Text style={styles.cardTitle}>Profile</Text>
        <Text style={styles.cardSub}>View your profile and recovery history</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 28,
  },
  greeting: { fontSize: 14, color: '#64748B', fontWeight: '500', marginBottom: 2 },
  name: { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#E0E7FF', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#2563EB' },
  errorBox: {
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8,
    marginBottom: 16, borderWidth: 1, borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    marginBottom: 16, borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  cardAssigned: { borderLeftWidth: 4, borderLeftColor: '#2563EB' },
  cardStart: { borderLeftWidth: 4, borderLeftColor: '#10B981' },
  cardHistory: { borderLeftWidth: 4, borderLeftColor: '#7C3AED' },
  cardIconRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  iconBg: {
    width: 52, height: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  cardCount: { fontSize: 36, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  cardSub: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  viewOnlyBadge: {
    marginTop: 10, alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  viewOnlyText: { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.5 },
});
