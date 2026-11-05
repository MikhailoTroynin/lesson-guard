import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppState } from '../state/AppState';
import { Icon, type IconName } from './icons';
import { useInPhoneFrame } from './PhoneFrame';
import { colors, fonts, webBlur } from './theme';

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Огляд', icon: 'shield' },
  alerts: { label: 'Сповіщення', icon: 'bell' },
  settings: { label: 'Налаштування', icon: 'sliders' },
};

/** Плаваюче скляне нижнє меню. */
export function GlassTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const router = useRouter();
  const { alerts } = useAppState();
  const unread = alerts.filter((a) => !a.read).length;
  const insets = useSafeAreaInsets();
  const framed = useInPhoneFrame();

  return (
    <View style={[styles.bar, webBlur('blur(22px) saturate(1.6)'), { bottom: 16 + (framed ? 0 : insets.bottom) }]}>
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === i;
        const color = focused ? colors.accent700 : colors.neutral600;
        const badge = route.name === 'alerts' && unread > 0 ? unread : 0;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={() => {
              // Як у дизайні: вкладка «Сповіщення» з меню відкривається з фільтром «Усі».
              if (route.name === 'alerts') router.navigate({ pathname: '/alerts', params: { filter: 'all' } });
              else navigateToTab(route.key);
            }}
            style={styles.tab}>
            <View style={[styles.pill, focused && styles.pillOn]} />
            <View>
              <Icon name={tab.icon} size={22} color={color} />
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    padding: 6,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    boxShadow: '0 12px 32px -12px rgba(41,61,90,0.35)',
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingTop: 8, paddingBottom: 6 },
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '4%',
    right: '4%',
    opacity: 0,
    borderRadius: 20,
    backgroundColor: colors.accent100,
  },
  pillOn: { opacity: 1 },
  label: { fontFamily: fonts.body, fontSize: 11, fontWeight: '500' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -9,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 16 },
});
