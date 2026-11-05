import { StyleSheet, Text, View } from 'react-native';

import { formatDateTime } from '../core/format';
import type { Alert, AlertKind } from '../core/types';
import { useAppState } from '../state/AppState';
import { Dot, Mono, PressSurface } from './components';
import { Icon, type IconName } from './icons';
import { useOpenSheet } from './Sheet';
import { colors, fonts } from './theme';

export const KIND: Record<AlertKind, { icon: IconName; bg: string; fg: string; dot: string; halo: string }> = {
  bad_grade: { icon: 'trendDown', bg: colors.redBg, fg: colors.red, dot: colors.red, halo: colors.redBg },
  empty_submission: { icon: 'warning', bg: colors.amberBg, fg: colors.amberInk, dot: colors.amber, halo: colors.amberBg },
  new_assignment: { icon: 'fileNew', bg: colors.accent100, fg: colors.accent700, dot: colors.accent, halo: colors.accent100 },
};

/** Рядок сповіщення. compact — для блоку «Нове з останньої перевірки». */
export function AlertCard({ alert, compact }: { alert: Alert; compact?: boolean }) {
  const k = KIND[alert.kind];
  const { markRead } = useAppState();
  const openSheet = useOpenSheet();
  const onPress = () => {
    void markRead(alert.id);
    if (alert.assignmentId) openSheet(alert.assignmentId);
  };
  return (
    <PressSurface
      onPress={onPress}
      accessibilityLabel={alert.title}
      style={[
        styles.row,
        { alignItems: compact ? 'center' : 'flex-start' },
        { backgroundColor: compact || !alert.read ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)' },
      ]}>
      <View style={[styles.icon, { backgroundColor: k.bg }]}>
        <Icon name={k.icon} size={17} color={k.fg} />
      </View>
      <View style={{ flex: 1, gap: compact ? 1 : 2, minWidth: 0 }}>
        <Text style={styles.title}>{alert.title}</Text>
        <Text style={[styles.body, compact && { fontSize: 12.5, color: colors.neutral700 }]}>{alert.body}</Text>
        {!compact && <Mono style={styles.time}>{formatDateTime(alert.createdAt)}</Mono>}
      </View>
      {compact ? (
        <Icon name="chevron" size={16} color={colors.neutral500} />
      ) : (
        <View style={{ marginTop: 6 }}>
          <Dot color={alert.read ? 'transparent' : k.dot} halo={alert.read ? undefined : k.halo} />
        </View>
      )}
    </PressSurface>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 12 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 16, lineHeight: 19, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.neutral800 },
  time: { fontSize: 10.5, marginTop: 3 },
});
