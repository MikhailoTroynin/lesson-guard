import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Backdrop } from './Backdrop';
import { PhoneFrameContext } from './frameContext';
import { Icon } from './icons';
import { colors, fonts } from './theme';

export { useInPhoneFrame } from './frameContext';

const PHONE_W = 392;
const PHONE_H = 830;

function useWebFonts() {
  useEffect(() => {
    if (document.getElementById('lg-fonts')) return;
    const link = document.createElement('link');
    link.id = 'lg-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;600&family=Roboto+Condensed:wght@400;600&display=swap';
    document.head.appendChild(link);
    document.body.style.background = colors.neutral200;
  }, []);
}

function StatusBar() {
  return (
    <View style={styles.status}>
      <Text style={styles.statusTime}>9:41</Text>
      <View style={styles.camera} />
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        <Icon name="wifi" size={15} color={colors.text} />
        <Icon name="battery" size={17} color={colors.text} />
      </View>
    </View>
  );
}

function About() {
  return (
    <View style={styles.about}>
      <Text style={styles.aboutKicker}>Lesson Guard · демо</Text>
      <Text style={styles.aboutTitle}>Тонкий світлий інтерфейс для батьків</Text>
      <Text style={styles.aboutText}>
        Головний екран відповідає на одне питання: чи все гаразд. 3D-щоденник погойдується, над ним обертається
        монета з найважливішою оцінкою: червона — нижче порогу, зелена — добра, бурштинова «∅» — порожня здача.
      </Text>
      <Text style={styles.aboutText}>
        Кольори подій: синій — нове завдання, бурштиновий — порожня здача, червоний — погана оцінка, зелений — здано й
        оцінено добре.
      </Text>
      <Text style={styles.aboutText}>
        Торкніться завдання або сповіщення: відкриється ланцюжок «видано → здано → оцінка».
      </Text>
      <Text style={styles.aboutText}>Дані вигадані. «Наступний день» проводить через тиждень.</Text>
    </View>
  );
}

/**
 * Веб-демо на широкому екрані показуємо в макеті смартфона, як у дизайні.
 * На вузькому екрані (відкрито з телефона) — на весь екран без рамки.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  useWebFonts();
  const { width, height } = useWindowDimensions();
  const framed = width >= 520;

  if (!framed) {
    return <PhoneFrameContext.Provider value={false}>{children}</PhoneFrameContext.Provider>;
  }

  const scale = Math.min(1, (height - 32) / PHONE_H, (width - 32) / PHONE_W);
  const showAbout = width >= 900;

  return (
    <PhoneFrameContext.Provider value={true}>
      <View style={styles.page}>
        {showAbout && <About />}
        <View style={{ width: PHONE_W * scale, height: PHONE_H * scale }}>
          <View style={[styles.phone, { transform: [{ scale }], transformOrigin: 'top left' }]}>
            <View style={styles.screen}>
              <Backdrop />
              <StatusBar />
              <View style={{ flex: 1 }}>{children}</View>
            </View>
          </View>
        </View>
      </View>
    </PhoneFrameContext.Provider>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 56,
    padding: 16,
    backgroundColor: colors.neutral200,
  },
  phone: {
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: colors.neutral400,
    backgroundColor: colors.neutral100,
    padding: 9,
    boxShadow: '0 12px 32px rgba(43,43,45,0.22)',
  },
  screen: { flex: 1, borderRadius: 40, overflow: 'hidden', backgroundColor: colors.bg },
  status: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    zIndex: 2,
  },
  statusTime: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: colors.text },
  camera: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.neutral900 },
  about: { maxWidth: 300, gap: 12 },
  aboutKicker: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.accent700,
  },
  aboutTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 32, lineHeight: 36, color: colors.text },
  aboutText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.neutral800 },
});
