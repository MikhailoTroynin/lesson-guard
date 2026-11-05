import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';

// Імпорт також реєструє фонову задачу (defineTask на рівні модуля).
import { registerBackgroundSync } from '../platform/background';
import { ensurePermission, initNotifications } from '../platform/notifications';
import { AppStateProvider } from '../state/AppState';
import { PhoneFrame } from '../ui/PhoneFrame';
import { SheetProvider } from '../ui/Sheet';
import { GlassTabBar } from '../ui/TabBar';
import { colors } from '../ui/theme';

function AppTabs() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Огляд' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Сповіщення' }} />
      <Tabs.Screen name="settings" options={{ title: 'Налаштування' }} />
    </Tabs>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') {
      // У браузері: періодична перевірка, поки вкладка відкрита.
      void registerBackgroundSync();
      return;
    }
    (async () => {
      await initNotifications();
      await ensurePermission();
      await registerBackgroundSync();
    })().catch((e) => console.warn('init failed', e));
  }, []);

  return (
    <AppStateProvider>
      <StatusBar style="dark" />
      <PhoneFrame>
        <View style={{ flex: 1 }}>
          <SheetProvider>
            <AppTabs />
          </SheetProvider>
        </View>
      </PhoneFrame>
    </AppStateProvider>
  );
}
