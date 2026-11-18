import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { apiGet } from '../api';
import { BADGE_COLORS } from '../utils/nlpSummarizer';
import { cacheHistory, getCachedHistory, getPendingSessions, syncPendingSessions } from '../utils/offlineStore';

const memoryAddressCache = new Map();

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

const fmtIdleTime = (s) => {
  if (s == null) return '-';
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (h > 0) return `${h}h ${m}m ${remSec}s`;
  if (m > 0) return `${m}m ${remSec}s`;
  return `${remSec}s`;
};

const fmtDistance = (m) => {
  if (!m && m !== 0) return '-';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
};

// ── Date-filter helpers (copied exactly from RecoveriesPerDayScreen) ──────────

/** Parse a Date and return a local-time date key "YYYY-MM-DD" or null */
function toLocalDateKey(d) {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Parse a user-typed "DD-MM-YYYY" string into a Date (start of that local day) or null */
function parseUserDate(str) {
  if (!str || str.length !== 10) return null;
  const [dd, mm, yyyy] = str.split('-');
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Format a Date as "DD-MM-YYYY" */
function formatDDMMYYYY(date) {
  if (!date || isNaN(date.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}-${p(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** Returns a Date at 23:59:59.999 local time for the given date */
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

const CHIPS = ['Today', 'Last 7 days', 'This month', 'All'];

function chipRange(chip) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (chip === 'Today') {
    return { from: today, to: endOfDay(today) };
  }
  if (chip === 'Last 7 days') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from, to: endOfDay(today) };
  }
  if (chip === 'This month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from, to: endOfDay(today) };
  }
  // 'All'
  return { from: null, to: null };
}

/** Format a "YYYY-MM-DD" key as a long label like "Wed, 18 Nov 2026" */
function keyToLongLabel(key) {
  const [y, m, d] = key.split('-');
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${parseInt(d, 10)} ${months[date.getMonth()]} ${y}`;
}

/** Format a "YYYY-MM-DD" key as "18 Nov 2026" (no day-of-week) */
function keyToShortLabel(key) {
  const [y, m, d] = key.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function NlpBadge({ category, summary }) {
  const colors = BADGE_COLORS[category] || BADGE_COLORS.GENERAL;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {summary || ''}
      </Text>
    </View>
  );
}

function InfoRow({ icon, label, value, wrapValue }) {
  return (
    <View style={[styles.infoRow, wrapValue && styles.infoRowWrap]}>
      <View style={[styles.infoLabelGroup, wrapValue && { flexShrink: 0 }]}>
        <Ionicons name={icon} size={14} color="#64748B" style={{ marginRight: 6 }} />
        <Text style={styles.infoLabel}>{label}:</Text>
      </View>
      {wrapValue ? (
        <View style={styles.infoValueWrapContainer}>
          <Text style={styles.infoValueWrap} numberOfLines={2} ellipsizeMode="tail">{value || '-'}</Text>
        </View>
      ) : (
        <Text style={styles.infoValue} numberOfLines={1}>{value || '-'}</Text>
      )}
    </View>
  );
}

export function SessionCard({ session }) {
  const vehicleLabel = session.vehicleType
    ? session.vehicleType.charAt(0).toUpperCase() + session.vehicleType.slice(1).toLowerCase()
    : 'Walk';

  const nlpCategory = session.nlpCategory || 'GENERAL';
  const nlpSummary = session.nlpSummary || '';
  const isPending = session._syncStatus === 'PENDING';

  const startLoc = session.startLocation ? `${session.startLocation.latitude?.toFixed(4)}, ${session.startLocation.longitude?.toFixed(4)}` : null;
  const endLoc = session.endLocation ? `${session.endLocation.latitude?.toFixed(4)}, ${session.endLocation.longitude?.toFixed(4)}` : null;

  const [lazyStartAddress, setLazyStartAddress] = useState(
    () => session.startAddress || (session.startLocation ? memoryAddressCache.get(`${session.startLocation.latitude},${session.startLocation.longitude}`) : null)
  );
  const [lazyEndAddress, setLazyEndAddress] = useState(
    () => session.endAddress || (session.endLocation ? memoryAddressCache.get(`${session.endLocation.latitude},${session.endLocation.longitude}`) : null)
  );

  useEffect(() => {
    let active = true;
    if (!session.startAddress && session.startLocation?.latitude != null && session.startLocation?.longitude != null) {
      const key = `${session.startLocation.latitude},${session.startLocation.longitude}`;
      if (memoryAddressCache.has(key)) {
        setLazyStartAddress(memoryAddressCache.get(key));
      } else {
        Location.reverseGeocodeAsync({
          latitude: session.startLocation.latitude,
          longitude: session.startLocation.longitude,
        }).then((r) => {
          if (!active) return;
          if (r && r[0]) {
            const a = r[0];
            const cityOrSub = a.subregion || a.city || '';
            const parts = [a.name, a.street, cityOrSub].filter(Boolean);
            const line = parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
            if (line) {
              memoryAddressCache.set(key, line);
              setLazyStartAddress(line);
            }
          }
        }).catch(() => {});
      }
    }

    if (!session.endAddress && session.endLocation?.latitude != null && session.endLocation?.longitude != null) {
      const key = `${session.endLocation.latitude},${session.endLocation.longitude}`;
      if (memoryAddressCache.has(key)) {
        setLazyEndAddress(memoryAddressCache.get(key));
      } else {
        Location.reverseGeocodeAsync({
          latitude: session.endLocation.latitude,
          longitude: session.endLocation.longitude,
        }).then((r) => {
          if (!active) return;
          if (r && r[0]) {
            const a = r[0];
            const cityOrSub = a.subregion || a.city || '';
            const parts = [a.name, a.street, cityOrSub].filter(Boolean);
            const line = parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
            if (line) {
              memoryAddressCache.set(key, line);
              setLazyEndAddress(line);
            }
          }
        }).catch(() => {});
      }
    }

    return () => { active = false; };
  }, [session.startAddress, session.endAddress, session.startLocation, session.endLocation]);

  const displayStart = session.startAddress || lazyStartAddress || startLoc;
  const displayEnd = session.endAddress || lazyEndAddress || endLoc;

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

      {/* Customer-met block (new recoveries) or NLP badge (old recoveries) */}
      {session.customerMet === true ? (
        <View style={styles.customerMetBlock}>
          <Text style={styles.customerMetTitle}>✔ Met the customer</Text>
          {Array.isArray(session.customerNames) && session.customerNames.length > 0 ? (
            <Text style={styles.customerMetDetail}>Names: {session.customerNames.join(', ')}</Text>
          ) : null}
          {session.metAt ? (
            <Text style={styles.customerMetDetail}>Met at: {fmtTime(session.metAt)}</Text>
          ) : null}
        </View>
      ) : session.customerMet === false ? (
        <View style={styles.customerNotMetBlock}>
          <Text style={styles.customerNotMetTitle}>✖ Not met the customer</Text>
          {session.notMetReason ? (
            <Text style={styles.customerNotMetDetail}>Reason: {session.notMetReason}</Text>
          ) : null}
        </View>
      ) : (
        /* customerMet is undefined — old recovery, show existing NLP badge */
        <NlpBadge category={nlpCategory} summary={nlpSummary} />
      )}

      <View style={styles.sessionInfoGrid}>
        <InfoRow icon="time-outline" label="Start Time" value={fmtTime(session.startTime)} />
        <InfoRow icon="checkmark-circle-outline" label="End Time" value={fmtTime(session.endTime)} />
        <InfoRow icon="hourglass-outline" label="Duration" value={fmtDuration(session.durationSeconds)} />
        <InfoRow icon="pause-circle-outline" label="Idle Time" value={fmtIdleTime(session.idleSeconds)} />
        <InfoRow icon="navigate-outline" label="Distance" value={fmtDistance(session.distanceMeters)} />
        {session.vehicleNumber ? (
          <InfoRow icon="car-outline" label="Vehicle Reg" value={session.vehicleNumber} />
        ) : null}
        {displayStart ? (
          <InfoRow icon="location-outline" label="Start Loc" value={displayStart} wrapValue />
        ) : null}
        {displayEnd ? (
          <InfoRow icon="flag-outline" label="End Loc" value={displayEnd} wrapValue />
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

  // ── Date filter state (copied exactly from RecoveriesPerDayScreen) ──────────
  const [selectedChip, setSelectedChip] = useState('Last 7 days');
  const [fromText, setFromText] = useState(() => {
    const { from } = chipRange('Last 7 days');
    return formatDDMMYYYY(from);
  });
  const [toText, setToText] = useState(() => {
    const { to } = chipRange('Last 7 days');
    return formatDDMMYYYY(to);
  });
  const [rangeError, setRangeError] = useState('');

  function handleChip(chip) {
    setSelectedChip(chip);
    setRangeError('');
    const { from, to } = chipRange(chip);
    setFromText(from ? formatDDMMYYYY(from) : '');
    setToText(to ? formatDDMMYYYY(to) : '');
  }

  function handleClear() {
    setSelectedChip('All');
    setRangeError('');
    setFromText('');
    setToText('');
  }

  function handleFromChange(text) {
    setFromText(text);
    setSelectedChip('');
    setRangeError('');
  }

  function handleToChange(text) {
    setToText(text);
    setSelectedChip('');
    setRangeError('');
  }

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

  // ── Computed filter range (copied exactly from RecoveriesPerDayScreen) ───────
  const { fromDate, toDate, error } = useMemo(() => {
    if (selectedChip === 'All' || (!fromText && !toText)) {
      return { fromDate: null, toDate: null, error: '' };
    }
    if (selectedChip && selectedChip !== 'All') {
      const { from, to } = chipRange(selectedChip);
      return { fromDate: from, toDate: to, error: '' };
    }
    const from = parseUserDate(fromText);
    const to = parseUserDate(toText);
    if (!fromText && !toText) return { fromDate: null, toDate: null, error: '' };
    if (fromText && !from) return { fromDate: null, toDate: null, error: 'Invalid "From" date. Use DD-MM-YYYY.' };
    if (toText && !to) return { fromDate: null, toDate: null, error: 'Invalid "To" date. Use DD-MM-YYYY.' };
    const toEnd = to ? endOfDay(to) : null;
    if (from && toEnd && from > toEnd) {
      return { fromDate: null, toDate: null, error: 'From date must be before To date.' };
    }
    return { fromDate: from || null, toDate: toEnd || null, error: '' };
  }, [selectedChip, fromText, toText]);

  // ── Build per-day rows with sessions (copied grouping from RecoveriesPerDayScreen) ──
  const { dayRows, totalInRange } = useMemo(() => {
    const groups = {}; // "YYYY-MM-DD" → [session, ...]

    for (const session of allSessions) {
      const rawDate = session.startTime || session.endTime;
      const key = toLocalDateKey(rawDate);
      if (!key) continue;

      if (fromDate || toDate) {
        const sessionDate = new Date(rawDate);
        if (fromDate && sessionDate < fromDate) continue;
        if (toDate && sessionDate > toDate) continue;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(session);
    }

    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    const dayRows = sortedKeys.map((key) => ({
      dateKey: key,
      count: groups[key].length,
      sessions: groups[key],
    }));
    const totalInRange = dayRows.reduce((sum, r) => sum + r.count, 0);
    return { dayRows, totalInRange };
  }, [allSessions, fromDate, toDate]);

  const activeError = rangeError || error;

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

      {/* ── RECOVERIES SECTION ──────────────────────────────────────────── */}
      <View style={styles.recoveriesSectionHeader}>
        <Text style={styles.recoveriesSectionTitle}>Recoveries</Text>
      </View>

      {/* Filter card – copied exactly from RecoveriesPerDayScreen */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.filterCard}>
          {/* Quick chips */}
          <View style={styles.chipsRow}>
            {CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={[styles.chip, selectedChip === chip && styles.chipActive]}
                onPress={() => handleChip(chip)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedChip === chip && styles.chipTextActive]}>
                  {chip}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* From / To inputs */}
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>From</Text>
              <TextInput
                style={styles.textInput}
                value={fromText}
                onChangeText={handleFromChange}
                placeholder="DD-MM-YYYY"
                keyboardType="numeric"
                maxLength={10}
                placeholderTextColor="#94A3B8"
              />
            </View>
            <View style={styles.inputSeparator} />
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>To</Text>
              <TextInput
                style={styles.textInput}
                value={toText}
                onChangeText={handleToChange}
                placeholder="DD-MM-YYYY"
                keyboardType="numeric"
                maxLength={10}
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          {/* Error message */}
          {activeError ? (
            <Text style={styles.filterErrorText}>{activeError}</Text>
          ) : null}

          {/* Clear button */}
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
            <Ionicons name="close-circle-outline" size={14} color="#64748B" style={{ marginRight: 4 }} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Day list */}
      {dayRows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={38} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No recoveries in this range</Text>
        </View>
      ) : (
        <>
          <View style={styles.listCard}>
            {dayRows.map((row, idx) => (
              <TouchableOpacity
                key={row.dateKey}
                style={[styles.dayRow, idx < dayRows.length - 1 && styles.dayRowBorder]}
                onPress={() => navigation.navigate('DayRecoveries', {
                  dateLabel: keyToShortLabel(row.dateKey),
                  daySessions: row.sessions,
                })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayDate}>{keyToLongLabel(row.dateKey)}</Text>
                  <Text style={styles.dayCountLabel}>
                    {row.count === 1 ? '1 recovery' : `${row.count} recoveries`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total in range:</Text>
            <Text style={styles.totalValue}>{totalInRange}</Text>
          </View>
        </>
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
    overflow: 'hidden',
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
  infoRowWrap: { alignItems: 'flex-start' },
  infoLabelGroup: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  infoValue: { fontSize: 12, fontWeight: '600', color: '#0F172A' },
  infoValueWrapContainer: { flex: 1, minWidth: 0, alignItems: 'flex-end', marginLeft: 8 },
  infoValueWrap: { fontSize: 12, fontWeight: '600', color: '#0F172A', textAlign: 'right' },
  emptyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 30,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155', marginTop: 10 },
  emptySub: { fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 4 },
  recoveriesPerDayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  recoveriesPerDayLeft: { flexDirection: 'row', alignItems: 'center' },
  recoveriesPerDayTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },

  // Customer-met / not-met blocks in SessionCard
  customerMetBlock: {
    backgroundColor: '#F0FDF4', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 12,
  },
  customerMetTitle: { fontSize: 13, fontWeight: '800', color: '#15803D', marginBottom: 4 },
  customerMetDetail: { fontSize: 12, fontWeight: '500', color: '#166534', marginTop: 2 },

  customerNotMetBlock: {
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 12,
  },
  customerNotMetTitle: { fontSize: 13, fontWeight: '800', color: '#DC2626', marginBottom: 4 },
  customerNotMetDetail: { fontSize: 12, fontWeight: '500', color: '#991B1B', marginTop: 2 },

  // ── Recoveries section ──────────────────────────────────────────────────────
  recoveriesSectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  recoveriesSectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },

  // Filter card (copied from RecoveriesPerDayScreen styles)
  filterCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  chipTextActive: { color: '#2563EB' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 11, fontWeight: '600', color: '#64748B', textTransform: 'uppercase', marginBottom: 4 },
  textInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, fontWeight: '600', color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  inputSeparator: { width: 12 },
  filterErrorText: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginBottom: 8 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingVertical: 4, paddingHorizontal: 2,
  },
  clearBtnText: { fontSize: 12, color: '#64748B', fontWeight: '600' },

  // Day list (card + rows)
  listCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1,
    borderColor: '#E2E8F0', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  dayRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  dayRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dayDate: { fontSize: 14, fontWeight: '700', color: '#334155' },
  dayCountLabel: { fontSize: 12, fontWeight: '500', color: '#64748B', marginTop: 2 },

  // Total row
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#BFDBFE', marginBottom: 20,
  },
  totalLabel: { fontSize: 13, fontWeight: '700', color: '#1E40AF' },
  totalValue: { fontSize: 15, fontWeight: '800', color: '#1E40AF' },
});
