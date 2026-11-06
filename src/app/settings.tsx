import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { subjectForCourse } from '../core/matcher';
import { api, loginWithTelegram, UnauthorizedError, WORKER_URL, type Overview } from '../platform/api';
import { ensurePermission, notificationsSupported, showAlertNotifications } from '../platform/notifications';
import { useAppState } from '../state/AppState';
import { Btn, Screen, Dot, Kicker, Mono, ScreenHeader, Surface, Tag, Toggle } from '../ui/components';
import { Icon } from '../ui/icons';
import { colors, fonts, TAB_BAR_SPACE } from '../ui/theme';

const forcedDemo = process.env.EXPO_PUBLIC_DEMO === '1';
const REPO = 'https://github.com/MikhailoTroynin/lesson-guard';
const ROBOT_WORKFLOW_URL = `${REPO}/actions/workflows/robot.yml`;
const SESSION_HELP_URL = `${REPO}#сесія-google-для-робота`;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fmtTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString('uk-UA', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

function confirmAction(text: string): boolean {
  return typeof window === 'undefined' || typeof window.confirm !== 'function' ? true : window.confirm(text);
}

function openUrl(url: string) {
  if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(url, '_blank', 'noopener');
  else void Linking.openURL(url);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Kicker>{title}</Kicker>
      {children}
    </View>
  );
}

function ErrorText({ error }: { error: string }) {
  return error ? <Text style={styles.error}>{error}</Text> : null;
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  autoComplete?: 'username' | 'password' | 'off';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && { height: 72, paddingTop: 8, fontSize: 12 }]}
        placeholder={props.placeholder}
        placeholderTextColor={colors.neutral500}
        secureTextEntry={props.secure}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={props.autoComplete ?? 'off'}
        value={props.value}
        onChangeText={props.onChangeText}
      />
    </View>
  );
}

/** Огляд з сервера: діти, чати, облікові дані, стан робота. */
function useOverview(loggedIn: boolean, onUnauthorized: () => void) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api.overview().then(
        (d) => {
          setData(d);
          setError('');
        },
        (e) => {
          if (e instanceof UnauthorizedError) onUnauthorized();
          setError(errText(e));
        },
      ),
    [onUnauthorized],
  );
  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, load]);
  return { data: loggedIn ? data : null, error: loggedIn ? error : '', refresh: load };
}

// ─────────────────────────── Вхід ───────────────────────────

function LoginCard() {
  const { onLoggedIn } = useAppState();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signal = useRef({ cancelled: false });

  useEffect(() => () => void (signal.current.cancelled = true), []);

  const start = async () => {
    signal.current = { cancelled: false };
    setBusy(true);
    setError('');
    setLink(null);
    try {
      const ok = await loginWithTelegram((url) => {
        setLink(url);
        openUrl(url);
      }, signal.current);
      if (ok) await onLoggedIn();
      else if (!signal.current.cancelled) setError('Час на підтвердження вийшов. Натисніть «Увійти» ще раз.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setLink(null);
    }
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Вхід через Telegram</Text>
      </View>
      <Text style={styles.hint}>
        Налаштування зберігаються на сервері Lesson Guard, тож спершу треба увійти. Натисніть кнопку — відкриється бот у
        Telegram. Натисніть у ньому «Start» (або «Почати»), і ця сторінка відкриється сама. Перший, хто увійде, стає
        адміністратором.
      </Text>
      {link ? (
        <>
          <Text style={styles.hint}>Чекаю на підтвердження в Telegram… Якщо Telegram не відкрився, натисніть:</Text>
          <Btn variant="primary" title="Відкрити бота в Telegram" onPress={() => openUrl(link)} style={{ minHeight: 42 }} />
          <Btn
            variant="ghost"
            title="Скасувати"
            onPress={() => {
              signal.current.cancelled = true;
            }}
          />
        </>
      ) : (
        <Btn variant="primary" title="Увійти через Telegram" onPress={start} loading={busy} style={{ minHeight: 42 }} />
      )}
      <ErrorText error={error} />
    </Surface>
  );
}

function AccountCard({ overview }: { overview: Overview | null }) {
  const { logout } = useAppState();
  const me = overview?.chats.find((c) => c.chat_id === overview.me.chat_id);
  return (
    <Surface style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
      <Dot color={colors.green} />
      <Text style={[styles.hint, { flex: 1 }]}>
        Ви увійшли{me?.title ? ` як ${me.title}` : ''}. Сеанс діє 30 днів у цьому браузері.
      </Text>
      <Btn
        variant="ghost"
        title="Вийти"
        onPress={() => {
          if (confirmAction('Вийти зі сторінки налаштувань у цьому браузері?')) void logout();
        }}
      />
    </Surface>
  );
}

// ─────────────────────────── Акаунти дитини ───────────────────────────

function EschoolCard({ overview, refresh }: { overview: Overview; refresh: () => Promise<void> }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const cur = overview.credentials;
  const saved = !!cur.eschool_login && cur.eschool_password;
  const robotError = overview.robot?.errors.eschool;

  const save = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const patch: { eschool_login?: string; eschool_password?: string } = {};
      if (login.trim()) patch.eschool_login = login.trim();
      if (password) patch.eschool_password = password;
      await api.putCredentials(patch);
      setLogin('');
      setPassword('');
      setDone('Збережено. Робот використає нові дані під час наступного запуску.');
      await refresh();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!confirmAction('Видалити логін і пароль Єдиної школи з сервера?')) return;
    try {
      await api.putCredentials({ eschool_login: null, eschool_password: null });
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={saved ? (robotError ? colors.red : colors.green) : colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Єдина школа</Text>
        <Tag label="оцінки" fg={colors.neutral800} bg={colors.neutral100} />
      </View>
      <Text style={styles.hint}>
        {saved
          ? `Збережено: ${cur.eschool_login}, пароль — так. Щоб змінити, впишіть нові значення.`
          : 'Логін і пароль ДИТИНИ з eschool-ua.com (логін — номер телефону 380…). Зберігаються на сервері в зашифрованому вигляді, назад на сторінку не показуються.'}
      </Text>
      <Field label="Логін" value={login} onChangeText={setLogin} placeholder={cur.eschool_login ?? '380XXXXXXXXX'} autoComplete="username" />
      <Field
        label="Пароль"
        value={password}
        onChangeText={setPassword}
        placeholder={cur.eschool_password ? 'Збережено — впишіть, щоб змінити' : 'Пароль'}
        secure
        autoComplete="password"
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn
          variant="primary"
          title="Зберегти"
          onPress={save}
          loading={busy}
          disabled={saved ? !login.trim() && !password : !login.trim() || !password}
          style={{ flex: 1, minHeight: 42 }}
        />
        {saved && <Btn variant="ghost" title="Видалити" onPress={forget} style={{ minHeight: 42 }} />}
      </View>
      {done ? <Text style={styles.hint}>{done}</Text> : null}
      <ErrorText error={error || (robotError ? `Робот: ${robotError}` : '')} />
    </Surface>
  );
}

function GoogleCard({ overview, refresh }: { overview: Overview; refresh: () => Promise<void> }) {
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const updated = overview.credentials.google_session_updated_at;
  const robotError = overview.robot?.errors.classroom;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.putCredentials({ google_session: session.trim() });
      setSession('');
      await refresh();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!confirmAction('Видалити сесію Google з сервера? Робот перестане бачити Google Клас.')) return;
    try {
      await api.putCredentials({ google_session: null });
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={updated ? (robotError ? colors.red : colors.green) : colors.neutral400} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Google Клас</Text>
        <Tag label="завдання" fg={colors.neutral800} bg={colors.neutral100} />
      </View>
      <Text style={styles.hint}>
        {updated
          ? `Сесію Google збережено ${fmtTime(updated)}. Робот сам її продовжує; нова потрібна, лише якщо Google «розлогінить» робота.`
          : 'Google не пускає робота входити паролем, тому один раз увійти в акаунт дитини треба на комп’ютері командою npm run robot:session — вона видасть рядок, який треба вставити сюди.'}
      </Text>
      <Btn variant="ghost" title="Як отримати рядок сесії (інструкція)" onPress={() => openUrl(SESSION_HELP_URL)} />
      <Field
        label="Рядок сесії (lgs1:…)"
        value={session}
        onChangeText={setSession}
        placeholder="Вставте вміст файлу google-session.txt"
        multiline
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn variant="primary" title="Зберегти" onPress={save} loading={busy} disabled={!session.trim()} style={{ flex: 1, minHeight: 42 }} />
        {updated && <Btn variant="ghost" title="Видалити" onPress={forget} style={{ minHeight: 42 }} />}
      </View>
      <ErrorText error={error || (robotError ? `Робот: ${robotError}` : '')} />
    </Surface>
  );
}

function RobotCard({ overview, refresh }: { overview: Overview; refresh: () => Promise<void> }) {
  const { sync, syncing, meta } = useAppState();
  const r = overview.robot;
  const hasErrors = !!(r && (r.errors.classroom || r.errors.eschool));
  return (
    <Surface style={styles.card}>
      <View style={styles.sourceHead}>
        <Dot color={!r ? colors.neutral400 : hasErrors ? colors.red : colors.green} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Хмарний робот</Text>
      </View>
      <Text style={styles.hint}>
        {r
          ? `Останній запуск: ${fmtTime(r.generatedAt)}. Завдань: ${r.counts.assignments}, зданих робіт: ${r.counts.submissions}, оцінок: ${r.counts.grades}.`
          : 'Робот ще не запускався.'}{' '}
        Він запускається сам щогодини з 7:00 до 22:00. Щоб запустити зараз: кнопка нижче → «Run workflow» → зелена «Run
        workflow». Через 3–5 хвилин натисніть «Оновити».
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="Запустити робота" onPress={() => openUrl(ROBOT_WORKFLOW_URL)} style={{ flex: 1 }} />
        <Btn
          title="Оновити"
          loading={syncing}
          onPress={async () => {
            await refresh();
            await sync();
          }}
          style={{ flex: 1 }}
        />
      </View>
      {meta.errors.map((e) => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}
    </Surface>
  );
}

// ─────────────────────────── Діти і Telegram ───────────────────────────

function chatName(c: Overview['chats'][number]): string {
  return c.title || (c.username ? `@${c.username}` : `чат ${c.chat_id}`);
}

function ChildrenCard({ overview, refresh }: { overview: Overview; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [cls, setCls] = useState('');
  const [codes, setCodes] = useState<Record<number, { code: string; expires_at: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chats = new Map(overview.chats.map((c) => [c.chat_id, c]));

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  };

  const add = async () => {
    setBusy(true);
    await run(async () => {
      await api.addChild(name.trim(), cls.trim());
      setName('');
      setCls('');
    });
    setBusy(false);
  };

  return (
    <Surface style={styles.card}>
      <Text style={styles.cardTitle}>Діти</Text>
      <Text style={styles.hint}>
        Щоб хтось із батьків отримував сповіщення в Telegram, натисніть «Код для Telegram» і надішліть боту отриманий
        рядок /link … з того чату (особистого чи групи). Код одноразовий і діє 24 години.
      </Text>
      {overview.children.length === 0 && <Text style={styles.hint}>Ще не додано жодної дитини.</Text>}
      {overview.children.map((c) => (
        <View key={c.id} style={[styles.childBox, styles.sep]}>
          <View style={styles.rowBaseline}>
            <Text style={styles.label}>
              {c.name}
              {c.class_name ? ` · ${c.class_name}` : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Видалити ${c.name}`}
              onPress={() => {
                if (confirmAction(`Видалити «${c.name}» разом з усіма прив’язками?`)) void run(() => api.deleteChild(c.id));
              }}>
              <Text style={styles.link}>Видалити</Text>
            </Pressable>
          </View>
          {c.chat_ids.length === 0 ? (
            <Text style={styles.hint}>Сповіщення ще нікому не приходять.</Text>
          ) : (
            c.chat_ids.map((id) => {
              const chat = chats.get(id);
              return (
                <View key={id} style={styles.rowBaseline}>
                  <Text style={styles.hint}>
                    → {chat ? chatName(chat) : `чат ${id}`}
                    {chat && !chat.is_active ? ' (вимкнено)' : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (confirmAction('Відв’язати цей чат від дитини?')) void run(() => api.unlink(id, c.id));
                    }}>
                    <Text style={styles.link}>Відв’язати</Text>
                  </Pressable>
                </View>
              );
            })
          )}
          {codes[c.id] ? (
            <View style={styles.codeBox}>
              <Text selectable style={styles.code}>
                /link {codes[c.id].code}
              </Text>
              <Text style={styles.hint}>Надішліть цей рядок боту. Діє до {fmtTime(codes[c.id].expires_at)}.</Text>
            </View>
          ) : null}
          <Btn
            title={codes[c.id] ? 'Новий код' : 'Код для Telegram'}
            onPress={() =>
              void run(async () => {
                const r = await api.linkCode(c.id);
                setCodes((m) => ({ ...m, [c.id]: r }));
              })
            }
          />
        </View>
      ))}
      <View style={[styles.sep, { paddingTop: 10, gap: 8 }]}>
        <Text style={styles.label}>Додати дитину</Text>
        <Field label="Ім’я" value={name} onChangeText={setName} placeholder="Олена" />
        <Field label="Клас (необов’язково)" value={cls} onChangeText={setCls} placeholder="7-А" />
        <Btn variant="primary" title="Додати" onPress={add} loading={busy} disabled={!name.trim()} />
      </View>
      <ErrorText error={error} />
    </Surface>
  );
}

function ChatsCard({ overview, refresh }: { overview: Overview; refresh: () => Promise<void> }) {
  const [error, setError] = useState('');
  const toggle = async (chatId: number, admin: boolean) => {
    setError('');
    try {
      await api.setAdmin(chatId, admin);
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Surface style={styles.card}>
      <Text style={styles.cardTitle}>Telegram</Text>
      <Text style={styles.hint}>
        Чати, які писали боту. «Доступ до налаштувань» дозволяє входити на цю сторінку (лише особисті чати).
      </Text>
      {overview.chats.length === 0 && <Text style={styles.hint}>Боту ще ніхто не писав.</Text>}
      {overview.chats.map((c, i) => (
        <View key={c.chat_id} style={[styles.toggleRow, i > 0 && styles.sep]}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.label}>
              {chatName(c)}
              {c.chat_id === overview.me.chat_id ? ' (ви)' : ''}
            </Text>
            <Text style={styles.hint}>
              {c.is_group ? 'група' : 'особистий чат'} · {c.is_active ? 'сповіщення увімкнено' : 'сповіщення вимкнено (/stop або бота заблоковано)'}
            </Text>
          </View>
          {!c.is_group && c.chat_id !== overview.me.chat_id && (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: c.is_admin }}
              accessibilityLabel={`Доступ до налаштувань: ${chatName(c)}`}
              onPress={() => {
                const msg = c.is_admin ? `Забрати в «${chatName(c)}» доступ до налаштувань?` : `Дати «${chatName(c)}» доступ до налаштувань?`;
                if (confirmAction(msg)) void toggle(c.chat_id, !c.is_admin);
              }}
              style={{ alignItems: 'center', gap: 2 }}>
              <Toggle on={c.is_admin} />
              <Text style={[styles.hint, { fontSize: 10.5 }]}>доступ</Text>
            </Pressable>
          )}
        </View>
      ))}
      <ErrorText error={error} />
    </Surface>
  );
}

// ─────────────────────────── Сповіщення ───────────────────────────

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


function NotificationsSection() {
  const { settings, updateSettings, loggedIn } = useAppState();
  return (
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
      </Surface>
      <Text style={[styles.hint, { paddingHorizontal: 2 }]}>
        {loggedIn
          ? 'Ці налаштування зберігаються на сервері.'
          : 'Без входу налаштування діють лише в цьому браузері.'}{' '}
        Поки сторінка відкрита, нові тривоги показуються й сповіщеннями браузера.
      </Text>
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
  );
}

function AdvancedSection() {
  const { settings, updateSettings } = useAppState();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Kicker>{open ? 'Додатково ▾' : 'Додатково ▸'}</Kicker>
      </Pressable>
      {open && (
        <>
          <Surface style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
            <ToggleRow
              first
              label="Демо-режим"
              hint={forcedDemo ? 'У цій збірці завжди увімкнено' : 'Вигадані дані. Вимикається сам після входу'}
              on={settings.demoMode}
              disabled={forcedDemo}
              onToggle={() => updateSettings({ demoMode: !settings.demoMode })}
            />
          </Surface>
          <Kicker>Відповідність предметів</Kicker>
          <SubjectsSection />
          <Mono style={{ fontSize: 10.5 }}>Сервер: {WORKER_URL}</Mono>
        </>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const { loggedIn, logout, resetData } = useAppState();
  const onUnauthorized = useCallback(() => void logout(), [logout]);
  const { data, error, refresh } = useOverview(loggedIn, onUnauthorized);

  return (
    <Screen>
      <ScreenHeader kicker="Конфігурація" title="Налаштування" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {!loggedIn ? (
          <Section title="Вхід">
            <LoginCard />
          </Section>
        ) : (
          <>
            <AccountCard overview={data} />
            <ErrorText error={error} />
            {data && (
              <>
                <Section title="Акаунти дитини">
                  <EschoolCard overview={data} refresh={refresh} />
                  <GoogleCard overview={data} refresh={refresh} />
                  <RobotCard overview={data} refresh={refresh} />
                </Section>
                <Section title="Діти і батьки">
                  <ChildrenCard overview={data} refresh={refresh} />
                  <ChatsCard overview={data} refresh={refresh} />
                </Section>
              </>
            )}
          </>
        )}

        <NotificationsSection />
        <AdvancedSection />

        <Btn
          title="Очистити історію сповіщень на цій сторінці"
          onPress={resetData}
          style={{ minHeight: 42 }}
          textStyle={{ color: colors.accent800 }}
        />
        <Mono style={{ fontSize: 10.5, textAlign: 'center' }}>Lesson Guard · дані оновлює хмарний робот щогодини</Mono>
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
  link: { fontFamily: fonts.body, fontSize: 12.5, color: colors.accent, fontWeight: '500' },
  childBox: { gap: 6, paddingTop: 10 },
  codeBox: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: 'rgba(89,128,166,0.08)' },
  code: { fontFamily: fonts.heading, fontWeight: '600', fontSize: 17, letterSpacing: 0.5, color: colors.text },
});
