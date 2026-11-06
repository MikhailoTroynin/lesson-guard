import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppState } from '../state/AppState';
import { Icon, type IconName } from './icons';
import { colors, fonts } from './theme';

const TABS: Record<string, { label: string; icon: IconName }> = {
  settings: { label: 'Налаштування', icon: 'sliders' },
  index: { label: 'Огляд', icon: 'shield' },
  alerts: { label: 'Сповіщення', icon: 'bell' },
};
const ORDER = ['settings', 'index', 'alerts'];

/** Верхня шапка сайту для широкого екрана (замість нижнього меню телефона). */
export function SiteHeader({ state, navigateToTab }: BottomTabBarProps) {
  const router = useRouter();
  const { alerts } = useAppState();
  const unread = alerts.filter((a) => !a.read).length;
  const routes = [...state.routes].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Icon name="shield" size={18} color="#fff" />
          </View>
          <Text style={styles.brandText}>Lesson Guard</Text>
        </View>
        <View style={styles.nav}>
          {routes.map((route) => {
            const tab = TABS[route.name];
            if (!tab) return null;
            const focused = state.routes[state.index]?.key === route.key;
            const badge = route.name === 'alerts' && unread > 0 ? unread : 0;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="link"
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  if (route.name === 'alerts') router.navigate({ pathname: '/alerts', params: { filter: 'all' } });
                  else navigateToTab(route.key);
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.link,
                  (focused || hovered || pressed) && styles.linkOn,
                ]}>
                <Icon name={tab.icon} size={17} color={focused ? colors.accent700 : colors.neutral700} />
                <Text style={[styles.linkText, focused && { color: colors.accent700 }]}>{tab.label}</Text>
                {badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    zIndex: 10,
  },
  inner: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 32,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.accent700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 20, color: colors.text },
  nav: { flexDirection: 'row', gap: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  linkOn: { backgroundColor: colors.accent100 },
  linkText: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '500', color: colors.neutral800 },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600', lineHeight: 18 },
});
