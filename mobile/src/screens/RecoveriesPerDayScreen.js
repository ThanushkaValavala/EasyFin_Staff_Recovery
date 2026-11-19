import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '../api';

// ── Date helpers ────────────────────────────────────────────────────────────

/** Parse a Date and return a local-time date key "YYYY-MM-DD" or null */
function toLocalDateKey(d) {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Format a "YYYY-MM-DD" key as "DD-MM-YYYY" for display */
function keyToDisplay(key) {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
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
  // Verify no overflow (e.g. 31-02 rolls over)
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

// ── Chip definitions ─────────────────────────────────────────────────────────

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

// ── Main screen ───────────────────────────────────────────────────────────────

/** Fetch signed voice URL and play it. Errors are handled quietly. */
async function playVoiceNote(sessionId) {
  try {
    const res = await apiGet(`/recovery/sessions/${sessionId}/voice-url`);
    const url = res?.url || res?.signedUrl || res?.voiceUrl;
    if (!url) return;
    const { AudioPlayer } = await import('expo-audio');
    const player = new AudioPlayer(url);
    player.play();
  } catch (e) {
    console.warn('[RecoveriesPerDay] Voice playback error:', e.message);
  }
}

/** Compact session card for the per-day expanded list */
function SessionMiniCard({ session }) {
  const hasMetField = session.customerMet != null;
  let visitedLabel = null;
  if (hasMetField) {
    if (session.customerMet === true || session.customerMet === 'true') {
      const names = Array.isArray(session.customerNames) && session.customerNames.length > 0
        ? session.customerNames.join(', ')
        : null;
      visitedLabel = names ? `Visited: ${names}` : 'Visited the customer';
    } else {
      visitedLabel = 'Not visited';
    }
  }

  const hasVoice = !!(session.voicePath || session.voiceUri);
  const sessionIdForVoice = session._id || session.sessionId;
  const [voicePlaying, setVoicePlaying] = useState(false);

  const handlePlayVoice = async () => {
    if (!sessionIdForVoice) return;
    setVoicePlaying(true);
    try {
      await playVoiceNote(sessionIdForVoice);
    } finally {
      setVoicePlaying(false);
    }
  };

  const fmtTime = (d) => {
    if (!d) return '-';
    const x = new Date(d);
    if (isNaN(x.getTime())) return '-';
    const p = (n) => String(n).padStart(2, '0');
    const h = x.getHours() % 12 || 12;
    return `${p(h)}:${p(x.getMinutes())} ${x.getHours() < 12 ? 'AM' : 'PM'}`;
  };

  return (
    <View style={styles.miniCard}>
      <View style={styles.miniCardHeader}>
        <Text style={styles.miniCardTime}>{fmtTime(session.startTime)}</Text>
        {session.vehicleType ? (
          <Text style={styles.miniCardMode}>{session.vehicleType}</Text>
        ) : null}
      </View>
      {visitedLabel ? (
        <View style={[styles.miniVisitedRow,
          { backgroundColor: session.customerMet === true || session.customerMet === 'true' ? '#F0FDF4' : '#FEF2F2' }
        ]}>
          <Ionicons
            name={session.customerMet === true || session.customerMet === 'true' ? 'checkmark-circle-outline' : 'close-circle-outline'}
            size={13}
            color={session.customerMet === true || session.customerMet === 'true' ? '#059669' : '#DC2626'}
            style={{ marginRight: 5 }}
          />
          <Text style={[styles.miniVisitedText,
            { color: session.customerMet === true || session.customerMet === 'true' ? '#15803D' : '#DC2626' }
          ]}>
            {visitedLabel}
          </Text>
        </View>
      ) : null}
      {hasVoice && sessionIdForVoice ? (
        <TouchableOpacity
          style={styles.miniPlayVoiceBtn}
          onPress={handlePlayVoice}
          disabled={voicePlaying}
          activeOpacity={0.7}
        >
          {voicePlaying ? (
            <ActivityIndicator size="small" color="#2563EB" style={{ marginRight: 5 }} />
          ) : (
            <Ionicons name="play-circle-outline" size={14} color="#2563EB" style={{ marginRight: 5 }} />
          )}
          <Text style={styles.miniPlayVoiceText}>Play voice note</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function RecoveriesPerDayScreen({ route }) {
  const sessions = route?.params?.sessions || [];

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

  // ── Chip tap ────────────────────────────────────────────────────────────────
  function handleChip(chip) {
    setSelectedChip(chip);
    setRangeError('');
    const { from, to } = chipRange(chip);
    setFromText(from ? formatDDMMYYYY(from) : '');
    setToText(to ? formatDDMMYYYY(to) : '');
  }

  // ── Clear ──────────────────────────────────────────────────────────────────
  function handleClear() {
    setSelectedChip('All');
    setRangeError('');
    setFromText('');
    setToText('');
  }

  // ── Text input change — deselect chip, validate on the fly ─────────────────
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

  // ── Computed filter range ───────────────────────────────────────────────────
  const { fromDate, toDate, error } = useMemo(() => {
    // 'All' or both empty → no filter
    if (selectedChip === 'All' || (!fromText && !toText)) {
      return { fromDate: null, toDate: null, error: '' };
    }

    // Chip-driven range (already validated via chipRange)
    if (selectedChip && selectedChip !== 'All') {
      const { from, to } = chipRange(selectedChip);
      return { fromDate: from, toDate: to, error: '' };
    }

    // Custom typed range
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

  // ── Build per-day counts ────────────────────────────────────────────────────
  const { rows, totalInRange } = useMemo(() => {
    const counts = {}; // "YYYY-MM-DD" → count
    const sessionsMap = {}; // "YYYY-MM-DD" → session[]

    for (const session of sessions) {
      const rawDate = session.startTime || session.endTime;
      const key = toLocalDateKey(rawDate);
      if (!key) continue;

      // Apply date range filter
      if (fromDate || toDate) {
        const sessionDate = new Date(rawDate);
        if (fromDate && sessionDate < fromDate) continue;
        if (toDate && sessionDate > toDate) continue;
      }

      counts[key] = (counts[key] || 0) + 1;
      if (!sessionsMap[key]) sessionsMap[key] = [];
      sessionsMap[key].push(session);
    }

    // Sort most recent first
    const sortedKeys = Object.keys(counts).sort((a, b) => (a < b ? 1 : -1));
    const rows = sortedKeys.map((key) => ({ dateKey: key, count: counts[key], sessions: sessionsMap[key] || [] }));
    const totalInRange = rows.reduce((sum, r) => sum + r.count, 0);

    return { rows, totalInRange };
  }, [sessions, fromDate, toDate]);

  const activeError = rangeError || error;

  // Track expanded day keys
  const [expandedDays, setExpandedDays] = useState({});

  // Build a map of day → sessions (derived from sessions prop and filter)
  const sessionsPerDay = useMemo(() => {
    const map = {};
    for (const session of sessions) {
      const rawDate = session.startTime || session.endTime;
      const key = toLocalDateKey(rawDate);
      if (!key) continue;
      if (fromDate || toDate) {
        const sessionDate = new Date(rawDate);
        if (fromDate && sessionDate < fromDate) continue;
        if (toDate && sessionDate > toDate) continue;
      }
      if (!map[key]) map[key] = [];
      map[key].push(session);
    }
    return map;
  }, [sessions, fromDate, toDate]);

  const toggleDay = (key) => {
    setExpandedDays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Filter card ──────────────────────────────────────────────────── */}
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
            <Text style={styles.errorText}>{activeError}</Text>
          ) : null}

          {/* Clear button */}
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
            <Ionicons name="close-circle-outline" size={14} color="#64748B" style={{ marginRight: 4 }} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={36} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No recoveries in this range</Text>
          </View>
        ) : (
          <>
            <View style={styles.listCard}>
              {rows.map((row, idx) => {
                const isExpanded = !!expandedDays[row.dateKey];
                const daySessions = sessionsPerDay[row.dateKey] || [];
                return (
                  <View key={row.dateKey}>
                    <TouchableOpacity
                      style={[styles.dayRow, idx < rows.length - 1 && !isExpanded && styles.dayRowBorder]}
                      onPress={() => toggleDay(row.dateKey)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.dayDate}>{keyToDisplay(row.dateKey)}</Text>
                      <View style={styles.dayRowRight}>
                        <Text style={styles.dayCount}>{row.count}</Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={14} color="#94A3B8" style={{ marginLeft: 6 }}
                        />
                      </View>
                    </TouchableOpacity>
                    {isExpanded ? (
                      <View style={[styles.sessionsList, idx < rows.length - 1 && styles.dayRowBorder]}>
                        {daySessions.map((s, si) => (
                          <SessionMiniCard key={s._id || s.sessionId || si} session={s} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total in range:</Text>
              <Text style={styles.totalValue}>{totalInRange}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, paddingBottom: 60 },

  // Filter card
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
  errorText: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginBottom: 8 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingVertical: 4, paddingHorizontal: 2,
  },
  clearBtnText: { fontSize: 12, color: '#64748B', fontWeight: '600' },

  // Results list
  listCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1,
    borderColor: '#E2E8F0', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  dayRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  dayRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dayDate: { fontSize: 14, fontWeight: '600', color: '#334155' },
  dayCount: { fontSize: 15, fontWeight: '800', color: '#2563EB' },
  dayRowRight: { flexDirection: 'row', alignItems: 'center' },
  sessionsList: { paddingHorizontal: 12, paddingBottom: 10 },
  miniCard: {
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10,
    marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0',
  },
  miniCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  miniCardTime: { fontSize: 12, fontWeight: '700', color: '#334155' },
  miniCardMode: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' },
  miniVisitedRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6,
  },
  miniVisitedText: { fontSize: 12, fontWeight: '700' },
  miniPlayVoiceBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#BFDBFE', alignSelf: 'flex-start',
  },
  miniPlayVoiceText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },

  // Total row
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  totalLabel: { fontSize: 13, fontWeight: '700', color: '#1E40AF' },
  totalValue: { fontSize: 15, fontWeight: '800', color: '#1E40AF' },

  // Empty state
  emptyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 36,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#64748B', marginTop: 10, textAlign: 'center' },
});

