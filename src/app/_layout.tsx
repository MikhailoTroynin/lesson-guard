import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Text } from 'react-native';

// Імпорт також реєструє фонову задачу (defineTask на рівні модуля).
import { registerBackgroundSync } from '../platform/background';
import { ensurePermission, initNotifications } from '../platform/notifications';
import { AppStateProvider, useAppState } from '../state/AppState';
import { colors } from '../ui/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{glyph}</Text>;
}

function AppTabs() {
  const { alerts } = useAppState();
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Огляд',
          headerTitle: 'Lesson Guard',
          tabBarIcon: ({ focused }) => <TabIcon glyph="📚" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Сповіщення',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: ({ focused }) => <TabIcon glyph="🔔" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Налаштування',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      await initNotifications();
      await ensurePermission();
      await registerBackgroundSync();
    })().catch((e) => console.warn('init failed', e));
  }, []);

  return (
    <AppStateProvider>
      <StatusBar style="dark" />
      <AppTabs />
    </AppStateProvider>
  );
}
