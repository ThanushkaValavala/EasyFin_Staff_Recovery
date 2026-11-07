import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

export default function SelectCasesScreen({ route, navigation }) {
  const { query, groups, total } = route.params;
  const [count, setCount] = useState(null);
  const [selected, setSelected] = useState([]);
  const [hint, setHint] = useState('');

  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  const isSelected = (id) => selected.some((s) => s.id === id);

  const chooseCount = (n) => {
    setCount(n);
    setSelected((s) => s.slice(0, n));
    setHint('');
  };

  const toggle = (c, place) => {
    if (count === null) { setHint('First choose how many cases you want to recover.'); return; }
    if (isSelected(c.id)) {
      setSelected((s) => s.filter((x) => x.id !== c.id));
      setHint('');
      return;
    }
    if (selected.length >= count) {
      setHint('You chose ' + count + ' case' + (count === 1 ? '' : 's') + '. Deselect one to pick another.');
      return;
    }
    setSelected((s) => [...s, { ...c, place }]);
    setHint('');
  };

  const ready = count !== null && selected.length === count;

  const next = () =>
    navigation.navigate('StartRecovery', {
      area: query,
      cases: selected.map((c) => ({ id: c.id, assignmentId: c.assignmentId, customer: c.customer, loan: c.loan })),
    });

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        <Text style={styles.title}>{query ? 'Area: ' + query : 'All my customers'}</Text>
        <Text style={styles.sub}>{total} case{total === 1 ? '' : 's'} found</Text>

        <Text style={styles.label}>How many cases do you want to recover?</Text>
        <View style={styles.chips}>
          {numbers.map((n) => (
            <TouchableOpacity key={n} style={[styles.numChip, count === n && styles.numChipOn]} onPress={() => chooseCount(n)}>
              <Text style={[styles.numText, count === n && styles.numTextOn]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {groups.map((g) => (
          <View key={g.place + String(g.isOther)}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{g.place}</Text>
              <Text style={styles.groupCount}>{g.count} customer{g.count === 1 ? '' : 's'}</Text>
            </View>
            {g.cases.map((c) => {
              const on = isSelected(c.id);
              return (
                <TouchableOpacity key={c.id} style={[styles.card, on && styles.cardOn]} onPress={() => toggle(c, g.place)}>
                  <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>{'\u2713'}</Text> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.customer.name}</Text>
                    <Text style={styles.addr}>{c.customer.address}</Text>
                    <Text style={styles.loan}>Loan no: {c.loan.loanId}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footText}>
          {count === null ? 'Choose a number above' : 'Selected ' + selected.length + ' of ' + count}
        </Text>
        {selected.length > 0 ? (
          <Text style={styles.footNames} numberOfLines={2}>{selected.map((s) => s.customer.name).join(', ')}</Text>
        ) : null}
        <TouchableOpacity style={[styles.next, !ready && styles.disabled]} onPress={next} disabled={!ready}>
          <Text style={styles.nextText}>Continue to recovery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  sub: { color: '#64748B', marginTop: 2, marginBottom: 12 },
  label: { fontSize: 15, fontWeight: '700', marginBottom: 8, color: '#0F172A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  numChip: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 8, marginBottom: 8 },
  numChipOn: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  numText: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  numTextOn: { color: '#fff' },
  hint: { color: '#B45309', marginTop: 4, fontWeight: '500' },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8 },
  groupTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', flex: 1 },
  groupCount: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 2, borderColor: 'transparent', elevation: 1 },
  cardOn: { borderColor: '#2563EB' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#94A3B8', marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  boxOn: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  tick: { color: '#fff', fontWeight: '800' },
  name: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  addr: { color: '#475569', marginTop: 2 },
  loan: { color: '#64748B', marginTop: 2, fontSize: 13 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', padding: 14, borderTopWidth: 1, borderColor: '#E2E8F0' },
  footText: { fontWeight: '700', color: '#0F172A' },
  footNames: { color: '#475569', marginTop: 2, fontSize: 13 },
  next: { backgroundColor: '#15803d', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  nextText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});