import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TouchableOpacity } from 'react-native';
import { SessionCard } from './ProfileScreen';

export default function DayRecoveriesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const dateLabel = route?.params?.dateLabel || '';
  const daySessions = route?.params?.daySessions || [];

  // Sort by start time, earliest first
  const sorted = [...daySessions].sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return ta - tb;
  });

  const count = sorted.length;
  const subtitle = count === 1 ? '1 recovery' : `${count} recoveries`;

  return (
    <View style={styles.flex}>
      {/* ── Custom header (same safe-area approach as DashboardScreen) ──────── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTextBlock}>
          <Text style={styles.headerTitle}>{dateLabel}</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
      </View>

      {/* ── Session list ──────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {sorted.map((session, idx) => (
          <View key={session._id || session.sessionId || session.deviceSessionId || idx}>
            <Text style={styles.recoveryLabel}>Recovery {idx + 1}</Text>
            <SessionCard session={session} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  backBtn: {
    marginRight: 12,
    padding: 4,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, paddingBottom: 60 },
  recoveryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
});
