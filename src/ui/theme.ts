import { Platform, type ViewStyle } from 'react-native';

/**
 * Токени дизайну «Lesson Guard v2» (дизайн-система Industry):
 * тонкий світлий інтерфейс, приглушений синій акцент, кольорові події.
 */
export const colors = {
  bg: '#f2f2f3',
  text: '#1d1f20',
  divider: 'rgba(29,31,32,0.16)',
  white: '#ffffff',

  neutral100: '#f5f5f8',
  neutral200: '#e7e7ea',
  neutral300: '#d4d4d7',
  neutral400: '#b7b7ba',
  neutral500: '#98989b',
  neutral600: '#7a7a7d',
  neutral700: '#5d5d60',
  neutral800: '#424244',
  neutral900: '#2b2b2d',

  accent: '#5980a6',
  accent100: '#eef6ff',
  accent200: '#d6ebff',
  accent300: '#b5d9fd',
  accent400: '#94bce3',
  accent500: '#749dc4',
  accent600: '#597ea3',
  accent700: '#416180',
  accent800: '#2c455d',

  // Події: червоний — погана оцінка, бурштиновий — порожня здача,
  // зелений — здано/добра оцінка, синій (акцент) — нове завдання.
  red: '#e0383e',
  redBg: '#fde8e7',
  redInk: '#ae1c27',
  redEdge: '#ae1c27',
  redBorder: '#f6c2bf',
  amber: '#eea534',
  amberBg: '#fdf0d3',
  amberInk: '#8f5b0e',
  amberEdge: '#b97a1b',
  amberBorder: '#f3d18e',
  green: '#3ba873',
  greenBg: '#ddf5e7',
  greenInk: '#1b6c45',
  greenEdge: '#2a7a52',
};

export const fonts = {
  heading: Platform.select({
    // Barlow не має кирилиці — для неї підхоплюється Roboto Condensed.
    web: '"Barlow Condensed", "Roboto Condensed", system-ui, sans-serif',
    android: 'sans-serif-condensed',
    default: undefined,
  }),
  body: Platform.select({ web: 'Barlow, system-ui, sans-serif', default: undefined }),
  mono: Platform.select({ web: 'ui-monospace, Menlo, monospace', android: 'monospace', default: 'Menlo' }),
};

/** Світла напівпрозора поверхня з м’якою тінню — базова картка дизайну. */
export const surface = {
  backgroundColor: 'rgba(255,255,255,0.62)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.95)',
  borderRadius: 18,
  boxShadow: '0 1px 2px rgba(29,31,32,0.04), 0 10px 30px -14px rgba(41,61,90,0.22)',
} as const;

export const TAB_BAR_SPACE = 112;

/** Розмиття фону під «скляними» шарами — лише у вебі (на Android — напівпрозорість). */
export function webBlur(value: string): ViewStyle {
  if (Platform.OS !== 'web') return {};
  return { backdropFilter: value, WebkitBackdropFilter: value } as unknown as ViewStyle;
}
