
// src/components/EditCustomTagsModal.tsx
import React from "react";
import {
  getSeriesCustomTags,
  putSeriesCustomTags,
  deleteSeriesCustomTag,
  type SeriesRowData,
} from "../api/orthanc";

interface EditCustomTagsModalProps {
  series: SeriesRowData | null;
  onClose: () => void;
  onSaved: () => void; // refresh table after successful save
}

type KV = { key: string; value: string };

export function EditCustomTagsModal({ series, onClose, onSaved }: EditCustomTagsModalProps) {
  const [items, setItems] = React.useState<KV[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let canceled = false;
    (async () => {
      if (!series) return;
      setLoading(true);
      setError(null);
      try {
        const tags = await getSeriesCustomTags(series.id);
        const kvs = Object.entries(tags).map(([k, v]) => ({ key: k, value: String(v ?? "") }));
        if (!canceled) setItems(kvs);
      } catch (e: any) {
        if (!canceled) setError(String(e?.message || e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [series]);

  const addRow = () => setItems((prev) => [...prev, { key: "", value: "" }]);

  const updateRow = (idx: number, patch: Partial<KV>) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setItems((prev) => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  const saveAll = async () => {
    if (!series) return;
    setSaving(true);
    setError(null);
    try {
      const obj: Record<string, string> = {};
      for (const { key, value } of items) {
        const k = key.trim();
        if (!k) continue;
        obj[k] = value ?? "";
      }
      await putSeriesCustomTags(series.id, obj);
      // Re-load editor list from server right away (optional)
      const after = await getSeriesCustomTags(series.id);
      setItems(Object.entries(after).map(([k, v]) => ({ key: k, value: String(v ?? "") })));

      // Tell parent to refresh the table (so filters and customKeys update)
      onSaved();
      onClose();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const deleteKeyOnServer = async (key: string) => {
    if (!series) return;
    try {
      await deleteSeriesCustomTag(series.id, key);
    } catch (e) {
      // swallow; we'll still remove locally
      console.warn("deleteSeriesCustomTag failed:", e);
    }
  };

  const modalStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
  const panelStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: "0.75rem",
    padding: "1rem",
    width: "min(800px, 96vw)",
    maxHeight: "80vh",
    overflow: "auto",
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  };

  if (!series) return null;

  return (
    <div style={modalStyle} onClick={onClose} aria-modal="true" role="dialog">
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Edit Custom Tags</h2>
          <button className="button" onClick={onClose} disabled={saving}>Close</button>
        </div>

        <div style={{ marginTop: "0.5rem", color: "#6b7280" }}>
          Series ID: <code>{series.id}</code>
        </div>

        {loading ? (
          <div style={{ marginTop: "1rem" }}>Loading…</div>
        ) : (
          <>
            <div style={{ marginTop: "0.75rem" }}>
              <button className="button" onClick={addRow} disabled={saving}>Add Tag</button>
            </div>

            <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "2fr 3fr auto", gap: "0.5rem" }}>
              <div style={{ fontWeight: 600 }}>Key</div>
              <div style={{ fontWeight: 600 }}>Value</div>
              <div />
              {items.map((kv, idx) => (
                <React.Fragment key={`kv-${idx}`}>
                  <input
                    type="text"
                    value={kv.key}
                    onChange={(e) => updateRow(idx, { key: e.target.value })}
                    placeholder="e.g., Project, Cohort, Note"
                    style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                  />
                  <input
                    type="text"
                    value={kv.value}
                    onChange={(e) => updateRow(idx, { value: e.target.value })}
                    placeholder="value…"
                    style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="button danger"
                      onClick={async () => {
                        const key = items[idx].key.trim();
                        removeRow(idx);         // Optimistic
                        if (key) await deleteKeyOnServer(key); // Server delete
                      }}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {error && (
              <div style={{ marginTop: "0.75rem", color: "#b91c1c" }}>{error}</div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button className="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="button" onClick={saveAll} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
