import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateTime, formatDay } from '../core/format';
import { summarize } from '../core/overview';
import type { SubmissionStatus, TimelineItem } from '../core/types';
import { DEMO_LAST_STEP, DEMO_STEPS } from '../providers/demo';
import { useAppState } from '../state/AppState';
import { AlertCard } from '../ui/AlertCard';
import { Btn, Screen, Dot, Kicker, Mono, PressSurface, ScreenHeader, SectionHead, Surface, Tag } from '../ui/components';
import { Diary, Spinning } from '../ui/Diary';
import { Icon } from '../ui/icons';
import { useOpenSheet } from '../ui/Sheet';
import { colors, fonts, TAB_BAR_SPACE } from '../ui/theme';

const STATUS: Record<SubmissionStatus, { label: string; fg: string; bg: string }> = {
  not_submitted: { label: 'Не здано', fg: colors.neutral800, bg: colors.neutral200 },
  submitted: { label: 'Здано', fg: colors.greenInk, bg: colors.greenBg },
  returned: { label: 'Перевірено', fg: colors.greenInk, bg: colors.greenBg },
  empty: { label: 'Здано порожнім', fg: colors.amberInk, bg: colors.amberBg },
};

function AssignmentCard({ item }: { item: TimelineItem }) {
  const { assignment: a, submissionStatus, grades } = item;
  const openSheet = useOpenSheet();
  const st = STATUS[submissionStatus];
  const bad = grades.some((g) => g.bad);
  const border = bad ? colors.redBorder : submissionStatus === 'empty' ? colors.amberBorder : 'rgba(255,255,255,0.95)';
  return (
    <PressSurface onPress={() => openSheet(a.id)} accessibilityLabel={a.title} style={[styles.assignment, { borderColor: border }]}>
      <View style={styles.rowBetween}>
        <Kicker color={colors.accent700} style={{ fontSize: 10, letterSpacing: 1, flex: 1 }}>
          {a.courseName}
        </Kicker>
        <Icon name="chevron" size={15} color={colors.neutral500} />
      </View>
      <Text style={styles.assignmentTitle}>{a.title}</Text>
      <Text style={styles.meta}>
        Видано {formatDay(a.createdAt)}
        {a.dueDate ? ` · здати до ${formatDay(a.dueDate)}` : ''}
      </Text>
      <View style={styles.tags}>
        <Tag label={st.label} fg={st.fg} bg={st.bg} />
        {grades.map((g) => (
          <Tag
            key={g.id}
            label={`Оцінка ${g.raw} · ${formatDay(g.date)}`}
            fg={g.bad ? '#fff' : colors.greenInk}
            bg={g.bad ? colors.red : colors.greenBg}
          />
        ))}
      </View>
    </PressSurface>
  );
}

function Hero() {
  const { syncing, timeline, alerts, meta, sync } = useAppState();
  const s = summarize(timeline, alerts);
  const code = syncing ? 'SCAN…' : s.attention ? `ALERT ${String(s.attention).padStart(2, '0')}` : 'OK';
  return (
    <Surface style={styles.hero}>
      <Mono style={[styles.heroCorner, { left: 12 }]}>ЩОДЕННИК</Mono>
      <Mono style={[styles.heroCorner, { right: 12 }]}>{code}</Mono>
      <View style={styles.heroArt}>
        <Diary scale={1.15} face={s.hero} scanning={syncing} />
      </View>
      <Text style={styles.heroTitle}>
        {syncing ? 'Перевіряю…' : s.attention ? `Потребує уваги: ${s.attention}` : 'Усе під контролем'}
      </Text>
      <Text style={styles.heroSub}>
        {syncing
          ? 'Google Клас і Єдина школа'
          : meta.lastRunAt
            ? `Остання перевірка: ${formatDateTime(meta.lastRunAt)}`
            : 'Ще не перевіряли'}
      </Text>
      <Btn
        variant="primary"
        pill
        title={syncing ? 'Перевірка' : 'Перевірити зараз'}
        onPress={sync}
        disabled={syncing}
        icon={
          <Spinning active={syncing}>
            <Icon name="refresh" size={16} color={colors.bg} />
          </Spinning>
        }
        style={styles.heroBtn}
        textStyle={{ fontSize: 15 }}
      />
      {meta.errors.map((e) => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}
    </Surface>
  );
}

function Stats() {
  const { timeline, alerts, settings } = useAppState();
  const router = useRouter();
  const s = summarize(timeline, alerts);
  const items = [
    { value: s.newCount, label: 'Нові завдання', ink: colors.accent700, dot: colors.accent, filter: 'new' },
    { value: s.emptyCount, label: 'Порожні здачі', ink: colors.amberInk, dot: colors.amber, filter: 'empty' },
    { value: s.badCount, label: `Оцінки нижче ${settings.badGradeThreshold}`, ink: colors.redInk, dot: colors.red, filter: 'bad' },
  ];
  return (
    <View style={styles.stats}>
      {items.map((it) => (
        <PressSurface
          key={it.filter}
          hoverBg="rgba(255,255,255,0.9)"
          accessibilityLabel={`${it.label}: ${it.value}`}
          onPress={() => router.navigate({ pathname: '/alerts', params: { filter: it.filter } })}
          style={styles.stat}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Dot color={it.value ? it.dot : colors.neutral300} />
            <Text style={[styles.statValue, { color: it.value ? it.ink : colors.neutral500 }]}>{it.value}</Text>
          </View>
          <Text style={styles.statLabel}>{it.label}</Text>
        </PressSurface>
      ))}
    </View>
  );
}

function DemoPanel() {
  const { demoStep, nextDemoDay, resetData, syncing } = useAppState();
  const done = demoStep >= DEMO_LAST_STEP;
  return (
    <Surface style={{ padding: 14, gap: 10 }}>
      <View style={styles.rowBetween}>
        <Kicker color={colors.accent700}>Демо-тиждень</Kicker>
        <Mono>
          {demoStep + 1}/{DEMO_STEPS.length}
        </Mono>
      </View>
      <View style={styles.bars}>
        {DEMO_STEPS.map((_, i) => (
          <View key={i} style={[styles.bar, { backgroundColor: i <= demoStep ? colors.accent : colors.neutral300 }]} />
        ))}
      </View>
      <Text style={styles.stepName}>{DEMO_STEPS[demoStep]}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn
          title={done ? 'Тиждень пройдено' : 'Наступний день'}
          onPress={nextDemoDay}
          disabled={done || syncing}
          icon={<Icon name="chevron" size={14} color={colors.text} />}
          style={{ flex: 1, flexDirection: 'row-reverse' }}
        />
        <Btn
          onPress={resetData}
          disabled={syncing}
          icon={<Icon name="reset" size={16} color={colors.text} />}
          style={{ width: 40, paddingHorizontal: 0 }}
        />
      </View>
    </Surface>
  );
}

export default function Overview() {
  const { ready, syncing, settings, timeline, fresh, dismissFresh, sync } = useAppState();
  return (
    <Screen>
      <ScreenHeader
        kicker="Lesson Guard"
        title="Огляд"
        right={settings.demoMode ? <Tag label="Демо" fg={colors.accent} bg="transparent" border={colors.accent} /> : null}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} />}>
        <Hero />
        <Stats />

        {fresh.length > 0 && (
          <View style={{ gap: 10 }}>
            <SectionHead
              title="Нове з останньої перевірки"
              right={<Btn variant="ghost" title="Сховати" onPress={dismissFresh} textStyle={{ fontSize: 13 }} />}
            />
            {fresh.map((a) => (
              <AlertCard key={a.id} alert={a} compact />
            ))}
          </View>
        )}

        {settings.demoMode && <DemoPanel />}

        <View style={{ gap: 14 }}>
          <SectionHead title="Завдання з Google Класу" right={<Mono>{String(timeline.length).padStart(2, '0')}</Mono>} />
          {ready && timeline.length === 0 && <Text style={styles.meta}>Завдань за останні тижні немає.</Text>}
          {timeline.map((item) => (
            <AssignmentCard key={item.assignment.id} item={item} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: TAB_BAR_SPACE, gap: 18, maxWidth: 720, width: '100%', alignSelf: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hero: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 16, alignItems: 'center', gap: 6 },
  heroCorner: { position: 'absolute', top: 10, fontSize: 10, letterSpacing: 0.6 },
  heroArt: { height: 200, width: '100%', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 26, lineHeight: 29, textAlign: 'center', color: colors.text },
  heroSub: { fontFamily: fonts.body, fontSize: 13, color: colors.neutral700, textAlign: 'center', minHeight: 20 },
  heroBtn: { marginTop: 8, height: 44, paddingHorizontal: 22, gap: 8, boxShadow: `0 8px 20px -8px ${colors.accent}` },
  error: { fontFamily: fonts.body, fontSize: 12.5, color: colors.redInk, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 13, gap: 4 },
  statValue: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 30, lineHeight: 32 },
  statLabel: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14, color: colors.neutral700 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  stepName: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 17, lineHeight: 21, color: colors.text },
  assignment: { paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  assignmentTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 18, lineHeight: 22, color: colors.text },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.neutral700 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
});
