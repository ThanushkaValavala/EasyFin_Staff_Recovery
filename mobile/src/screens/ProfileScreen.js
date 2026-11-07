import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from '../api';
import { summarize, BADGE_COLORS } from '../utils/nlpSummarizer';
import { cacheHistory, getCachedHistory, getPendingSessions, syncPendingSessions } from '../utils/offlineStore';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return p(x.getDate()) + '/' + p(x.getMonth() + 1) + '/' + x.getFullYear();
};

const fmtTime = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  const h = x.getHours() % 12 || 12;
  return p(h) + ':' + p(x.getMinutes()) + ' ' + (x.getHours() < 12 ? 'AM' : 'PM');
};

const fmtDuration = (s) => {
  if (!s && s !== 0) return '-';
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return (h > 0 ? h + 'h ' : '') + pad(m) + 'm';
};

const fmtDistance = (m) => {
  if (!m && m !== 0) return '-';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
};

// ── NLP Badge ────────────────────────────────────────────────────────────────
function NlpBadge({ category, summary }) {
  const colors = BADGE_COLORS[category] || BADGE_COLORS.GENERAL;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{summary}</Text>
    </View>
  );
}

// ── Session Card ─────────────────────────────────────────────────────────────
function SessionCard({ session }) {
  const vehicleLabel = session.vehicleType
    ? session.vehicleType.charAt(0).toUpperCase() + session.vehicleType.slice(1).toLowerCase()
    : '-';
  const nlpCategory = session.nlpCategory
    || summarize(session.rawRemarks || session.remarks || '').nlpCategory;
  const nlpSummary = session.nlpSummary
    || summarize(session.rawRemarks || session.remarks || '').nlpSummary;
  const isPending = session._syncStatus === 'PENDING';

  return (
    <View style={[styles.sessionCard, isPending && styles.sessionCardPending]}>
      {isPending ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={13} color="#92400E" style={{ marginRight: 4 }} />
          <Text style={styles.pendingText}>Pending sync to cloud</Text>
        </View>
      ) : null}

      <View style={styles.sessionHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={13} color="#2563EB" style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>{fmtDate(session.endTime || session.startTime)}</Text>
        </View>
        <View style={[styles.modeBadge, {
          backgroundColor: vehicleLabel === 'Walk' ? '#DCFCE7' : '#EFF6FF'
        }]}>
          <Text style={[styles.modeText, {
            color: vehicleLabel === 'Walk' ? '#15803D' : '#1E40AF'
          }]}>{vehicleLabel}</Text>
        </View>
      </View>

      <NlpBadge category={nlpCategory} summary={nlpSummary} />

      <View style={styles.sessionInfoGrid}>
        <InfoRow icon="time-outline"              label="Start"    value={fmtTime(session.startTime)} />
        <InfoRow icon="checkmark-circle-outline"  label="End"      value={fmtTime(session.endTime)} />
        <InfoRow icon="hourglass-outline"          label="Duration" value={fmtDuration(session.durationSeconds)} />
        <InfoRow icon="navigate-outline"           label="Distance" value={fmtDistance(session.distanceMeters)} />
        {session.vehicleNumber ? (
          <InfoRow icon="car-outline" label="Vehicle" value={session.vehicleNumber} />
        ) : null}
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={13} color="#64748B" style={{ marginRight: 5 }} />
      <Text style={styles.infoLabel}>{label}: </Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isOffline, setIsOffline] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setIsOffline(false);
    try {
      // Staff info from SecureStore (set at login)
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));

      // Sync any pending offline sessions first
      syncPendingSessions().catch(() => {});

      // History — MongoDB is source of truth
      const res = await apiGet('/recovery/history');
      const cloudSessions = res.sessions || [];
      setSessions(cloudSessions);
      await cacheHistory(cloudSessions);
    } catch (e) {
      console.warn('[Profile] backend fetch failed:', e.message);
      setIsOffline(true);

      // Fallback: cached + pending
      const [cached, pending] = await Promise.all([getCachedHistory(), getPendingSessions()]);
      const pendingIds = new Set(pending.map((s) => s.deviceSessionId || s.sessionId));
      const filtered = cached.filter((s) => !pendingIds.has(s.deviceSessionId || s.sessionId));
      const merged = [...pending, ...filtered].sort(
        (a, b) => new Date(b.endTime || b.startTime) - new Date(a.endTime || a.startTime)
      );
      setSessions(merged);
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
        },
      },
    ]);
  };

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
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
    >
      {/* ── Agent Details ─────────────────────────────────────────────── */}
      <View style={styles.agentCard}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarText}>
            {staff?.name ? staff.name.charAt(0).toUpperCase() : 'A'}
          </Text>
        </View>
        <Text style={styles.agentName}>{staff?.name || 'Agent'}</Text>
        <Text style={styles.agentRole}>Recovery Agent</Text>

        <View style={styles.agentMeta}>
          {staff?.phone ? (
            <View style={styles.metaItem}>
              <Ionicons name="call-outline" size={14} color="#64748B" />
              <Text style={styles.metaText}>{staff.phone}</Text>
            </View>
          ) : null}
          {staff?.employeeId ? (
            <View style={styles.metaItem}>
              <Ionicons name="id-card-outline" size={14} color="#64748B" />
              <Text style={styles.metaText}>{staff.employeeId}</Text>
            </View>
          ) : null}
          {staff?.assignedArea ? (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={14} color="#64748B" />
              <Text style={styles.metaText}>{staff.assignedArea}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Offline banner ────────────────────────────────────────────── */}
      {isOffline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={15} color="#92400E" style={{ marginRight: 6 }} />
          <Text style={styles.offlineText}>Offline — showing locally saved sessions</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Completed Recovery History ────────────────────────────────── */}
      <Text style={styles.sectionTitle}>
        Completed Recoveries
        {sessions.length > 0 ? (
          <Text style={styles.sectionCount}> ({sessions.length})</Text>
        ) : null}
      </Text>

      {sessions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="document-outline" size={44} color="#CBD5E1" />
          <Text style={styles.emptyText}>No completed recoveries yet.</Text>
        </View>
      ) : (
        sessions.map((s, i) => (
          <SessionCard
            key={s._id || s.sessionId || s.deviceSessionId || i}
            session={s}
          />
        ))
      )}

      {/* ── Sign Out ──────────────────────────────────────────────────── */}
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

  // Agent card
  agentCard: {
    alignItems: 'center', backgroundColor: '#fff', borderRadius: 20,
    padding: 24, marginBottom: 20, borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  avatarLarge: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#2563EB',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    borderWidth: 3, borderColor: '#EFF6FF',
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  agentName: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  agentRole: { fontSize: 13, color: '#64748B', fontWeight: '500', marginBottom: 14 },
  agentMeta: { width: '100%', gap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: '#475569', fontWeight: '500' },

  // Banners
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3',
    borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#FDE047',
  },
  offlineText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  errorBox: {
    backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8,
    marginBottom: 12, borderWidth: 1, borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500' },

  // Section header
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 12 },
  sectionCount: { fontSize: 14, fontWeight: '600', color: '#64748B' },

  // Session cards
  sessionCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  sessionCardPending: { borderColor: '#FDE68A', borderWidth: 1.5 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 8,
    alignSelf: 'flex-start',
  },
  pendingText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  sessionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  dateBadge: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '600', color: '#2563EB' },
  modeBadge: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 3 },
  modeText: { fontSize: 12, fontWeight: '700' },
  badge: {
    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: 10, borderWidth: 1, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  sessionInfoGrid: { gap: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  infoValue: { fontSize: 12, color: '#0F172A', fontWeight: '600', flex: 1 },

  // Empty
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#475569', marginTop: 10 },

  // Logout
  logoutBtn: {
    flexDirection: 'row', backgroundColor: '#FEF2F2', padding: 16,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 24, borderWidth: 1, borderColor: '#FECACA',
  },
  logoutText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },
});
