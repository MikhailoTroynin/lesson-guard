import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { subjectForCourse } from '../core/matcher';
import {
  getWebClientId,
  googleAuthSupported,
  googleEmail,
  googleTokenExpiresAt,
  isGoogleConnected,
  setWebClientId,
  signInGoogle,
  signOutGoogle,
  webClientIdFromBuild,
} from '../platform/googleAuth';
import { ensurePermission, notificationsSupported, showAlertNotifications } from '../platform/notifications';
import { secrets } from '../platform/secrets';
import { DEFAULT_ROBOT_URL } from '../providers/robot';
import { ESCHOOL_LOGIN_KEY, ESCHOOL_PASSWORD_KEY, ROBOT_PASSPHRASE_KEY, ROBOT_URL_KEY } from '../services/sync';
import { useAppState } from '../state/AppState';
import { Btn, Screen, Dot, Kicker, Mono, ScreenHeader, Surface, Tag, Toggle } from '../ui/components';
import { Icon } from '../ui/icons';
import { colors, fonts, TAB_BAR_SPACE } from '../ui/theme';

const forcedDemo = process.env.EXPO_PUBLIC_DEMO === '1';
const isWeb = Platform.OS === 'web';
const WEB_ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://mikhailotroynin.github.io';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Kicker>{title}</Kicker>
      {children}
    </View>
  );
}

function ThresholdCard() {
  const { settings, updateSettings } = useAppState();
  const t = settings.badGradeThreshold;
  return (
    <Surface style={styles.card}>
      <View style={styles.rowBaseline}>
        <Text style={styles.cardTitle}>Погана оцінка: нижче {t}</Text>
        <Mono style={{ fontSize: 10.5 }}>1–12</Mono>
      </View>
      <View style={styles.scale}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
          const below = n < t;
          const cur = n === t;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`Поріг: нижче ${n}`}
              accessibilityState={{ selected: cur }}
              onPress={() => updateSettings({ badGradeThreshold: Math.max(2, n) })}
              style={({ pressed }) => [
                styles.cell,
                {
                  backgroundColor: below ? colors.redBg : cur ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                  borderColor: below ? colors.redBorder : cur ? colors.accent : 'rgba(29,31,32,0.08)',
                },
                pressed && { transform: [{ translateY: 1 }] },
              ]}>
              <Text style={[styles.cellText, { color: below ? colors.redInk : cur ? colors.accent700 : colors.neutral700 }]}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        Червоні оцінки (1–{t - 1}) викликають сповіщення. Торкніться клітинки, щоб змінити поріг.
      </Text>
    </Surface>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onToggle,
  disabled,
  first,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  first?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.toggleRow, !first && styles.sep, disabled && { opacity: 0.6 }]}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Toggle on={on} />
    </Pressable>
  );
}

function GoogleSection() {
  const [email, setEmail] = useState<string | null>(() => (googleAuthSupported ? googleEmail() : null));
  const [connected, setConnected] = useState(() => googleAuthSupported && isGoogleConnected());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState(() => getWebClientId());
  const [clientDraft, setClientDraft] = useState(clientId);
  const { settings, updateSettings, sync } = useAppState();
  const needsClientId = isWeb && !webClientIdFromBuild && !clientId;
  const expiresAt = isWeb ? googleTokenExpiresAt() : null;

  const saveClientId = () => {
    setWebClientId(clientDraft);
    setClientId(getWebClientId());
  };

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      const e = await signInGoogle();
      if (e) {
        setEmail(e);
        setConnected(true);
        if (isWeb) void ensurePermission();
        // Підключили справжній акаунт — переходимо з демо на реальні дані.
        if (settings.demoMode && !forcedDemo) await updateSettings({ demoMode: false });
        else await sync();
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await signOutGoogle();
    setConnected(false);
    setEmail(null);
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={connected ? colors.green : colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Google Клас</Text>
        <Tag label="акаунт дитини" fg={colors.neutral800} bg={colors.neutral100} />
      </View>
      <Text style={styles.hint}>
        {!googleAuthSupported
          ? 'Вхід Google доступний лише в Android-додатку. У веб-демо дані вигадані.'
          : connected
            ? `Підключено: ${email ?? 'акаунт Google'} · лише читання`
            : 'Увійдіть Google-акаунтом, з яким дитина заходить у Google Клас. Доступ лише на читання.'}
        {connected && expiresAt
          ? ` · сесія Google до ${new Date(expiresAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}, далі оновлюється кнопкою «Перевірити зараз»`
          : ''}
      </Text>
      {isWeb && !webClientIdFromBuild && (!connected || !clientId) && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>OAuth Client ID (тип «Web application»)</Text>
          <TextInput
            style={styles.input}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            placeholderTextColor={colors.neutral500}
            autoCapitalize="none"
            autoCorrect={false}
            value={clientDraft}
            onChangeText={setClientDraft}
            onBlur={saveClientId}
            onSubmitEditing={saveClientId}
          />
          <Text style={styles.hint}>
            Google Cloud Console → Credentials → OAuth client ID → Web application. В «Authorized JavaScript origins»
            додайте {WEB_ORIGIN}. Зберігається лише в цьому браузері.
          </Text>
          {clientDraft.trim() !== clientId && (
            <Btn title="Зберегти Client ID" onPress={saveClientId} disabled={!clientDraft.trim()} />
          )}
        </View>
      )}
      {googleAuthSupported &&
        !needsClientId &&
        (connected ? (
          <Btn title="Відключити" onPress={signOut} />
        ) : (
          <Btn variant="primary" title="Увійти через Google" onPress={signIn} loading={busy} style={{ minHeight: 42 }} />
        ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Surface>
  );
}

function EschoolSection() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLogin((await secrets.get(ESCHOOL_LOGIN_KEY)) ?? '');
      setSaved(!!(await secrets.get(ESCHOOL_PASSWORD_KEY)));
    })();
  }, []);

  const save = async () => {
    await secrets.set(ESCHOOL_LOGIN_KEY, login.trim());
    if (password) await secrets.set(ESCHOOL_PASSWORD_KEY, password);
    setPassword('');
    setSaved(true);
  };

  const forget = async () => {
    await secrets.remove(ESCHOOL_LOGIN_KEY);
    await secrets.remove(ESCHOOL_PASSWORD_KEY);
    setLogin('');
    setSaved(false);
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={saved ? colors.green : colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Єдина школа</Text>
        <Tag label="логін батьків" fg={colors.neutral800} bg={colors.neutral100} />
      </View>
      <Text style={styles.hint}>
        {isWeb
          ? 'У браузері підключення недоступне: сайт Єдиної школи не дозволяє запити з інших доменів, а пароль батьків не варто зберігати в браузері. Щоб бачити оцінки, увімкніть «Хмарний робот» вище.'
          : 'Прямий вхід з телефону ще в розробці. Щоб читати оцінки вже зараз, увімкніть «Хмарний робот» вище.'}
      </Text>
      {!isWeb && (
        <>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Логін</Text>
        <TextInput
          style={styles.input}
          placeholder="Email або телефон"
          placeholderTextColor={colors.neutral500}
          autoCapitalize="none"
          autoComplete="username"
          value={login}
          onChangeText={setLogin}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Пароль</Text>
        <TextInput
          style={styles.input}
          placeholder={saved ? 'Збережено — введіть, щоб змінити' : 'Пароль'}
          placeholderTextColor={colors.neutral500}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn
          title={saved && !password ? 'Збережено' : 'Зберегти'}
          onPress={save}
          disabled={!login.trim() || (!password && !saved)}
          style={{ flex: 1 }}
        />
        {saved && <Btn variant="ghost" title="Видалити" onPress={forget} style={{ minHeight: 40 }} />}
      </View>
        </>
      )}
    </Surface>
  );
}

function RobotSection() {
  const { sync, meta } = useAppState();
  const [url, setUrl] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setUrl((await secrets.get(ROBOT_URL_KEY)) ?? '');
      setSaved(!!(await secrets.get(ROBOT_PASSPHRASE_KEY)));
    })();
  }, []);

  const save = async () => {
    if (url.trim()) await secrets.set(ROBOT_URL_KEY, url.trim());
    else await secrets.remove(ROBOT_URL_KEY);
    if (passphrase) await secrets.set(ROBOT_PASSPHRASE_KEY, passphrase);
    setPassphrase('');
    setSaved(true);
    await sync();
  };

  const forget = async () => {
    await secrets.remove(ROBOT_URL_KEY);
    await secrets.remove(ROBOT_PASSPHRASE_KEY);
    setSaved(false);
  };

  const robotErrors = saved ? meta.errors : [];

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={saved ? (robotErrors.length ? colors.red : colors.green) : colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Хмарний робот</Text>
        <Tag label="без Google Cloud" fg={colors.neutral800} bg={colors.neutral100} />
      </View>
      <Text style={styles.hint}>
        Робот у GitHub Actions сам заходить у Google Клас і Єдину школу через браузер і викладає зашифровані дані.
        Логіни задаються в секретах репозиторію, тут — лише пароль робота (ROBOT_PASSPHRASE).
      </Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Пароль робота</Text>
        <TextInput
          style={styles.input}
          placeholder={saved ? 'Збережено — введіть, щоб змінити' : 'Той самий, що в ROBOT_PASSPHRASE'}
          placeholderTextColor={colors.neutral500}
          secureTextEntry
          autoCapitalize="none"
          value={passphrase}
          onChangeText={setPassphrase}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Адреса даних (необов’язково)</Text>
        <TextInput
          style={[styles.input, { fontSize: 12 }]}
          placeholder={DEFAULT_ROBOT_URL}
          placeholderTextColor={colors.neutral500}
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn
          title={saved && !passphrase ? 'Збережено' : 'Зберегти'}
          onPress={save}
          disabled={!passphrase && !saved}
          style={{ flex: 1 }}
        />
        {saved && <Btn variant="ghost" title="Вимкнути" onPress={forget} style={{ minHeight: 40 }} />}
      </View>
      {robotErrors.map((e) => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}
    </Surface>
  );
}

function SubjectInput({ placeholder, initial, onSave }: { placeholder: string; initial: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    if (value.trim() !== initial) onSave(value.trim());
  };
  return (
    <TextInput
      style={[styles.input, { flex: 1, height: 36, fontSize: 13 }]}
      placeholder={placeholder}
      placeholderTextColor={colors.neutral500}
      value={value}
      onChangeText={setValue}
      onBlur={commit}
      onSubmitEditing={commit}
    />
  );
}

function SubjectsSection() {
  const { timeline, settings, updateSettings } = useAppState();
  const courses = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of timeline) m.set(t.assignment.courseId, t.assignment.courseName);
    return [...m.entries()];
  }, [timeline]);
  const subjects = useMemo(() => [...new Set(timeline.flatMap((t) => t.grades.map((g) => g.subject)))], [timeline]);

  return (
    <Surface style={styles.card}>
      <Text style={styles.hint}>
        Якщо курс у Google Класі називається інакше, ніж предмет у Єдиній школі, впишіть назву предмета вручну.
      </Text>
      {courses.length === 0 && <Text style={styles.hint}>Курси з’являться після першої перевірки.</Text>}
      {courses.map(([id, name]) => {
        const auto = subjectForCourse(id, name, subjects, {});
        return (
          <View key={id} style={styles.subjectRow}>
            <Text style={[styles.subjectName, { flex: 1 }]}>{name}</Text>
            <Icon name="arrow" size={14} color={colors.neutral500} />
            <SubjectInput
              placeholder={auto ?? 'Предмет'}
              initial={settings.subjectMap[id] ?? ''}
              onSave={(text) => updateSettings({ subjectMap: { ...settings.subjectMap, [id]: text } })}
            />
          </View>
        );
      })}
    </Surface>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, resetData } = useAppState();

  return (
    <Screen>
      <ScreenHeader kicker="Конфігурація" title="Налаштування" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Section title="Сповіщення">
          <ThresholdCard />
          <Surface style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
            <ToggleRow
              first
              label="Нові завдання"
              hint="Сповіщати, коли вчитель додав завдання"
              on={settings.notifyNewAssignments}
              onToggle={() => updateSettings({ notifyNewAssignments: !settings.notifyNewAssignments })}
            />
            <ToggleRow
              label="Демо-режим"
              hint={forcedDemo ? 'У цій збірці завжди увімкнено' : 'Вимикається сам після входу в Google'}
              on={settings.demoMode}
              disabled={forcedDemo}
              onToggle={() => updateSettings({ demoMode: !settings.demoMode })}
            />
          </Surface>
          {notificationsSupported && (
            <Btn
              title="Надіслати тестове сповіщення"
              onPress={async () => {
                if (!(await ensurePermission())) return;
                await showAlertNotifications([
                  {
                    id: `test:${Date.now()}`,
                    kind: 'bad_grade',
                    severity: 'critical',
                    title: 'Тестове сповіщення',
                    body: 'Так виглядатиме алерт про погану оцінку.',
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }}
            />
          )}
        </Section>

        <Section title="Джерела даних">
          <RobotSection />
          <GoogleSection />
          <EschoolSection />
        </Section>

        <Section title="Відповідність предметів">
          <SubjectsSection />
        </Section>

        <Btn
          title="Очистити історію сповіщень"
          onPress={resetData}
          style={{ minHeight: 42 }}
          textStyle={{ color: colors.accent800 }}
        />
        <Mono style={{ fontSize: 10.5, textAlign: 'center' }}>Lesson Guard · фонова перевірка ≈ кожні 4 год</Mono>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: TAB_BAR_SPACE, gap: 18, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: { padding: 14, gap: 10 },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 17, lineHeight: 20, color: colors.text },
  scale: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, height: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 14 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.neutral700 },
  label: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '500', color: colors.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  sep: { borderTopWidth: 1, borderTopColor: colors.divider },
  sourceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: { gap: 5 },
  fieldLabel: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(29,31,32,0.7)' },
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    paddingHorizontal: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    backgroundColor: 'rgba(233,233,234,0.7)',
  },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subjectName: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '500', color: colors.text },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.redInk },
});
