"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Panel } from "@/components/shared";
import { api } from "@/lib/api";

export type Preferences = {
  theme: "system" | "light" | "dark";
  fontSize: number;
  lineSpacing: number;
  palettePosition: "left" | "right";
};

export function WorkspacePreferences() {
  const [settings, setSettings] = useState<Preferences>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<Preferences>("/me/preferences", { signal: controller.signal })
      .then(({ data }) => setSettings(data))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your preferences.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  async function save(value: Preferences | Record<string, never>) {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api<Preferences>("/me/preferences", {
        method: "PUT",
        body: JSON.stringify(value),
      });
      setSettings(data);
      setNotice("Workspace preferences saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save your preferences.",
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (settings) void save(settings);
  }

  return (
    <Panel title="Exam workspace preferences">
      {loading && <p role="status">Loading preferences…</p>}
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!loading && !settings && (
        <Button
          secondary
          onClick={() => {
            setLoading(true);
            setError("");
            setRetry((value) => value + 1);
          }}
        >
          Retry
        </Button>
      )}
      {settings && (
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Theme">
              <select
                value={settings.theme}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    theme: event.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="system">Use system setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>
            <Field label="Font size in pixels">
              <input
                type="number"
                min={12}
                max={32}
                value={Number.isNaN(settings.fontSize) ? "" : settings.fontSize}
                required
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    fontSize: event.target.valueAsNumber,
                  })
                }
              />
            </Field>
            <Field label="Line spacing">
              <select
                value={settings.lineSpacing}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    lineSpacing: Number(event.target.value),
                  })
                }
              >
                {[1, 1.25, 1.5, 1.75, 2].map((spacing) => (
                  <option key={spacing}>{spacing}</option>
                ))}
              </select>
            </Field>
            <Field label="Question palette position">
              <select
                value={settings.palettePosition}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    palettePosition: event.target
                      .value as Preferences["palettePosition"],
                  })
                }
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </Field>
          </div>
          <div className="actions">
            <Button type="submit" disabled={saving}>
              Save preferences
            </Button>
            <Button
              type="button"
              secondary
              disabled={saving}
              onClick={() => void save({})}
            >
              Reset to defaults
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
