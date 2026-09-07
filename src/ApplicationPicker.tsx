import { useEffect, useState } from "react";
import { Monitor, RefreshCw, Search, X } from "lucide-react";
import { api } from "./bridge";
import { validApplication } from "./settings";
import type { Context, InstalledApplication } from "./types";

function key(value: string) {
  const k = value
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
  return [
    "code",
    "vscode",
    "vs code",
    "visual studio code",
    "com.microsoft.vscode",
  ].includes(k)
    ? "com.microsoft.vscode"
    : k;
}
// Reconcile old hand-written names with installed IDs without dropping unavailable selections.
function same(selected: InstalledApplication, app: InstalledApplication) {
  return (
    key(selected.id) === key(app.id) ||
    key(selected.id) === key(app.name) ||
    app.aliases.some((a) => key(a) === key(selected.id))
  );
}
export function ApplicationPicker({
  selected,
  onChange,
  lastApp,
}: {
  selected: InstalledApplication[];
  onChange: (apps: InstalledApplication[]) => void;
  lastApp?: Context | null;
}) {
  const [apps, setApps] = useState<InstalledApplication[]>([]);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [manualError, setManualError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .applications()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  function update(next: InstalledApplication[]) {
    const canonical = next.map((s) => apps.find((a) => same(s, a)) || s);
    onChange(
      canonical.filter(
        (app, index) =>
          canonical.findIndex((a) => key(a.id) === key(app.id)) === index,
      ),
    );
  }
  function add(app: InstalledApplication) {
    if (!validApplication(app)) {
      setManualError("Geçerli bir uygulama adı veya kimliği girin.");
      return;
    }
    if (selected.length >= 64) {
      setManualError("En fazla 64 uygulama seçebilirsin.");
      return;
    }
    if (!selected.some((s) => same(s, app))) update([...selected, app]);
    setManual("");
    setManualError("");
  }
  const visible = apps.filter((app) =>
    `${app.name} ${app.id}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim()),
  );
  return (
    <section className="application-picker" aria-label="Uygulama seçimi">
      <div className="application-heading">
        <strong>Uygulamalar</strong>
        <span aria-live="polite">{selected.length} seçili</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Uygulama listesini yenile"
          disabled={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="application-hint">
        Seçtiğin uygulamalardan herhangi biri aktifken bu kural çalışır.
      </p>
      {selected.length > 0 && (
        <div className="application-chips" aria-label="Seçilen uygulamalar">
          {selected.map((app) => (
            <button
              key={app.id}
              type="button"
              aria-label={`${app.name} seçimini kaldır`}
              onClick={() => update(selected.filter((a) => a.id !== app.id))}
            >
              {apps.find((a) => same(app, a))?.name || app.name}
              <X size={13} />
            </button>
          ))}
        </div>
      )}
      <label className="application-search">
        <Search size={17} />
        <input
          type="search"
          aria-label="Uygulamalarda ara"
          placeholder="Uygulama ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {loading ? (
        <p role="status" className="application-hint">
          Uygulamalar bulunuyor…
        </p>
      ) : error ? (
        <p role="status" className="application-hint">
          {error}
        </p>
      ) : (
        <div
          className="application-list"
          role="group"
          aria-label="Bilgisayardaki uygulamalar"
        >
          {visible.map((app) => {
            const checked = selected.some((s) => same(s, app));
            return (
              <label
                className={`application-option ${checked ? "selected" : ""}`}
                key={app.id}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && selected.length >= 64}
                  onChange={() =>
                    checked
                      ? update(selected.filter((s) => !same(s, app)))
                      : add(app)
                  }
                />
                <Monitor size={18} aria-hidden="true" />
                <span>
                  {app.name}
                  {apps.filter((a) => a.name === app.name).length > 1 && (
                    <small>{app.id}</small>
                  )}
                </span>
              </label>
            );
          })}
          {!visible.length && (
            <p className="application-hint">
              {apps.length
                ? "Aramana uygun uygulama bulunamadı."
                : "Bu konumlarda uygulama bulunamadı. Listeyi yenileyebilir veya aşağıdan ekleyebilirsin."}
            </p>
          )}
        </div>
      )}
      {lastApp?.app && (
        <button
          type="button"
          className="text-button"
          onClick={() =>
            add({
              id: lastApp.appId || lastApp.app,
              name: lastApp.app,
              aliases: [],
            })
          }
        >
          Son kullanılanı ekle: {lastApp.app}
        </button>
      )}
      <details className="application-manual">
        <summary>Listede olmayan bir uygulama ekle</summary>
        <div className="application-manual-row">
          <input
            aria-label="Uygulama adı veya kimliği"
            placeholder="Uygulama adı veya kimliği"
            maxLength={300}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add({
                  id: manual.trim(),
                  name: manual.trim().slice(0, 120),
                  aliases: [],
                });
              }
            }}
          />
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              add({
                id: manual.trim(),
                name: manual.trim().slice(0, 120),
                aliases: [],
              })
            }
          >
            Ekle
          </button>
        </div>
      </details>
      {manualError && (
        <p className="form-error" role="alert">
          {manualError}
        </p>
      )}
    </section>
  );
}
