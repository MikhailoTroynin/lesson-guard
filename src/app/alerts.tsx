import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FILTER_KIND, groupByDay, type AlertFilter } from '../core/overview';
import { useAppState } from '../state/AppState';
import { AlertCard } from '../ui/AlertCard';
import { Btn, Screen, Kicker, ScreenHeader, Surface } from '../ui/components';
import { Diary } from '../ui/Diary';
import { Icon } from '../ui/icons';
import { colors, fonts, TAB_BAR_SPACE } from '../ui/theme';

const FILTERS: [AlertFilter, string][] = [
  ['all', 'Усі'],
  ['bad', 'Оцінки'],
  ['empty', 'Порожні'],
  ['new', 'Нові'],
];

export default function Alerts() {
  const { alerts, markAllRead, syncing, sync } = useAppState();
  const params = useLocalSearchParams<{ filter?: string }>();
  const router = useRouter();
  const filter: AlertFilter = FILTERS.some(([k]) => k === params.filter) ? (params.filter as AlertFilter) : 'all';
  const kind = FILTER_KIND[filter];
  const shown = alerts.filter((a) => !kind || a.kind === kind);
  const groups = groupByDay(shown);
  const unread = alerts.some((a) => !a.read);

  return (
    <Screen>
      <ScreenHeader kicker="Стрічка подій" title="Сповіщення" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} />}>
        <View style={styles.toolbar}>
          <View style={styles.seg} accessibilityRole="tablist">
            {FILTERS.map(([k, label], i) => {
              const on = k === filter;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => router.setParams({ filter: k })}
                  style={[styles.segOpt, i > 0 && styles.segSep, on && { backgroundColor: colors.accent }]}>
                  <Text style={[styles.segText, { color: on ? colors.bg : colors.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {unread && (
            <Btn
              variant="ghost"
              title="Усі"
              onPress={markAllRead}
              icon={<Icon name="check" size={14} color={colors.accent} />}
              textStyle={{ fontSize: 13 }}
            />
          )}
        </View>

        {shown.length === 0 && (
          <Surface style={styles.empty}>
            <View style={{ height: 96, justifyContent: 'center' }}>
              <Diary scale={0.55} face={null} scanning={false} />
            </View>
            <Text style={styles.emptyTitle}>Поки що тихо</Text>
            <Text style={styles.emptyText}>Тут з’являться нові завдання, погані оцінки та порожні здачі.</Text>
          </Surface>
        )}

        {groups.map((g) => (
          <View key={g.label} style={{ gap: 12 }}>
            <Kicker>{g.label}</Kicker>
            {g.items.map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: TAB_BAR_SPACE, gap: 18, maxWidth: 720, width: '100%', alignSelf: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  seg: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  segOpt: { paddingVertical: 7, paddingHorizontal: 10 },
  segSep: { borderLeftWidth: 1, borderLeftColor: colors.divider },
  segText: { fontFamily: fonts.body, fontSize: 12.5 },
  empty: { paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 10 },
  emptyTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 19, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.neutral700, maxWidth: 260, textAlign: 'center' },
});
