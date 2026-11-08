import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from '../api';
import { BADGE_COLORS } from '../utils/nlpSummarizer';
import { cacheHistory, getCachedHistory, getPendingSessions, syncPendingSessions } from '../utils/offlineStore';

const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};

const fmtTime = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  const h = x.getHours() % 12 || 12;
  return `${p(h)}:${p(x.getMinutes())} ${x.getHours() < 12 ? 'AM' : 'PM'}`;
};

const fmtDuration = (s) => {
  if (!s && s !== 0) return '-';
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return (h > 0 ? `${h}h ` : '') + `${pad(m)}m`;
};

const fmtDistance = (m) => {
  if (!m && m !== 0) return '-';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
};

function NlpBadge({ category, summary }) {
  const colors = BADGE_COLORS[category] || BADGE_COLORS.GENERAL;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {summary || 'Customer Contacted - General Follow-up'}
      </Text>
    </View>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelGroup}>
        <Ionicons name={icon} size={14} color="#64748B" style={{ marginRight: 6 }} />
        <Text style={styles.infoLabel}>{label}:</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={1}>{value || '-'}</Text>
    </View>
  );
}

function SessionCard({ session }) {
  const vehicleLabel = session.vehicleType
    ? session.vehicleType.charAt(0).toUpperCase() + session.vehicleType.slice(1).toLowerCase()
    : 'Walk';

  const nlpCategory = session.nlpCategory || 'GENERAL';
  const nlpSummary = session.nlpSummary || 'Customer Contacted - General Follow-up';
  const isPending = session._syncStatus === 'PENDING';

  const startLoc = session.startLocation ? `${session.startLocation.latitude?.toFixed(4)}, ${session.startLocation.longitude?.toFixed(4)}` : null;
  const endLoc = session.endLocation ? `${session.endLocation.latitude?.toFixed(4)}, ${session.endLocation.longitude?.toFixed(4)}` : null;

  return (
    <View style={[styles.sessionCard, isPending && styles.sessionCardPending]}>
      {isPending ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={13} color="#92400E" style={{ marginRight: 4 }} />
          <Text style={styles.pendingText}>Pending Sync to Cloud</Text>
        </View>
      ) : null}

      <View style={styles.sessionHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={13} color="#2563EB" style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>{fmtDate(session.endTime || session.startTime)}</Text>
        </View>
        <View style={[styles.modeBadge, {
          backgroundColor: vehicleLabel === 'Walk' ? '#DCFCE7' : '#EFF6FF',
          borderColor: vehicleLabel === 'Walk' ? '#86EFAC' : '#BFDBFE',
        }]}>
          <Text style={[styles.modeText, {
            color: vehicleLabel === 'Walk' ? '#15803D' : '#1E40AF',
          }]}>{vehicleLabel}</Text>
        </View>
      </View>

      {/* NLP Summary Badge */}
      <NlpBadge category={nlpCategory} summary={nlpSummary} />

      <View style={styles.sessionInfoGrid}>
        <InfoRow icon="time-outline" label="Start Time" value={fmtTime(session.startTime)} />
        <InfoRow icon="checkmark-circle-outline" label="End Time" value={fmtTime(session.endTime)} />
        <InfoRow icon="hourglass-outline" label="Duration" value={fmtDuration(session.durationSeconds)} />
        <InfoRow icon="navigate-outline" label="Distance" value={fmtDistance(session.distanceMeters)} />
        {session.vehicleNumber ? (
          <InfoRow icon="car-outline" label="Vehicle Reg" value={session.vehicleNumber} />
        ) : null}
        {startLoc ? (
          <InfoRow icon="location-outline" label="Start Loc" value={startLoc} />
        ) : null}
        {endLoc ? (
          <InfoRow icon="flag-outline" label="End Loc" value={endLoc} />
        ) : null}
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [pendingSessions, setPendingSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));

      const pendings = await getPendingSessions();
      setPendingSessions(pendings || []);

      // Load profile info from /agent/profile or /auth/profile
      try {
        const profRes = await apiGet('/agent/profile');
        if (profRes && profRes.staff) {
          setStaff(profRes.staff);
          await SecureStore.setItemAsync('staff', JSON.stringify(profRes.staff));
        }
      } catch (pe) {
        try {
          const authProf = await apiGet('/auth/profile');
          if (authProf && authProf.staff) {
            setStaff(authProf.staff);
            await SecureStore.setItemAsync('staff', JSON.stringify(authProf.staff));
          }
        } catch (err2) {}
      }

      // Load recovery history for authenticated agent
      try {
        const res = await apiGet('/recovery/history');
        const list = res.sessions || [];
        setSessions(list);
        await cacheHistory(list);
        setIsOfflineMode(false);
      } catch (he) {
        console.warn('[ProfileScreen] History fetch failed, falling back to cache:', he.message);
        const cached = await getCachedHistory();
        setSessions(cached);
        setIsOfflineMode(true);
      }
    } catch (e) {
      console.warn('[ProfileScreen] loadData error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingSessions();
      if (synced > 0) {
        Alert.alert('Sync Complete', `Successfully synced ${synced} pending recovery session(s).`);
      } else if (failed > 0) {
        Alert.alert('Sync Incomplete', `${failed} session(s) could not be synced. Check connectivity and retry.`);
      } else {
        Alert.alert('Sync Status', 'All recovery records are already up to date.');
      }
      await loadData();
    } catch (e) {
      Alert.alert('Sync Error', e.message || 'Could not synchronize.');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await SecureStore.deleteItemAsync('token');
          await SecureStore.deleteItemAsync('staff');
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  // Combine pending offline sessions with backend sessions
  const allSessions = [
    ...pendingSessions.filter(p => !sessions.some(s => s.sessionId === p.sessionId || s.deviceSessionId === p.deviceSessionId)),
    ...sessions,
  ];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading profile...</Text>
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
          onRefresh={() => { setRefreshing(true); loadData(); }}
          colors={['#2563EB']}
        />
      }
    >
      {/* ── AGENT INFORMATION CARD ────────────────────────────────────── */}
      <View style={styles.profileCard}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{staff?.name?.charAt(0)?.toUpperCase() || 'A'}</Text>
          </View>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Text style={styles.agentName}>{staff?.name || 'Recovery Agent'}</Text>
            <Text style={styles.agentRole}>Field Recovery Officer</Text>
            <View style={styles.phoneBadge}>
              <Ionicons name="call" size={12} color="#2563EB" style={{ marginRight: 4 }} />
              <Text style={styles.phoneText}>{staff?.phone || '-'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.profileMetaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Employee ID</Text>
            <Text style={styles.metaValue}>{staff?.employeeId || '-'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Assigned Zone</Text>
            <Text style={styles.metaValue}>{staff?.assignedArea || 'Main Branch'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Recoveries</Text>
            <Text style={styles.metaValue}>
              {typeof staff?.recoveryCount === 'number'
                ? staff.recoveryCount
                : allSessions.filter((s) => !s._syncStatus).length}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Distance</Text>
            <Text style={styles.metaValue}>
              {typeof staff?.totalDistanceKm === 'number'
                ? `${staff.totalDistanceKm.toFixed(2)} km`
                : '-'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color="#DC2626" style={{ marginRight: 6 }} />
          <Text style={styles.logoutBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Bar if pending sessions exist */}
      {pendingSessions.length > 0 ? (
        <View style={styles.syncNoticeBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.syncNoticeTitle}>
              {pendingSessions.length} Pending Offline Recovery{pendingSessions.length > 1 ? 'ies' : ''}
            </Text>
            <Text style={styles.syncNoticeSub}>Stored in SecureStore — ready to sync to MongoDB</Text>
          </View>
          <TouchableOpacity style={styles.syncNowBtn} onPress={handleSyncNow} disabled={syncing}>
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.syncNowBtnText}>Sync Now</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {isOfflineMode ? (
        <View style={styles.offlineNotice}>
          <Ionicons name="cloud-offline" size={16} color="#92400E" style={{ marginRight: 6 }} />
          <Text style={styles.offlineNoticeText}>Viewing cached recovery history (offline)</Text>
        </View>
      ) : null}

      {/* ── COMPLETED RECOVERY HISTORY ─────────────────────────────────── */}
      <View style={styles.historyHeaderRow}>
        <Text style={styles.historySectionTitle}>Completed Recovery History</Text>
        <Text style={styles.historyCountText}>{allSessions.length} Total</Text>
      </View>

      {allSessions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="time-outline" size={38} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No Completed Recoveries Yet</Text>
          <Text style={styles.emptySub}>Recoveries you complete will appear here with NLP summaries.</Text>
        </View>
      ) : (
        allSessions.map((session, idx) => (
          <SessionCard key={session._id || session.sessionId || session.deviceSessionId || idx} session={session} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 13, color: '#64748B' },
  profileCard: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#BFDBFE',
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#2563EB' },
  agentName: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  agentRole: { fontSize: 12, color: '#64748B', fontWeight: '500', marginTop: 2 },
  phoneBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
    alignSelf: 'flex-start', marginTop: 6,
  },
  phoneText: { fontSize: 12, fontWeight: '700', color: '#1E293B' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 16 },
  profileMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14, gap: 8 },
  metaItem: { minWidth: '30%' },
  metaLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  metaValue: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, backgroundColor: '#FEF2F2',
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  logoutBtnText: { color: '#DC2626', fontSize: 13, fontWeight: '700' },
  syncNoticeBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D',
    marginBottom: 16,
  },
  syncNoticeTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  syncNoticeSub: { fontSize: 11, color: '#B45309', marginTop: 2 },
  syncNowBtn: {
    backgroundColor: '#D97706', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, marginLeft: 10,
  },
  syncNowBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  offlineNotice: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC',
    padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  offlineNoticeText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  historyHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  historySectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  historyCountText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  sessionCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  sessionCardPending: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    alignSelf: 'flex-start', marginBottom: 10,
  },
  pendingText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  sessionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  dateBadge: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  modeBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  modeText: { fontSize: 11, fontWeight: '800' },
  badge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, marginBottom: 12, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  sessionInfoGrid: { gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabelGroup: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  infoValue: { fontSize: 12, fontWeight: '600', color: '#0F172A' },
  emptyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 30,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155', marginTop: 10 },
  emptySub: { fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 4 },
});
