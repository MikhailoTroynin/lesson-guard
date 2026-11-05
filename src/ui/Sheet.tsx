import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chainFor, coinForItem, type StepTone } from '../core/overview';
import type { TimelineItem } from '../core/types';
import { useAppState } from '../state/AppState';
import { Btn, Kicker, Mono } from './components';
import { Coin } from './Diary';
import { Icon } from './icons';
import { colors, fonts, webBlur } from './theme';

const SheetCtx = createContext<(assignmentId: string) => void>(() => {});
export const useOpenSheet = () => useContext(SheetCtx);

const NODE: Record<StepTone, { border: string; bg: string }> = {
  issued: { border: colors.accent, bg: colors.accent },
  todo: { border: colors.neutral400, bg: 'transparent' },
  bad: { border: colors.red, bg: colors.red },
  good: { border: colors.green, bg: colors.green },
  empty: { border: colors.amber, bg: colors.amber },
};

function Chain({ item }: { item: TimelineItem }) {
  const steps = chainFor(item);
  return (
    <View>
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        const node = NODE[st.tone];
        return (
          <View key={i} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.node, { borderColor: node.border, backgroundColor: node.bg }]} />
              <View
                style={[
                  styles.line,
                  { backgroundColor: last ? 'transparent' : st.tone === 'todo' ? colors.neutral300 : colors.accent300 },
                ]}
              />
            </View>
            <View style={styles.stepBody}>
              <Mono style={styles.stepLabel}>
                {st.label}
                {st.when ? ` · ${st.when}` : ''}
              </Mono>
              <Text style={styles.stepValue}>{st.value}</Text>
              {st.note ? <Text style={styles.stepNote}>{st.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Нижня панель деталей завдання з ланцюжком «видано → здано → оцінка». */
export function SheetProvider({ children }: { children: ReactNode }) {
  const { timeline } = useAppState();
  // id лишається після закриття, щоб панель не спорожніла під час анімації.
  const [sheet, setSheet] = useState<{ id: string | null; open: boolean }>({ id: null, open: false });
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));

  const shown = timeline.find((t) => t.assignment.id === sheet.id) ?? null;
  const open = sheet.open && !!shown;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 450,
      easing: Easing.bezier(0.2, 0.9, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [open, progress]);

  const openSheet = useCallback((id: string) => setSheet({ id, open: true }), []);
  const close = () => setSheet((s) => ({ ...s, open: false }));
  const value = useMemo(() => openSheet, [openSheet]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [700, 0] });
  const rotateX = progress.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '0deg'] });

  return (
    <SheetCtx.Provider value={value}>
      {children}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.scrim, webBlur('blur(2px)'), { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Закрити" />
      </Animated.View>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityViewIsModal={open}
        style={[styles.sheet, webBlur('blur(24px) saturate(1.5)'), { transform: [{ perspective: 900 }, { translateY }, { rotateX }] }]}>
        <ScrollView contentContainerStyle={[styles.sheetInner, { paddingBottom: 28 + insets.bottom }]} bounces={false}>
          <View style={styles.grabber} />
          {shown ? (
            <>
              <View style={styles.head}>
                <View style={{ paddingTop: 2 }}>
                  <Coin face={coinForItem(shown)} size={46} spin={5} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Kicker color={colors.accent700} style={{ fontSize: 10 }}>
                    {shown.assignment.courseName}
                  </Kicker>
                  <Text style={styles.title}>{shown.assignment.title}</Text>
                </View>
                <Btn
                  variant="secondary"
                  onPress={close}
                  icon={<Icon name="close" size={16} color={colors.text} />}
                  style={{ width: 36, minHeight: 36, paddingHorizontal: 0 }}
                />
              </View>
              <Chain item={shown} />
              {shown.assignment.link ? (
                <Btn
                  title="Відкрити в Google Класі"
                  icon={<Icon name="external" size={15} color={colors.text} />}
                  onPress={() => Linking.openURL(shown.assignment.link!)}
                  style={{ minHeight: 42 }}
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Animated.View>
    </SheetCtx.Provider>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(43,43,45,0.28)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: 'rgba(250,250,252,0.92)',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    boxShadow: '0 -12px 40px -16px rgba(41,61,90,0.35)',
    transformOrigin: 'bottom',
  },
  sheetInner: { paddingTop: 10, paddingHorizontal: 20, gap: 14 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.neutral300 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 24, lineHeight: 28, color: colors.text },
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 22, alignItems: 'center' },
  node: { width: 12, height: 12, marginTop: 4, borderRadius: 6, borderWidth: 1.5 },
  line: { flex: 1, width: 1, minHeight: 14 },
  stepBody: { flex: 1, gap: 2, paddingBottom: 16 },
  stepLabel: { fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  stepValue: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 17, lineHeight: 21, color: colors.text },
  stepNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.neutral700 },
});
