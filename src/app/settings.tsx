import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { subjectForCourse } from '../core/matcher';
import {
  googleAuthSupported,
  googleEmail,
  isGoogleConnected,
  signInGoogle,
  signOutGoogle,
} from '../platform/googleAuth';
import { notificationsSupported, showAlertNotifications } from '../platform/notifications';
import { secrets } from '../platform/secrets';
import { ESCHOOL_LOGIN_KEY, ESCHOOL_PASSWORD_KEY } from '../services/sync';
import { useAppState } from '../state/AppState';
import { Button, Card, SectionTitle } from '../ui/components';
import { colors } from '../ui/theme';

const forcedDemo = process.env.EXPO_PUBLIC_DEMO === '1' || Platform.OS === 'web';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function GoogleSection() {
  const [email, setEmail] = useState<string | null>(() => (googleAuthSupported ? googleEmail() : null));
  const [connected, setConnected] = useState(() => googleAuthSupported && isGoogleConnected());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { sync } = useAppState();

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      const e = await signInGoogle();
      if (e) {
        setEmail(e);
        setConnected(true);
        await sync();
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
    <Card>
      <Text style={styles.label}>Google Клас (акаунт дитини)</Text>
      {!googleAuthSupported ? (
        <Text style={styles.hint}>Вхід Google доступний лише в Android-додатку. У веб-демо дані вигадані.</Text>
      ) : connected ? (
        <>
          <Text style={styles.hint}>Підключено: {email ?? 'акаунт Google'}</Text>
          <Button title="Відключити" variant="danger" onPress={signOut} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Увійдіть Google-акаунтом, з яким дитина заходить у Google Клас. Доступ лише на читання.
          </Text>
          <Button title="Увійти через Google" onPress={signIn} loading={busy} />
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
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
    <Card>
      <Text style={styles.label}>Єдина школа (логін батьків)</Text>
      <Text style={styles.hint}>
        Логін і пароль зберігаються лише на цьому телефоні в зашифрованому сховищі. Автоматичне читання оцінок ще
        в розробці.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Логін (email або телефон)"
        autoCapitalize="none"
        autoComplete="username"
        value={login}
        onChangeText={setLogin}
      />
      <TextInput
        style={styles.input}
        placeholder={saved ? 'Пароль збережено — введіть, щоб змінити' : 'Пароль'}
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      <View style={styles.buttons}>
        <Button title="Зберегти" onPress={save} disabled={!login.trim() || (!password && !saved)} />
        {saved && <Button title="Видалити" variant="danger" onPress={forget} />}
      </View>
    </Card>
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

  if (courses.length === 0) return <Text style={styles.hint}>Курси з’являться після першої перевірки.</Text>;

  return (
    <Card>
      <Text style={styles.hint}>
        Якщо курс у Google Класі називається інакше, ніж предмет у Єдиній школі, впишіть назву предмета вручну.
      </Text>
      {courses.map(([id, name]) => {
        const auto = subjectForCourse(id, name, subjects, {});
        return (
          <View key={id} style={styles.subjectRow}>
            <Text style={[styles.label, { flex: 1 }]}>{name}</Text>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={auto ?? 'Предмет'}
              defaultValue={settings.subjectMap[id] ?? ''}
              onEndEditing={(e) =>
                updateSettings({ subjectMap: { ...settings.subjectMap, [id]: e.nativeEvent.text.trim() } })
              }
            />
          </View>
        );
      })}
    </Card>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, resetData } = useAppState();
  const t = settings.badGradeThreshold;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle>Сповіщення</SectionTitle>
      <Card>
        <Row label={`Погана оцінка: нижче ${t}`} hint={`12-бальна шкала: алерт для оцінок 1–${t - 1}`}>
          <View style={styles.stepper}>
            <Button title="−" variant="secondary" onPress={() => updateSettings({ badGradeThreshold: Math.max(2, t - 1) })} />
            <Text style={styles.stepValue}>{t}</Text>
            <Button title="+" variant="secondary" onPress={() => updateSettings({ badGradeThreshold: Math.min(12, t + 1) })} />
          </View>
        </Row>
        <Row label="Нові завдання" hint="Сповіщати, коли вчитель додав завдання">
          <Switch
            value={settings.notifyNewAssignments}
            onValueChange={(v) => updateSettings({ notifyNewAssignments: v })}
          />
        </Row>
        {notificationsSupported && (
          <Button
            title="Надіслати тестове сповіщення"
            variant="secondary"
            onPress={() =>
              showAlertNotifications([
                {
                  id: `test:${Date.now()}`,
                  kind: 'bad_grade',
                  severity: 'critical',
                  title: 'Тестове сповіщення',
                  body: 'Так виглядатиме алерт про погану оцінку.',
                  createdAt: new Date().toISOString(),
                },
              ])
            }
          />
        )}
      </Card>

      <SectionTitle>Джерела даних</SectionTitle>
      <Card>
        <Row
          label="Демо-режим"
          hint={forcedDemo ? 'У веб-версії завжди увімкнено' : 'Вимкніть, коли підключите акаунти'}>
          <Switch
            value={settings.demoMode}
            disabled={forcedDemo}
            onValueChange={(v) => updateSettings({ demoMode: v })}
          />
        </Row>
      </Card>
      <GoogleSection />
      <EschoolSection />

      <SectionTitle>Відповідність предметів</SectionTitle>
      <SubjectsSection />

      <SectionTitle>Дані</SectionTitle>
      <Button title="Очистити історію сповіщень" variant="danger" onPress={resetData} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  error: { fontSize: 13, color: colors.critical },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepValue: { fontSize: 18, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
