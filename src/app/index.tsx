import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateTime, formatDay } from '../core/format';
import type { SubmissionStatus, TimelineItem } from '../core/types';
import { DEMO_LAST_STEP, DEMO_STEPS } from '../providers/demo';
import { useAppState } from '../state/AppState';
import { AlertCard } from '../ui/AlertCard';
import { Button, Card, Chip, SectionTitle } from '../ui/components';
import { colors } from '../ui/theme';

const STATUS: Record<SubmissionStatus, { label: string; fg: string; bg: string }> = {
  not_submitted: { label: 'Не здано', fg: colors.muted, bg: colors.bg },
  submitted: { label: 'Здано', fg: colors.ok, bg: colors.okBg },
  returned: { label: 'Перевірено', fg: colors.ok, bg: colors.okBg },
  empty: { label: 'Здано порожнім', fg: colors.warning, bg: colors.warningBg },
};

function AssignmentCard({ item }: { item: TimelineItem }) {
  const { assignment: a, submissionStatus, emptyReason, grades } = item;
  const st = STATUS[submissionStatus];
  return (
    <Card style={submissionStatus === 'empty' || grades.some((g) => g.bad) ? styles.cardAttention : undefined}>
      <Text style={styles.course}>{a.courseName}</Text>
      <Text
        style={styles.title}
        onPress={a.link ? () => Linking.openURL(a.link!) : undefined}
        accessibilityRole={a.link ? 'link' : undefined}>
        {a.title}
      </Text>
      <Text style={styles.meta}>
        Видано {formatDay(a.createdAt)}
        {a.dueDate ? ` · здати до ${formatDay(a.dueDate)}` : ''}
      </Text>
      <View style={styles.chips}>
        <Chip label={st.label} fg={st.fg} bg={st.bg} />
        {grades.map((g) => (
          <Chip
            key={g.id}
            label={`Оцінка ${g.raw} · ${formatDay(g.date)}`}
            fg={g.bad ? colors.critical : colors.ok}
            bg={g.bad ? colors.criticalBg : colors.okBg}
          />
        ))}
      </View>
      {emptyReason ? <Text style={styles.warn}>⚠️ {emptyReason}</Text> : null}
    </Card>
  );
}

function DemoPanel() {
  const { demoStep, nextDemoDay, resetData, syncing } = useAppState();
  const done = demoStep >= DEMO_LAST_STEP;
  return (
    <Card style={styles.demo}>
      <Text style={styles.demoTitle}>Демо-режим</Text>
      <Text style={styles.demoText}>
        Дані вигадані. Натискайте «Наступний день», щоб побачити, як додаток реагує на нове завдання, порожню
        здачу і погану оцінку.
      </Text>
      <Text style={styles.demoStep}>
        Крок {demoStep + 1}/{DEMO_STEPS.length}: {DEMO_STEPS[demoStep]}
      </Text>
      <View style={styles.row}>
        <Button title={done ? 'Тиждень пройдено' : 'Наступний день ▶'} onPress={nextDemoDay} disabled={done} loading={syncing} />
        <Button title="Почати спочатку" variant="secondary" onPress={resetData} disabled={syncing} />
      </View>
    </Card>
  );
}

export default function Overview() {
  const { ready, syncing, settings, timeline, meta, fresh, dismissFresh, sync } = useAppState();

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} />}>
      {settings.demoMode && <DemoPanel />}

      {fresh.length > 0 && (
        <View style={styles.fresh}>
          <View style={styles.rowBetween}>
            <Text style={styles.freshTitle}>Нові сповіщення: {fresh.length}</Text>
            <Text style={styles.link} onPress={dismissFresh}>
              Сховати
            </Text>
          </View>
          {fresh.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </View>
      )}

      <View style={styles.rowBetween}>
        <Text style={styles.meta}>
          {meta.lastRunAt ? `Остання перевірка: ${formatDateTime(meta.lastRunAt)}` : 'Ще не перевіряли'}
        </Text>
        {!settings.demoMode && <Button title="Перевірити зараз" variant="secondary" onPress={sync} loading={syncing} />}
      </View>
      {meta.errors.map((e) => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}

      <SectionTitle>Завдання з Google Класу</SectionTitle>
      {ready && timeline.length === 0 && <Text style={styles.meta}>Завдань за останні тижні немає.</Text>}
      {timeline.map((item) => (
        <AssignmentCard key={item.assignment.id} item={item} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' },
  course: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  title: { fontSize: 16, color: colors.text, fontWeight: '700' },
  meta: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  warn: { fontSize: 13, color: colors.warning },
  cardAttention: { borderColor: colors.warning },
  demo: { backgroundColor: colors.demoBg, borderColor: '#F2D27A' },
  demoTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  demoText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  demoStep: { fontSize: 14, fontWeight: '600', color: colors.warning },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fresh: { gap: 8 },
  freshTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  link: { color: colors.primary, fontWeight: '600' },
  error: { fontSize: 13, color: colors.critical },
});
