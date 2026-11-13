import { type ReactNode, useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Theme,
  getSettings,
  saveSettings,
} from "../../repo/settings";
import { Button, Dialog, Notice, Page, TextInput, cx } from "../components";
import { useAsync } from "../hooks";
import { db, errorMessage, getApiKeyMasked, openDataDir, setApiKey } from "../services";
import { speechSupported } from "../speech";
import { applyTheme, onThemeChange } from "../theme";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel p-6 shadow-card ring-1 ring-line">
      <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4">
      <div className="pt-2 text-sm text-ink">{label}</div>
      <div>{children}</div>
    </div>
  );
}

/** 失去焦点或按 Enter 时保存的输入框 */
function SavedInput({
  label,
  value,
  onSave,
  ...props
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  type?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return (
    <TextInput
      {...props}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
    />
  );
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮" },
  { value: "dark", label: "暗" },
];

export default function SettingsPage() {
  const settings = useAsync(() => getSettings(db), []);
  const apiKey = useAsync(getApiKeyMasked, []);
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = async (changes: Partial<Settings>) => {
    try {
      await saveSettings(db, changes);
      setError(null);
      settings.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const updateNumber = (name: "dailyNew" | "slowSeconds", raw: string, max: number) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      setError(`请输入 1 到 ${max} 之间的整数`);
      settings.reload();
      return;
    }
    void update({ [name]: value });
  };

  const saveKey = async (key: string) => {
    try {
      await setApiKey(key);
      setNewKey("");
      setError(null);
      apiKey.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // 侧栏切换主题后同步显示
  const reloadSettings = settings.reload;
  useEffect(() => onThemeChange(() => reloadSettings()), [reloadSettings]);

  const current = settings.data;
  return (
    <Page title="设置" width="narrow">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-6">
        {(error ?? settings.error ?? apiKey.error) && (
          <div className="mb-4">
            <Notice tone="error">{error ?? settings.error ?? apiKey.error}</Notice>
          </div>
        )}
        {current && (
          <>
            <Section title="AI">
              <Row label="API key">
                <p className="mb-2 pt-2 font-mono text-sm text-ink">
                  {apiKey.data ?? <span className="font-sans text-ink-faint">未填写</span>}
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newKey.trim()) void saveKey(newKey);
                  }}
                >
                  <TextInput
                    type="password"
                    aria-label="新的 API key"
                    placeholder={apiKey.data ? "粘贴新的 key 以替换" : "粘贴 API key"}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                  <Button type="submit" className="shrink-0" disabled={!newKey.trim()}>
                    保存
                  </Button>
                  {apiKey.data && (
                    <Button variant="ghost" className="shrink-0" onClick={() => void saveKey("")}>
                      清除
                    </Button>
                  )}
                </form>
              </Row>
              <Row label="API 地址">
                <SavedInput
                  label="API 地址"
                  value={current.aiBaseUrl}
                  placeholder={DEFAULT_SETTINGS.aiBaseUrl}
                  onSave={(aiBaseUrl) => void update({ aiBaseUrl })}
                />
              </Row>
              <Row label="模型名">
                <SavedInput
                  label="模型名"
                  value={current.aiModel}
                  placeholder={DEFAULT_SETTINGS.aiModel}
                  onSave={(aiModel) => void update({ aiModel })}
                />
              </Row>
            </Section>

            <Section title="学习">
              <Row label="每日新短语数">
                <SavedInput
                  label="每日新短语数"
                  type="number"
                  min={1}
                  max={500}
                  className="w-28"
                  value={String(current.dailyNew)}
                  onSave={(v) => updateNumber("dailyNew", v, 500)}
                />
              </Row>
              <Row label="“写得慢”的时长（秒）">
                <SavedInput
                  label="写得慢的时长（秒）"
                  type="number"
                  min={1}
                  max={600}
                  className="w-28"
                  value={String(current.slowSeconds)}
                  onSave={(v) => updateNumber("slowSeconds", v, 600)}
                />
              </Row>
            </Section>

            <Section title="界面">
              <Row label="主题">
                <div
                  role="radiogroup"
                  aria-label="主题"
                  className="inline-flex rounded-xl bg-ink/5 p-0.5"
                >
                  {THEMES.map((theme) => (
                    <button
                      key={theme.value}
                      type="button"
                      role="radio"
                      aria-checked={current.theme === theme.value}
                      onClick={() => {
                        applyTheme(theme.value);
                        void update({ theme: theme.value });
                      }}
                      className={cx(
                        "h-8 rounded-[10px] px-3.5 text-sm transition-colors",
                        current.theme === theme.value
                          ? "bg-panel font-medium text-ink shadow-card"
                          : "text-ink-soft hover:text-ink",
                      )}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
              </Row>
            </Section>

            <Section title="声音">
              {speechSupported && (
                <Row label="自动朗读">
                  <label className="inline-flex cursor-pointer items-center gap-2.5 pt-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={current.autoSpeak}
                      onChange={(e) => void update({ autoSpeak: e.target.checked })}
                    />
                    开启
                  </label>
                </Row>
              )}
              <Row label="打字音效">
                <label className="inline-flex cursor-pointer items-center gap-2.5 pt-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={current.typingSound}
                    onChange={(e) => void update({ typingSound: e.target.checked })}
                  />
                  开启
                </label>
              </Row>
            </Section>

            <Section title="数据">
              <Row label="数据文件夹">
                <Button onClick={() => setConfirmOpen(true)}>打开数据文件夹</Button>
              </Row>
            </Section>
          </>
        )}
      </div>

      {confirmOpen && (
        <Dialog
          title="打开数据文件夹"
          confirmLabel="打开"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            openDataDir().catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          复制数据前请先退出应用，否则复制出的数据库可能不完整。
        </Dialog>
      )}
    </Page>
  );
}
