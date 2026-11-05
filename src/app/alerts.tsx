import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useAppState } from '../state/AppState';
import { AlertCard } from '../ui/AlertCard';
import { Button } from '../ui/components';
import { colors } from '../ui/theme';

export default function Alerts() {
  const { alerts, markAllRead, syncing, sync } = useAppState();
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <FlatList
      data={alerts}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.container}
      refreshing={syncing}
      onRefresh={sync}
      ListHeaderComponent={
        unread > 0 ? (
          <View style={styles.header}>
            <Text style={styles.count}>Непрочитаних: {unread}</Text>
            <Button title="Позначити прочитаними" variant="secondary" onPress={markAllRead} />
          </View>
        ) : undefined
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Поки що сповіщень немає. Тут з’являться нові завдання, погані оцінки та порожні здачі.
        </Text>
      }
      renderItem={({ item }) => <AlertCard alert={item} />}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  count: { fontSize: 15, fontWeight: '600', color: colors.text },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
