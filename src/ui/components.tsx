import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from './Backdrop';
import { useInPhoneFrame } from './PhoneFrame';
import { colors, fonts, surface } from './theme';

/** Корінь екрана: непрозорий фон з кольоровими плямами (неактивні вкладки не просвічують). */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Backdrop />
      {children}
    </View>
  );
}

/** Світла напівпрозора картка. */
export function Surface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[surface, style]}>{children}</View>;
}

/** Картка-кнопка з ефектом «натискання» (нахил + зменшення). */
export function PressSurface({
  children,
  style,
  hoverBg = colors.accent100,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; hoverBg?: string; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        surface,
        style,
        (hovered || pressed) && { backgroundColor: hoverBg },
        pressed && { transform: [{ perspective: 600 }, { rotateX: '4deg' }, { scale: 0.985 }] },
      ]}>
      {children}
    </Pressable>
  );
}

/** Надпис над секцією: дрібні великі літери з розрядкою. */
export function Kicker({ children, color = colors.neutral700, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.kicker, { color }, style]}>{children}</Text>;
}

export function Mono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <Kicker>{title}</Kicker>
      {right}
    </View>
  );
}

export function Btn({
  title,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  icon,
  style,
  textStyle,
  pill,
}: {
  title?: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  pill?: boolean;
}) {
  const fg = variant === 'primary' ? colors.bg : variant === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        pill && { borderRadius: 999 },
        hovered && variant === 'primary' && { backgroundColor: colors.accent600 },
        hovered && variant === 'secondary' && { backgroundColor: 'rgba(29,31,32,0.07)' },
        hovered && variant === 'ghost' && { backgroundColor: 'rgba(89,128,166,0.1)' },
        pressed && variant === 'primary' && { backgroundColor: colors.accent700 },
        pressed && { transform: [{ perspective: 500 }, { rotateX: '8deg' }, { scale: 0.98 }] },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}>
      {loading && !icon ? <ActivityIndicator size="small" color={fg} /> : icon}
      {title ? <Text style={[styles.btnText, { color: fg }, textStyle]}>{title}</Text> : null}
    </Pressable>
  );
}

export function Tag({ label, fg, bg, border }: { label: string; fg: string; bg: string; border?: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: bg, borderColor: border ?? bg }]}>
      <Text style={[styles.tagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Dot({ color, size = 8, halo }: { color: string; size?: number; halo?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        boxShadow: halo ? `0 0 0 3px ${halo}` : undefined,
      }}
    />
  );
}

export function Toggle({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 42,
        height: 22,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.accent : colors.neutral300,
        backgroundColor: on ? colors.accent : colors.neutral200,
      }}>
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </View>
  );
}

/** Заголовок екрана: акцентний кікер і великий заголовок. */
export function ScreenHeader({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const framed = useInPhoneFrame();
  const { width } = useWindowDimensions();
  const site = Platform.OS === 'web' && width >= 820;
  return (
    <View
      style={[
        styles.header,
        { paddingTop: (framed ? 0 : insets.top) + 6 },
        site && { maxWidth: 1200, width: '100%', alignSelf: 'center', paddingHorizontal: 32, paddingTop: 24 },
      ]}>
      <View style={{ gap: 1 }}>
        <Kicker color={colors.accent700} style={{ fontSize: 10, letterSpacing: 1.4 }}>
          {kicker}
        </Kicker>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  mono: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '500', color: colors.neutral600 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnSecondary: { borderColor: colors.divider },
  btnGhost: { paddingHorizontal: 6, minHeight: 0, paddingVertical: 4 },
  btnText: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 14 },
  tag: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  tagText: { fontFamily: fonts.body, fontSize: 11, letterSpacing: 0.2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 26, lineHeight: 29, color: colors.text },
});
