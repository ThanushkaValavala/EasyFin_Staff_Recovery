import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '../api';
import { cacheHistory, getCachedHistory, getPendingSessions } from '../utils/offlineStore';
import { summarize, BADGE_COLORS } from '../utils/nlpSummarizer';

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

function NlpBadge({ category, summary }) {
  const colors = BADGE_COLORS[category] || BADGE_COLORS.GENERAL;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{summary}</Text>
    </View>
  );
}

function SessionCard({ session }) {
  const vehicleLabel = session.vehicleType
    ? session.vehicleType.charAt(0) + session.vehicleType.slice(1).toLowerCase()
    : '-';

  // Compute NLP from cached or stored value
  const nlpCategory = session.nlpCategory || summarize(session.rawRemarks || session.remarks || '').nlpCategory;
  const nlpSummary = session.nlpSummary || summarize(session.rawRemarks || session.remarks || '').nlpSummary;

  const isPending = session._syncStatus === 'PENDING';

  return (
    <View style={[styles.card, isPending && styles.cardPending]}>
      {isPending ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={14} color="#92400E" style={{ marginRight: 4 }} />
          <Text style={styles.pendingText}>Pending sync to cloud</Text>
        </View>
      ) : null}

      <View style={styles.cardHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={14} color="#2563EB" style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>{fmtDate(session.endTime || session.startTime)}</Text>
        </View>
        <View style={[styles.modeBadge, { backgroundColor: vehicleLabel === 'Walk' ? '#DCFCE7' : '#EFF6FF' }]}>
          <Text style={[styles.modeText, { color: vehicleLabel === 'Walk' ? '#15803D' : '#1E40AF' }]}>
            {vehicleLabel}
          </Text>
        </View>
      </View>

      <NlpBadge category={nlpCategory} summary={nlpSummary} />

      <View style={styles.infoGrid}>
        <InfoRow icon="time-outline" label="Start time" value={fmtTime(session.startTime)} />
        <InfoRow icon="checkmark-circle-outline" label="End time" value={fmtTime(session.endTime)} />
        <InfoRow icon="hourglass-outline" label="Duration" value={fmtDuration(session.durationSeconds)} />
        <InfoRow icon="navigate-outline" label="Distance" value={fmtDistance(session.distanceMeters)} />
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
      <Ionicons name={icon} size={14} color="#64748B" style={{ marginRight: 6 }} />
      <Text style={styles.infoLabel}>{label}: </Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function RecoveryHistoryScreen() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isOffline, setIsOffline] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setIsOffline(false);
    try {
      // MongoDB is the source of truth
      const res = await apiGet('/recovery/history');
      const cloudSessions = res.sessions || [];
      setSessions(cloudSessions);
      await cacheHistory(cloudSessions);
    } catch (e) {
      console.warn('[RecoveryHistory] backend fetch failed:', e.message);
      setIsOffline(true);

      // Fallback: show locally cached + pending sessions
      const [cached, pending] = await Promise.all([getCachedHistory(), getPendingSessions()]);
      // Merge: pending sessions not yet in cloud
      const pendingIds = new Set(pending.map((s) => s.deviceSessionId || s.sessionId));
      const filtered = cached.filter((s) => !pendingIds.has(s.deviceSessionId || s.sessionId));
      const merged = [...pending, ...filtered].sort(
        (a, b) => new Date(b.endTime || b.startTime) - new Date(a.endTime || a.startTime)
      );
      setSessions(merged);

      if (e.message !== 'Network request failed') {
        setError(e.message || 'Could not load history.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
    >
      <Text style={styles.pageTitle}>Recovery History</Text>

      {isOffline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color="#92400E" style={{ marginRight: 6 }} />
          <Text style={styles.offlineText}>Offline — showing locally saved sessions</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {sessions.length === 0 && !error ? (
        <View style={styles.emptyBox}>
          <Ionicons name="document-outline" size={48} color="#CBD5E1" />
          <Text style={styles.emptyText}>No completed recoveries yet.</Text>
          <Text style={styles.emptySubText}>Complete a recovery to see it here.</Text>
        </View>
      ) : null}

      {sessions.map((s, i) => (
        <SessionCard key={s._id || s.sessionId || s.deviceSessionId || i} session={s} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 16 },
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
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#475569', marginTop: 12 },
  emptySubText: { fontSize: 13, color: '#94A3B8', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  cardPending: { borderColor: '#FDE68A', borderWidth: 1.5 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8,
    alignSelf: 'flex-start',
  },
  pendingText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  dateBadge: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '600', color: '#2563EB' },
  modeBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  modeText: { fontSize: 12, fontWeight: '700' },
  badge: {
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 12, borderWidth: 1, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 13, fontWeight: '700' },
  infoGrid: { gap: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#0F172A', fontWeight: '600', flex: 1 },
});
