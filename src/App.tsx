import { version as appVersion } from "../package.json";
import { ApplicationPicker } from "./ApplicationPicker";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Code2,
  Disc3,
  ExternalLink,
  Globe2,
  Headphones,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Monitor,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { api, desktop } from "./bridge";
import {
  parseImport,
  targetsSpotify,
  validateRule,
  matcherLabel,
  mergeQuickChanges,
} from "./settings";
import type { Rule, Settings, Snapshot } from "./types";

type Page = "overview" | "rules" | "activity" | "settings";
const navigation = [
  { id: "overview", label: "Genel bakış", icon: LayoutDashboard },
  { id: "rules", label: "Kurallarım", icon: ListFilter },
  { id: "activity", label: "Etkinlik", icon: Activity },
  { id: "settings", label: "Ayarlar", icon: Settings2 },
] as const;

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function IconBox({
  children,
  color = "sage",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`icon-box ${color}`}>{children}</span>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [token, setToken] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  const settingsRef = useRef<Settings | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const update = (next: Snapshot) => {
      if (!active) return;
      setSnapshot(next);
      const previous = settingsRef.current;
      settingsRef.current = next.settings;
      setDraft((current) =>
        !dirtyRef.current || !current || !previous
          ? next.settings
          : mergeQuickChanges(current, previous, next.settings),
      );
      setEditing((current) => {
        if (!current || !previous) return current;
        const before = previous.rules.find((r) => r.id === current.id);
        const after = next.settings.rules.find((r) => r.id === current.id);
        return before && after && before.enabled !== after.enabled
          ? { ...current, enabled: after.enabled }
          : current;
      });
    };
    void api
      .subscribe(update)
      .then((fn) => {
        if (!active) fn();
        else unsubscribe = fn;
      })
      .catch((error) => {
        if (active) setNotice({ message: String(error), error: true });
      });
    void api
      .snapshot()
      .then(update)
      .catch((error) => {
        if (active) setNotice({ message: String(error), error: true });
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const change = (patch: Partial<Settings>) => {
    dirtyRef.current = true;
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const execute = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await work();
      if (success) setNotice({ message: success, error: false });
      return true;
    } catch (error) {
      setNotice({ message: String(error), error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async (value = draft) => {
    if (!value) return false;
    dirtyRef.current = true;
    return execute(
      async () => {
        const settings = await api.save(value);
        dirtyRef.current = false;
        setDraft(settings);
        setSnapshot((s) => (s ? { ...s, settings } : s));
      },
      desktop
        ? "Ayarlar kaydedildi"
        : "Önizleme ayarları bu tarayıcıya kaydedildi",
    );
  };
  const newRule = () =>
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      enabled: true,
      priority: 50,
      matcher: { kind: "apps", value: [] },
      action: { kind: "play", playlist: null },
    });
  const dirty =
    draft &&
    snapshot &&
    JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  const enabledRules = draft?.rules.filter((r) => r.enabled).length ?? 0;

  if (!snapshot || !draft)
    return (
      <div className="loading">
        <AudioLines size={36} />
        <h1>Deskody</h1>
        <p>{notice?.message || "Çalışma alanın hazırlanıyor…"}</p>
        {notice && (
          <button className="button" onClick={() => location.reload()}>
            Yeniden dene
          </button>
        )}
      </div>
    );
  const { status, permissions, players } = snapshot;
  const running = desktop && status.enabled;
  const focused =
    running && !!status.activeRule && !status.manualOverride && !status.error;
  const rules = draft.rules
    .filter((r) =>
      `${r.name} ${matcherLabel(r.matcher)}`
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
    )
    .sort(
      (a, b) =>
        Number(b.action.kind === "pause") - Number(a.action.kind === "pause") ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );
  const ruleRows = (items: Rule[]) =>
    items.map((rule) => (
      <div
        className={`rule-row ${!rule.enabled ? "disabled-row" : ""}`}
        key={rule.id}
      >
        <IconBox
          color={
            rule.action.kind === "pause"
              ? "amber"
              : rule.matcher.kind === "fileExtension"
                ? "lavender"
                : "sage"
          }
        >
          {rule.action.kind === "pause" ? (
            <Pause size={18} />
          ) : rule.matcher.kind === "fileExtension" ? (
            <BookOpen size={18} />
          ) : rule.matcher.kind === "domain" ? (
            <Globe2 size={18} />
          ) : (
            <Code2 size={18} />
          )}
        </IconBox>
        <button
          className="rule-name"
          onClick={() => setEditing(structuredClone(rule))}
        >
          <strong>{rule.name}</strong>
          <span>
            {matcherLabel(rule.matcher)} <ArrowRight size={11} />{" "}
            {rule.action.kind === "pause"
              ? "Müziği duraklat"
              : rule.action.playlist
                ? rule.action.playlist.startsWith("https://music.youtube.com/")
                  ? "YouTube Music · şarkı / liste"
                  : "Spotify · şarkı / liste / albüm"
                : "Mevcut müziği çal"}
          </span>
        </button>
        {status.activeRule === rule.id && (
          <span className="small-badge active">AKTİF</span>
        )}
        <span className="priority" title="Öncelik">
          {rule.priority}
        </span>
        <Toggle
          checked={rule.enabled}
          label={`${rule.name} kuralı`}
          disabled={busy}
          onChange={(enabled) =>
            void save({
              ...draft,
              rules: draft.rules.map((r) =>
                r.id === rule.id ? { ...r, enabled } : r,
              ),
            })
          }
        />
        <button
          className="icon-button"
          aria-label={`${rule.name} düzenle`}
          onClick={() => setEditing(structuredClone(rule))}
        >
          <Pencil size={15} />
        </button>
      </div>
    ));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          <div>Deskody</div>
        </div>
        <div className="workspace-label">KİŞİSEL ÇALIŞMA ALANIN</div>
        <nav aria-label="Ana menü">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "nav-item selected" : "nav-item"}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
              {id === "rules" && (
                <span className="nav-count">{draft.rules.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-orbit">
            <Headphones size={23} />
          </div>
          <h3>Sen işine odaklan.</h3>
          <p>
            Müziğin ritmini
            <br />
            biz takip edelim.
          </p>
          <span>DAHA AZ DİKKAT DAĞINIKLIĞI</span>
        </div>
        <div className="local-label">
          <ShieldCheck size={14} />
          <span>Yerel çalışır. Sana özel.</span>
        </div>
        <div className="platform-label">
          <Monitor size={15} />
          <span>{permissions.platform}</span>
          <span className="version">v{appVersion}</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Çalışma alanı <ChevronRight size={14} />
            <span>{navigation.find((n) => n.id === page)?.label}</span>
          </div>
          <div className={`connection ${running ? "online" : ""}`}>
            <span />
            {running
              ? "Arka planda çalışıyor"
              : desktop
                ? "Otomasyon kapalı"
                : "Arayüz önizlemesi"}
          </div>
        </header>
        <div className="content">
          {!desktop && (
            <div className="preview-banner">
              <Monitor size={16} />
              <span>
                Web önizlemesi · Müzik ve pencere algılama, masaüstü
                uygulamasında çalışır.
              </span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">MÜZİĞİN, AKIŞINA UYSUN</div>
              <h1>
                {page === "overview"
                  ? "Odağın burada."
                  : page === "rules"
                    ? "Senin akışın. Senin kuralların."
                    : page === "activity"
                      ? "Arka planda neler oluyor?"
                      : "Her şey, senin ayarında."}
              </h1>
              <p>
                {page === "overview"
                  ? "Uygulamalar değişir. Müziğin sana eşlik eder."
                  : page === "rules"
                    ? "Bir bağlam seç, müziğin ne yapacağını belirle."
                    : page === "activity"
                      ? "Bu oturumdaki otomasyon kararlarını takip et."
                      : "Oynatıcını bağla, izinlerini ve geçişlerini yönet."}
              </p>
            </div>
            {page === "rules" ? (
              <button className="button primary" onClick={newRule}>
                <Plus size={16} />
                Yeni kural
              </button>
            ) : (
              <button
                className="icon-button refresh"
                title="Durumu yenile"
                aria-label="Durumu yenile"
                disabled={busy}
                onClick={() => void execute(api.refresh)}
              >
                <RefreshCw size={18} />
              </button>
            )}
          </div>

          {status.error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <div>
                <strong>Bir bağlantıya ihtiyacımız var</strong>
                <p>{status.error}</p>
              </div>
              <button
                className="text-button"
                onClick={() => setPage("settings")}
              >
                Ayarlar <ArrowRight size={14} />
              </button>
            </div>
          )}

          {page === "overview" && (
            <>
              <section className={`focus-card ${focused ? "is-focused" : ""}`}>
                <div className="focus-top">
                  <span className="chip">
                    <span className="dot" />
                    {focused ? "ODAK MODU" : "AKILLI OTOMASYON"}
                  </span>
                  <Toggle
                    checked={draft.enabled}
                    label="Otomasyonu etkinleştir"
                    disabled={busy || !desktop}
                    onChange={(enabled) => void save({ ...draft, enabled })}
                  />
                </div>
                <div className="focus-copy">
                  <h2>
                    {focused
                      ? "Ritmini buldun."
                      : running
                        ? "Akışını dinliyoruz."
                        : "Biraz müzik.\nDaha çok odak."}
                  </h2>
                  <p>
                    {focused
                      ? status.decision
                      : running
                        ? "Aktif uygulaman bir kuralla eşleştiğinde müziğin hazır."
                        : "Otomasyonu aç. Müziğin, çalıştığın uygulamaya göre kendiliğinden değişsin."}
                  </p>
                </div>
                <div
                  className={`record-art ${status.player?.playing ? "spinning" : ""}`}
                  aria-hidden="true"
                >
                  <div className="record">
                    <div className="record-label">
                      <AudioLines size={31} />
                      <span>IN YOUR FLOW</span>
                    </div>
                  </div>
                  <span className="record-spark spark-one">✦</span>
                  <span className="record-spark spark-two">✦</span>
                </div>
                <div className="focus-bottom">
                  <div>
                    <Monitor size={15} />
                    <span>{status.context.app || "Bağlam bekleniyor"}</span>
                  </div>
                  <span className="focus-divider" />
                  <div>
                    <AudioLines size={15} />
                    <span>
                      {status.manualOverride
                        ? "Manuel kontrol"
                        : status.decision}
                    </span>
                  </div>
                </div>
              </section>

              <div className="stat-grid">
                <div className="stat">
                  <IconBox>
                    <ListFilter size={18} />
                  </IconBox>
                  <div>
                    <span>Etkin kurallar</span>
                    <strong>
                      {enabledRules}
                      <small> / {draft.rules.length}</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <IconBox color="lavender">
                    <Volume2 size={18} />
                  </IconBox>
                  <div>
                    <span>Yumuşak geçiş</span>
                    <strong>
                      {(draft.fadeMs / 1000).toLocaleString("tr")}
                      <small> saniye</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <IconBox color="amber">
                    <ShieldCheck size={18} />
                  </IconBox>
                  <div>
                    <span>Video koruması</span>
                    <strong className="stat-text">Her zaman hazır</strong>
                  </div>
                </div>
              </div>

              <div className="overview-grid">
                <section className="panel now-playing">
                  <div className="section-title">
                    <h2>Şimdi çalan</h2>
                    <Radio size={16} />
                  </div>
                  <div className="album-art">
                    <div className="album-horizon" />
                    <Music2 size={35} />
                    <span>
                      FIND YOUR
                      <br />
                      <b>FREQUENCY.</b>
                    </span>
                  </div>
                  <div className="track-info">
                    <h3>{status.player?.track || "Sıradaki ritim, senin."}</h3>
                    <p>
                      {status.player?.artist || "Oynatıcını aç ve akışa katıl."}
                    </p>
                  </div>
                  <div className="player-footer">
                    <span className="player-label">
                      <span className={status.player ? "dot" : "dot neutral"} />
                      {status.player?.name ||
                        (draft.provider === "spotify"
                          ? "Spotify"
                          : "Oynatıcı seçilmedi")}
                    </span>
                    <button
                      className="play-button"
                      aria-label={
                        status.player?.playing
                          ? "Müziği duraklat"
                          : "Müziği çal"
                      }
                      disabled={busy || !desktop || !status.player}
                      onClick={() =>
                        void execute(() =>
                          api.media(status.player?.playing ? "pause" : "play"),
                        )
                      }
                    >
                      {status.player?.playing ? (
                        <Pause size={17} fill="currentColor" />
                      ) : (
                        <Play size={17} fill="currentColor" />
                      )}
                    </button>
                  </div>
                </section>
                <section className="panel rules-preview">
                  <div className="section-title">
                    <h2>
                      Akış kuralların <span>{draft.rules.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("rules")}
                    >
                      Tümünü gör <ArrowRight size={14} />
                    </button>
                  </div>
                  {ruleRows(
                    [...draft.rules]
                      .sort((a, b) => b.priority - a.priority)
                      .slice(0, 3),
                  )}
                  <div className="interrupt-note">
                    <ShieldCheck size={16} />
                    <p>
                      YouTube ve Netflix açıldığında müzik duraklar.
                      <span>
                        Kesici kurallar, diğer tüm kurallardan önce gelir.
                      </span>
                    </p>
                    <LockKeyhole size={13} />
                  </div>
                  <button className="add-rule" onClick={newRule}>
                    <Plus size={16} />
                    Yeni bir bağlam ekle
                  </button>
                </section>
              </div>
              {status.manualOverride && (
                <div className="preview-banner">
                  <Pause size={16} />
                  <span>
                    Müzik elle duraklatıldı. Bu bağlamda otomatik başlatma
                    bekletiliyor.
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      void execute(() => api.media("resumeAutomation"))
                    }
                  >
                    Otomasyona dön
                  </button>
                </div>
              )}
              <div className="quiet-footer">
                <Sparkles size={14} />
                Küçük bir otomasyon. Kesintisiz bir çalışma alanı.
              </div>
            </>
          )}

          {page === "rules" && (
            <>
              <section
                className="panel rule-diagnostics"
                aria-label="Kural durumu"
              >
                <div className="section-title">
                  <h2>Kural durumu</h2>
                  <span className="small-badge">
                    {status.enabled ? "OTOMASYON AÇIK" : "OTOMASYON KAPALI"}
                  </span>
                </div>
                <p>
                  {status.error ||
                    (status.manualOverride
                      ? "Müzik elle duraklatıldı; otomasyon bekliyor."
                      : status.decision)}
                </p>
                <dl>
                  <dt>Kontrol edilen oynatıcı</dt>
                  <dd>
                    {status.player?.name ||
                      (draft.targetPlayer
                        ? `${draft.targetPlayer} · bulunamadı`
                        : "Oynatıcı seçilmedi")}
                  </dd>
                  <dt>Son çalışma uygulaması</dt>
                  <dd>
                    {status.lastContext?.app || "Henüz algılanmadı"}{" "}
                    {status.lastContext?.appId && (
                      <code>{status.lastContext.appId}</code>
                    )}
                  </dd>
                  <dt>Pencere / dosya / sekme</dt>
                  <dd>
                    {status.lastContext?.document ||
                      status.lastContext?.url ||
                      status.lastContext?.title ||
                      "Okunamadı"}
                  </dd>
                  <dt>Son kural olayı</dt>
                  <dd>
                    {status.activity.find((item) => item.message.includes("→"))
                      ?.message || "Henüz bir kural uygulanmadı"}
                  </dd>
                </dl>
                {permissions.platform === "macOS" &&
                  !permissions.accessibility && (
                    <p className="form-error">
                      Pencere başlığı ve PDF dosyalarını algılamak için
                      Ayarlar’dan Erişilebilirlik izni verin. Uygulama adı
                      kuralları bu izin olmadan da çalışır.
                    </p>
                  )}
                {!targetsSpotify(draft) && (
                  <p className="helper">
                    Bağlantılar yalnızca kendi müzik kaynağında kullanılır. Boş
                    alan seçili oynatıcının mevcut müziğini devam ettirir.
                  </p>
                )}
              </section>
              <div className="rules-toolbar">
                <div className="search">
                  <ListFilter size={16} />
                  <input
                    aria-label="Kural ara"
                    placeholder="Kurallarında ara…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  className="text-button"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} />
                  İçe aktar
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(draft.rules, null, 2)],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "deskody-rules.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <ArrowDownToLine size={15} />
                  Dışa aktar
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void execute(async () => {
                        if (file.size > 100000)
                          throw new Error("Dosya 100 KB sınırını aşıyor.");
                        const imported = parseImport(await file.text());
                        if (draft.rules.length + imported.length > 100)
                          throw new Error(
                            "Toplam en fazla 100 kural eklenebilir.",
                          );
                        change({ rules: [...draft.rules, ...imported] });
                      }, "Kurallar eklendi. Değişiklikleri kaydedin.");
                    event.target.value = "";
                  }}
                />
              </div>
              <section className="panel">
                <div className="locked-rule">
                  <IconBox color="amber">
                    <ShieldCheck size={18} />
                  </IconBox>
                  <div>
                    <strong>Video ve medya koruması</strong>
                    <p>
                      YouTube Watch / Shorts, Netflix
                      {draft.pauseOnOtherAudio ? " ve diğer aktif medya" : ""} →
                      duraklat
                    </p>
                  </div>
                  <span className="small-badge">EN YÜKSEK ÖNCELİK</span>
                  <LockKeyhole size={15} />
                </div>
                {ruleRows(rules)}
                {!rules.length && (
                  <div className="empty">
                    <ListFilter size={30} />
                    <h3>
                      {query ? "Eşleşen kural yok" : "İlk kuralını oluştur"}
                    </h3>
                    <p>
                      {query
                        ? "Farklı bir kelimeyle aramayı dene."
                        : "Aktif uygulamana göre bir müzik davranışı seç."}
                    </p>
                  </div>
                )}
              </section>
              <p className="helper">
                <SlidersHorizontal size={14} />
                Büyük öncelik değeri önce uygulanır. Eşitlikte kural kimliği
                sıralaması kullanılır.
              </p>
            </>
          )}

          {page === "activity" && (
            <section className="panel">
              <div className="section-title">
                <h2>Bu oturum</h2>
                <span className="small-badge">SON 40 OLAY</span>
              </div>
              {status.activity.length ? (
                status.activity.map((item, index) => (
                  <div className="activity-row" key={`${item.time}-${index}`}>
                    <IconBox color={item.level === "error" ? "amber" : "sage"}>
                      {item.level === "error" ? (
                        <CircleHelp size={17} />
                      ) : (
                        <Check size={17} />
                      )}
                    </IconBox>
                    <div>
                      <strong>{item.message}</strong>
                      <span>
                        {new Date(item.time * 1000).toLocaleTimeString("tr-TR")}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Activity size={34} />
                  <h3>Henüz bir etkinlik yok</h3>
                  <p>
                    Otomasyon kararları burada görünecek.
                    <br />
                    Etkinlikler diske kaydedilmez.
                  </p>
                </div>
              )}
            </section>
          )}

          {page === "settings" && (
            <div className="settings-stack">
              <section className="panel">
                <div className="section-title">
                  <h2>
                    <Headphones size={18} />
                    Müzik kaynağı
                  </h2>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void execute(api.refresh)}
                  >
                    Yenile <RefreshCw size={14} />
                  </button>
                </div>
                <div className="provider-options">
                  <button
                    className={
                      draft.provider === "spotify"
                        ? "provider selected-provider"
                        : "provider"
                    }
                    onClick={() =>
                      change({ provider: "spotify", targetPlayer: "" })
                    }
                  >
                    <Disc3 size={27} />
                    <div>
                      <strong>Spotify</strong>
                      <span>Yerel uygulama kontrolü</span>
                    </div>
                    {draft.provider === "spotify" && <CheckCheck size={17} />}
                  </button>
                  <button
                    className={
                      draft.provider === "system"
                        ? "provider selected-provider"
                        : "provider"
                    }
                    onClick={() => change({ provider: "system" })}
                  >
                    <Music2 size={27} />
                    <div>
                      <strong>Diğer oynatıcılar</strong>
                      <span>YouTube Music, Apple Music, MPRIS</span>
                    </div>
                    {draft.provider === "system" && <CheckCheck size={17} />}
                  </button>
                </div>
                {(draft.provider === "system" || draft.spotifyWeb) && (
                  <label className="field">
                    Kontrol edilecek oynatıcı
                    <select
                      value={draft.targetPlayer}
                      onChange={(e) => change({ targetPlayer: e.target.value })}
                    >
                      <option value="">Oynatıcı seçin</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      {draft.provider === "system" &&
                        !players.some(
                          (p) => p.id === "browser:music.youtube.com",
                        ) && (
                          <option value="browser:music.youtube.com">
                            YouTube Music · tarayıcı eklentisi
                          </option>
                        )}
                      {draft.targetPlayer &&
                        !players.some((p) => p.id === draft.targetPlayer) &&
                        draft.targetPlayer !== "browser:music.youtube.com" && (
                          <option value={draft.targetPlayer}>
                            {draft.targetPlayer} (çevrimdışı)
                          </option>
                        )}
                    </select>
                  </label>
                )}
                {draft.provider === "spotify" && (
                  <>
                    <div className="setting-row">
                      <div>
                        <strong>Spotify Web API</strong>
                        <p>
                          Windows'ta bağlantıdan müzik başlatma ve tüm
                          platformlarda Spotify Connect.
                        </p>
                      </div>
                      <Toggle
                        label="Spotify Web API"
                        checked={draft.spotifyWeb}
                        onChange={(spotifyWeb) =>
                          change({ spotifyWeb, targetPlayer: "" })
                        }
                      />
                    </div>
                    {draft.spotifyWeb && (
                      <>
                        <label className="field">
                          Spotify Developer Client ID
                          <input
                            value={draft.spotifyClientId}
                            maxLength={32}
                            spellCheck={false}
                            placeholder="32 karakterlik Client ID"
                            onChange={(e) =>
                              change({ spotifyClientId: e.target.value.trim() })
                            }
                          />
                          <small>
                            Developer Dashboard'da Redirect URI:{" "}
                            <code>http://127.0.0.1:43828/callback</code>
                          </small>
                        </label>
                        <p className="helper">
                          Premium üyelik ve Developer uygulama erişimi gerekir.
                          Önce ayarları kaydet, hesabını bağla, ardından bu
                          bilgisayarın Spotify cihazını seç. Anahtarlar sistemin
                          güvenli deposunda tutulur.
                        </p>
                        <div className="permission-actions">
                          <button
                            className="button secondary"
                            disabled={
                              !desktop ||
                              busy ||
                              !!dirty ||
                              !draft.spotifyClientId
                            }
                            onClick={() =>
                              void execute(
                                () => api.spotify(),
                                "Spotify hesabı bağlandı. Cihazını seçip kaydet.",
                              )
                            }
                          >
                            Spotify hesabını bağla <ExternalLink size={14} />
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              !desktop || busy || !draft.spotifyClientId
                            }
                            onClick={() =>
                              void execute(
                                () => api.spotify(true),
                                "Spotify bağlantısı kaldırıldı",
                              )
                            }
                          >
                            Bağlantıyı kaldır
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
                <p className="helper">
                  Oynatıcı açık olmalı. Liste seçimi, sağlayıcının desteğine
                  bağlıdır. Mevcut müzik seçeneği açık oturumu devam ettirir.
                </p>
                <div className="setting-row">
                  <div>
                    <strong>Manuel medya tuşu</strong>
                    <p>Sistemin o anki medya hedefine Play/Pause gönderir.</p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!desktop || busy}
                    onClick={() => void execute(() => api.media("mediaKey"))}
                  >
                    <Play size={14} />
                    Gönder
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>
                    <SlidersHorizontal size={18} />
                    Otomasyon davranışı
                  </h2>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Başka medya çalarken duraklat</strong>
                    <p>Seçili müzik oynatıcısı algılamanın dışında tutulur.</p>
                  </div>
                  <Toggle
                    label="Diğer medya koruması"
                    checked={draft.pauseOnOtherAudio}
                    onChange={(pauseOnOtherAudio) =>
                      change({ pauseOnOtherAudio })
                    }
                  />
                </div>
                <label className="range-field">
                  <span>
                    Yumuşak geçiş <b>{draft.fadeMs} ms</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="3000"
                    step="100"
                    value={draft.fadeMs}
                    onChange={(e) => change({ fadeMs: Number(e.target.value) })}
                  />
                  <small>
                    Oynatıcı ses kontrolünü destekliyorsa uygulanır.
                  </small>
                </label>
                <div className="field-grid">
                  <label className="field">
                    Algılama aralığı
                    <select
                      value={draft.pollMs}
                      onChange={(e) =>
                        change({ pollMs: Number(e.target.value) })
                      }
                    >
                      {[750, 1000, 1500, 2000, 3000, 5000, 10000].map((n) => (
                        <option key={n} value={n}>
                          {n / 1000} saniye
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Bağlamın sabit kalma süresi
                    <select
                      value={draft.settleMs}
                      onChange={(e) =>
                        change({ settleMs: Number(e.target.value) })
                      }
                    >
                      {[500, 1000, 2000, 3000, 5000, 10000, 15000].map((n) => (
                        <option key={n} value={n}>
                          {n / 1000} saniye
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>
                    <ShieldCheck size={18} />
                    Sistem izinleri
                  </h2>
                  <span className="small-badge">{permissions.platform}</span>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Erişilebilirlik / pencere algılama</strong>
                    <p>
                      {permissions.accessibility
                        ? "Yerel pencere algılama kullanılabilir."
                        : "Pencere ve dosya bağlamı için izin gerekiyor."}
                    </p>
                  </div>
                  {permissions.accessibility ? (
                    <Check className="success-icon" size={20} />
                  ) : (
                    <button
                      className="button secondary"
                      disabled={!desktop || busy}
                      onClick={() =>
                        void execute(() => api.permission("accessibility"))
                      }
                    >
                      İzin ver <ExternalLink size={13} />
                    </button>
                  )}
                </div>
                <p className="helper">{permissions.automation}</p>
                <div className="permission-actions">
                  <button
                    className="text-button"
                    disabled={!desktop || busy}
                    onClick={() =>
                      void execute(
                        () => api.permission("automation"),
                        "İzin kontrolü tamamlandı",
                      )
                    }
                  >
                    Spotify erişimini kontrol et <ArrowRight size={14} />
                  </button>
                  <button
                    className="text-button"
                    disabled={!desktop || busy}
                    onClick={() =>
                      void execute(() => api.permission("settings"))
                    }
                  >
                    Sistem ayarları <ExternalLink size={14} />
                  </button>
                </div>
                {permissions.capabilities.map((c) => (
                  <div className="capability" key={c.name}>
                    <span className={`dot ${c.available ? "" : "neutral"}`} />
                    <div>
                      <strong>{c.name}</strong>
                      <p>{c.detail}</p>
                    </div>
                    <span>{c.available ? "Destekleniyor" : "Kısıtlı"}</span>
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>
                    <Globe2 size={18} />
                    Tarayıcı köprüsü
                  </h2>
                  <span
                    className={`small-badge ${status.bridgeConnected ? "active" : ""}`}
                  >
                    {status.bridgeConnected ? "BAĞLI" : "BAĞLI DEĞİL"}
                  </span>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Sekmeleri müziğinle eşleştir</strong>
                    <p>Firefox/Chromium sekmeleri ve YouTube Music kontrolü.</p>
                  </div>
                  <Toggle
                    label="Tarayıcı köprüsü"
                    checked={draft.browserBridge}
                    onChange={(browserBridge) => change({ browserBridge })}
                  />
                </div>
                <ol className="setup-steps">
                  <li>
                    Tarayıcıda geliştirici modunu açıp{" "}
                    <code>browser-extension</code> klasörünü paketlenmemiş
                    eklenti olarak yükle.
                  </li>
                  <li>
                    Bu ayarı kaydet. Eşleştirme anahtarını eklentinin ayarlarına
                    yapıştır.
                  </li>
                  <li>
                    YouTube Music için müzik kaynağından eklenti oynatıcısını
                    seç.
                  </li>
                </ol>
                <button
                  className="button secondary"
                  disabled={!desktop || busy}
                  onClick={() =>
                    void execute(async () => setToken(await api.token()))
                  }
                >
                  <LockKeyhole size={14} />
                  Eşleştirme anahtarını göster
                </button>
                {token && (
                  <div className="token-display">
                    <input
                      aria-label="Eşleştirme anahtarı"
                      readOnly
                      value={token}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="text-button"
                      onClick={() =>
                        void execute(
                          () => navigator.clipboard.writeText(token),
                          "Anahtar kopyalandı",
                        )
                      }
                    >
                      Kopyala
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Anahtarı gizle"
                      onClick={() => setToken("")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <p className="helper">
                  <LockKeyhole size={13} />
                  Yalnızca bu bilgisayara bağlanır. Gizli sekmeler paylaşılmaz.
                </p>
              </section>
            </div>
          )}
        </div>
        {dirty && (
          <div className="save-bar">
            <span>
              <span className="dot" />
              Kaydedilmemiş değişiklikler
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                dirtyRef.current = false;
                setDraft(snapshot.settings);
              }}
            >
              Vazgeç
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void save()}
            >
              <Save size={15} />
              {busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </button>
          </div>
        )}
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{notice.message}</span>
          <button
            className="icon-button"
            aria-label="Bildirimi kapat"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editing && (
        <RuleEditor
          rule={editing}
          spotify={targetsSpotify(draft)}
          busy={busy}
          lastApp={status.lastContext}
          onClose={() => setEditing(null)}
          onSave={async (rule) => {
            const saved = await save({
              ...draft,
              rules: draft.rules.some((r) => r.id === rule.id)
                ? draft.rules.map((r) => (r.id === rule.id ? rule : r))
                : [...draft.rules, rule],
            });
            if (saved) setEditing(null);
            return saved;
          }}
          onDelete={
            draft.rules.some((r) => r.id === editing.id)
              ? async () => {
                  const saved = await save({
                    ...draft,
                    rules: draft.rules.filter((r) => r.id !== editing.id),
                  });
                  if (saved) setEditing(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  spotify,
  busy,
  lastApp,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule;
  spotify: boolean;
  busy: boolean;
  lastApp?: Snapshot["status"]["context"] | null;
  onClose: () => void;
  onSave: (rule: Rule) => Promise<boolean>;
  onDelete?: () => void;
}) {
  const [value, setValue] = useState(rule);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Rule = {
      ...value,
      name: value.name.trim(),
      matcher:
        value.matcher.kind === "apps"
          ? value.matcher
          : { ...value.matcher, value: value.matcher.value.trim() },
      action:
        value.action.kind === "play"
          ? { kind: "play", playlist: value.action.playlist?.trim() || null }
          : value.action,
    };
    const issue = validateRule(next);
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    if (!(await onSave(next)))
      setError(
        "Kural kaydedilemedi. Düzenlemen korunuyor; tekrar deneyebilirsin.",
      );
  };
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      className="rule-dialog"
      onClick={(e) => {
        if (!busy && e.target === dialog.current) onClose();
      }}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="rule-fields">
          <div className="section-title">
            <div>
              <div className="eyebrow">AKIŞINI KİŞİSELLEŞTİR</div>
              <h2>{onDelete ? "Kuralı düzenle" : "Yeni bir kural"}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Kapat"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          <label className="field">
            Kural adı
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="Ör. Derin çalışma"
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              Şu bağlamda
              <select
                value={
                  value.matcher.kind === "app" ? "apps" : value.matcher.kind
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    matcher:
                      e.target.value === "apps"
                        ? { kind: "apps", value: [] }
                        : {
                            kind: e.target.value as
                              "domain" | "fileExtension" | "title",
                            value: "",
                          },
                  })
                }
              >
                <option value="apps">Uygulamalar</option>
                <option value="domain">Web sitesi</option>
                <option value="fileExtension">Dosya uzantısı</option>
                <option value="title">Pencere başlığı içerir</option>
              </select>
            </label>
            {value.matcher.kind !== "app" && value.matcher.kind !== "apps" && (
              <label className="field">
                Eşleşme
                <input
                  required
                  maxLength={300}
                  placeholder={
                    value.matcher.kind === "domain"
                      ? "github.com"
                      : value.matcher.kind === "fileExtension"
                        ? "pdf"
                        : "Proje adı"
                  }
                  value={value.matcher.value}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      matcher: {
                        kind: value.matcher.kind as
                          "domain" | "fileExtension" | "title",
                        value: e.target.value,
                      },
                    })
                  }
                />
              </label>
            )}
          </div>
          {(value.matcher.kind === "app" || value.matcher.kind === "apps") && (
            <ApplicationPicker
              selected={
                value.matcher.kind === "apps"
                  ? value.matcher.value
                  : value.matcher.value
                    ? [
                        {
                          id: value.matcher.value,
                          name: value.matcher.value,
                          aliases: [],
                        },
                      ]
                    : []
              }
              onChange={(apps) => {
                setValue({ ...value, matcher: { kind: "apps", value: apps } });
                setError("");
              }}
              lastApp={lastApp}
            />
          )}
          <label className="field">
            Müzik ne yapsın?
            <select
              value={value.action.kind}
              onChange={(e) =>
                setValue({
                  ...value,
                  action:
                    e.target.value === "pause"
                      ? { kind: "pause" }
                      : { kind: "play", playlist: null },
                })
              }
            >
              <option value="play">Müziği çal</option>
              <option value="pause">Müziği duraklat</option>
            </select>
          </label>
          {value.action.kind === "play" && (
            <label className="field">
              Müzik bağlantısı <span className="optional">isteğe bağlı</span>
              <input
                placeholder="Boş bırak: mevcut müziği devam ettir"
                value={value.action.playlist ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    action: { kind: "play", playlist: e.target.value || null },
                  })
                }
              />
              <small>
                {spotify
                  ? "Spotify şarkı, liste, albüm veya YouTube Music şarkı, liste, radyo, mix bağlantısı yapıştır. Bağlantı seçili müzik kaynağıyla eşleştiğinde kullanılır."
                  : "YouTube Music şarkı, liste, radyo veya mix bağlantısı yapıştır. Ayarlar’da YouTube Music kaynağı ve güncel tarayıcı eklentisi seçili olmalı. Spotify bağlantıları da kaydedilebilir."}
              </small>
            </label>
          )}
          <label className="field">
            Öncelik
            <input
              type="number"
              required
              min="0"
              max="999"
              step="1"
              value={value.priority}
              onChange={(e) =>
                setValue({ ...value, priority: Number(e.target.value) })
              }
            />
            <small>
              Yüksek değer önce uygulanır. Duraklatma kuralları her zaman
              öndedir.
            </small>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {onDelete && (
              <button
                type="button"
                className="text-button danger"
                onClick={onDelete}
              >
                <Trash2 size={15} />
                Sil
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Vazgeç
            </button>
            <button type="submit" className="button primary">
              <Check size={16} />
              {busy ? "Kaydediliyor…" : "Kuralı uygula"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
