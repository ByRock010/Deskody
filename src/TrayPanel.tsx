import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Check,
  Headphones,
  ListFilter,
  Music2,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { api, desktop } from "./bridge";
import { matcherLabel } from "./settings";
import type { Snapshot } from "./types";
import { version } from "../package.json";
import "./tray.css";

export default function TrayPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const update = (next: Snapshot) => {
      if (active) setSnapshot(next);
    };
    const fail = (reason: unknown) => {
      if (active) setError(String(reason));
    };
    // Subscribe before reading so a save in the main window cannot be missed.
    void api
      .subscribe(update)
      .then(async (stop) => {
        if (!active) {
          stop();
          return;
        }
        unsubscribe = stop;
        update(await api.snapshot());
      })
      .catch(fail);
    const focus = () => {
      void api.snapshot().then(update).catch(fail);
      closeButton.current?.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && desktop) {
        event.preventDefault();
        void api.closePanel().catch(fail);
      }
    };
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", key);
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const change = (patch: Parameters<typeof api.quickChange>[0]) =>
    run(async () => {
      const settings = await api.quickChange(patch);
      setSnapshot((s) => (s ? { ...s, settings } : s));
    });
  const status = snapshot?.status;
  const settings = snapshot?.settings;
  const player = status?.player;
  const enabled = settings?.enabled ?? false;
  const disabled = busy || !desktop;
  const activeRule = enabled
    ? settings?.rules.find(
        (rule) => rule.id === status?.activeRule && rule.enabled,
      )
    : undefined;
  const rules = [...(settings?.rules ?? [])].sort(
    (a, b) =>
      Number(b.action.kind === "pause") - Number(a.action.kind === "pause") ||
      b.priority - a.priority ||
      a.name.localeCompare(b.name),
  );

  return (
    <main
      className="tray-panel"
      aria-label="Deskody hızlı kontrol"
      aria-busy={busy}
    >
      <header className="tray-header">
        <div className="tray-brand">
          <span>
            <AudioLines size={19} />
          </span>
          <div>
            <strong>Deskody</strong>
            <p>Müzik, odağına eşlik etsin.</p>
          </div>
        </div>
        <button
          ref={closeButton}
          className="tray-icon-button"
          aria-label="Paneli kapat"
          disabled={!desktop}
          onClick={() => void run(api.closePanel)}
        >
          <X size={18} />
        </button>
      </header>
      {!snapshot ? (
        <div className="tray-loading" role="status">
          {error || "Kontroller yükleniyor…"}
        </div>
      ) : (
        <>
          <div className="tray-content">
            {!desktop && (
              <p className="tray-hint">
                Web önizlemesi · Kontroller masaüstünde kullanılabilir.
              </p>
            )}
            <section
              className={`tray-flow ${enabled ? "enabled" : ""}`}
              aria-label="Akış kontrolü"
            >
              <div className="tray-row">
                <div>
                  <h1>Akış kontrolü</h1>
                  <p>
                    {enabled
                      ? "Müzik, kurallarına göre değişir"
                      : "Müziğin kontrolü sende"}
                  </p>
                </div>
                <button
                  className={`toggle ${enabled ? "on" : ""}`}
                  role="switch"
                  aria-label="Akış kontrolü"
                  aria-checked={enabled}
                  disabled={disabled}
                  onClick={() =>
                    void change({ kind: "enabled", enabled: !enabled })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="tray-context">
                <span className={enabled ? "live-dot" : "idle-dot"} />
                <span>
                  {enabled
                    ? status?.context.app ||
                      status?.lastContext?.app ||
                      "Bağlam bekleniyor"
                    : "Otomasyon kapalı"}
                </span>
                {activeRule && (
                  <span className="tray-active-name" title={activeRule.name}>
                    {activeRule.name}
                  </span>
                )}
              </div>
            </section>
            <section className="tray-player" aria-label="Oynatıcı">
              <div className="tray-row">
                <span className="tray-art">
                  <Music2 size={23} />
                </span>
                <div className="tray-track">
                  <p className="tray-eyebrow">
                    {player?.name || "Müzik oynatıcı"}
                  </p>
                  <h2 title={player?.track}>
                    {player?.track ||
                      (player ? "Parça bilgisi yok" : "Oynatıcı bekleniyor")}
                  </h2>
                  <p title={player?.artist}>
                    {player?.artist ||
                      (player
                        ? player.playing === true
                          ? "Çalıyor"
                          : player.playing === false
                            ? "Duraklatıldı"
                            : "Durum bilinmiyor"
                        : "Spotify veya YouTube Music’i aç")}
                  </p>
                </div>
                <button
                  className="tray-play"
                  aria-label={
                    player?.playing === true ? "Müziği duraklat" : "Müziği çal"
                  }
                  disabled={
                    disabled ||
                    !player ||
                    (player.playing === true
                      ? !player.canPause
                      : !player.canPlay)
                  }
                  onClick={() =>
                    void run(() =>
                      api.media(player?.playing === true ? "pause" : "play"),
                    )
                  }
                >
                  {player?.playing === true ? (
                    <Pause size={19} fill="currentColor" />
                  ) : (
                    <Play size={19} fill="currentColor" />
                  )}
                </button>
              </div>
              {status?.manualOverride && (
                <button
                  className="tray-resume"
                  disabled={disabled || !enabled}
                  onClick={() => void run(() => api.media("resumeAutomation"))}
                >
                  <RotateCcw size={14} />
                  {enabled
                    ? "Elle duraklatıldı · Otomasyona dön"
                    : "Devam etmek için akış kontrolünü aç"}
                </button>
              )}
            </section>
            <section className="tray-rules" aria-labelledby="tray-rules-title">
              <div className="tray-section-heading">
                <h2 id="tray-rules-title">
                  <ListFilter size={15} />
                  Kurallarım
                </h2>
                <span>
                  {rules.filter((r) => r.enabled).length} / {rules.length} açık
                </span>
              </div>
              {!enabled && rules.length > 0 && (
                <p className="tray-hint">
                  Seçimlerin kaydedilir; akış kontrolünü açınca uygulanır.
                </p>
              )}
              <div className="tray-rule-list">
                {rules.map((rule) => (
                  <div
                    className={`tray-rule ${activeRule?.id === rule.id ? "active" : ""}`}
                    key={rule.id}
                  >
                    <span className="tray-rule-icon">
                      {activeRule?.id === rule.id ? (
                        <Check size={16} />
                      ) : rule.action.kind === "pause" ? (
                        <Pause size={16} />
                      ) : (
                        <Headphones size={16} />
                      )}
                    </span>
                    <div className="tray-rule-label">
                      <strong title={rule.name}>{rule.name}</strong>
                      <p title={matcherLabel(rule.matcher)}>
                        {matcherLabel(rule.matcher)}
                      </p>
                    </div>
                    <button
                      className={`toggle ${rule.enabled ? "on" : ""}`}
                      role="switch"
                      aria-label={`${rule.name} kuralı`}
                      aria-checked={rule.enabled}
                      disabled={disabled}
                      onClick={() =>
                        void change({
                          kind: "rule",
                          id: rule.id,
                          enabled: !rule.enabled,
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
                {!rules.length && (
                  <p className="tray-empty">
                    Henüz kural yok. Ana uygulamada ilk kuralını oluştur.
                  </p>
                )}
              </div>
            </section>
            {(error || status?.error) && (
              <div className="tray-error" role="alert">
                <p>{error || status?.error}</p>
                <button
                  disabled={disabled}
                  onClick={() => void run(api.refresh)}
                >
                  <RefreshCw size={13} />
                  Tekrar dene
                </button>
              </div>
            )}
          </div>
          <footer className="tray-footer">
            <button
              className="tray-open"
              disabled={!desktop}
              onClick={() => void run(api.openMain)}
            >
              Deskody’yi aç
              <ArrowUpRight size={17} />
            </button>
            <div className="tray-footer-meta">
              <span>v{version}</span>
              <div>
                <button
                  className="tray-icon-button"
                  aria-label="Durumu yenile"
                  title="Durumu yenile"
                  disabled={disabled}
                  onClick={() => void run(api.refresh)}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="tray-icon-button"
                  aria-label="Deskody’den çık"
                  title="Deskody’den çık"
                  disabled={disabled}
                  onClick={() => void run(api.quit)}
                >
                  <Power size={14} />
                </button>
              </div>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
