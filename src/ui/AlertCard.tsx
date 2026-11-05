import { StyleSheet, Text, View } from 'react-native';

import { formatDateTime } from '../core/format';
import type { Alert, AlertSeverity } from '../core/types';
import { colors, radius } from './theme';

export const SEVERITY: Record<AlertSeverity, { fg: string; bg: string; icon: string }> = {
  critical: { fg: colors.critical, bg: colors.criticalBg, icon: '⛔' },
  warning: { fg: colors.warning, bg: colors.warningBg, icon: '⚠️' },
  info: { fg: colors.info, bg: colors.infoBg, icon: '📘' },
};

export function AlertCard({ alert }: { alert: Alert }) {
  const s = SEVERITY[alert.severity];
  return (
    <View style={[styles.card, { borderLeftColor: s.fg, backgroundColor: alert.read ? colors.card : s.bg }]}>
      <View style={styles.row}>
        <Text style={styles.icon}>{s.icon}</Text>
        <Text style={[styles.title, { color: s.fg }]}>{alert.title}</Text>
        {!alert.read && <View style={[styles.dot, { backgroundColor: s.fg }]} />}
      </View>
      <Text style={styles.body}>{alert.body}</Text>
      <Text style={styles.time}>{formatDateTime(alert.createdAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius,
    borderLeftWidth: 5,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { fontSize: 16 },
  title: { fontSize: 15, fontWeight: '700', flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  time: { fontSize: 12, color: colors.muted },
});
