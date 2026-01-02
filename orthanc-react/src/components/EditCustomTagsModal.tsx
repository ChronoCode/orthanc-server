
// src/components/EditCustomTagsModal.tsx
import React from "react";
import {
  getSeriesCustomTags,
  putSeriesCustomTags,
  deleteSeriesCustomTag,
  loadSeriesForTable,
  type SeriesRowData,
} from "../api/orthanc";

interface EditCustomTagsModalProps {
  series: SeriesRowData | null;
  onClose: () => void;
  onSaved: () => void; // refresh table after successful save
}

type Catalog = {
  keys: string[];
  valuesByKey: Record<string, string[]>;
};

const NEW_KEY_SENTINEL = "__NEW_KEY__";
const NEW_VALUE_SENTINEL = "__NEW_VALUE_SENTINEL__";

// Chip styles (reuse look from Series page)
const chipWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  background: "#F3F4F6",
  border: "1px solid #E5E7EB",
  borderRadius: "0.75rem",
  padding: "4px 10px",
  maxWidth: "100%",
};
const chipKey: React.CSSProperties = {
  fontWeight: 600,
  color: "#111827",
  whiteSpace: "nowrap",
};
const chipVal: React.CSSProperties = {
  color: "#111827",
  overflowWrap: "anywhere",
};
const chipDangerBtn: React.CSSProperties = {
  marginLeft: "0.35rem",
  background: "#FEE2E2",
  border: "1px solid #FCA5A5",
  color: "#991B1B",
  borderRadius: "0.5rem",
  padding: "2px 6px",
  cursor: "pointer",
};

export function EditCustomTagsModal({
  series,
  onClose,
  onSaved,
}: EditCustomTagsModalProps) {
  const [items, setItems] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Catalog for dropdowns
  const [catalog, setCatalog] = React.useState<Catalog>({ keys: [], valuesByKey: {} });
  const [catalogLoading, setCatalogLoading] = React.useState<boolean>(true);

  // Top edit/add panel state
  const [selectedKey, setSelectedKey] = React.useState<string>("");
  const [customKey, setCustomKey] = React.useState<string>("");
  const [selectedValue, setSelectedValue] = React.useState<string>("");
  const [customValue, setCustomValue] = React.useState<string>("");

  React.useEffect(() => {
    let canceled = false;

    (async () => {
      if (!series) return;
      setLoading(true);
      setError(null);

      try {
        // 1) Load current series' custom tags
        const tags = await getSeriesCustomTags(series.id);
        if (!canceled) setItems(tags ?? {});

        // 2) Build catalog from all series (keys + valuesByKey)
        setCatalogLoading(true);
        try {
          const rows = await loadSeriesForTable();
          const keySet = new Set<string>();
          const valuesByKeySets: Record<string, Set<string>> = {};

          for (const r of rows) {
            const ct = r.customTags ?? {};
            for (const [k, v] of Object.entries(ct)) {
              const key = k.trim();
              const val = String(v ?? "").trim();
              if (!key) continue;

              keySet.add(key);
              if (!valuesByKeySets[key]) valuesByKeySets[key] = new Set<string>();
              if (val) valuesByKeySets[key].add(val);
            }
          }

          const catalogKeys = Array.from(keySet).sort((a, b) => a.localeCompare(b));
          const valuesByKey: Record<string, string[]> = {};
          for (const k of catalogKeys) {
            valuesByKey[k] = Array.from(valuesByKeySets[k] ?? new Set<string>()).sort((a, b) =>
              a.localeCompare(b)
            );
          }

          if (!canceled) setCatalog({ keys: catalogKeys, valuesByKey });
        } catch (e) {
          console.warn("Catalog build failed:", e);
          if (!canceled) setCatalog({ keys: [], valuesByKey: {} });
        } finally {
          if (!canceled) setCatalogLoading(false);
        }

        // 3) Preselect first key (helpful default)
        const seriesKeys = Object.keys(tags ?? {});
        const firstKey = seriesKeys[0] ?? "";
        if (!canceled) {
          if (firstKey) {
            setSelectedKey(firstKey);
            setSelectedValue(tags[firstKey] ?? "");
          } else {
            setSelectedKey("");
            setSelectedValue("");
          }
          setCustomKey("");
          setCustomValue("");
        }
      } catch (e: any) {
        if (!canceled) setError(String(e?.message ?? e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [series]);

  // Build key options: union of catalog + this series (ensures current keys visible even if catalog fails)
  const keyOptions = React.useMemo(() => {
    const opts = new Set<string>(catalog.keys);
    for (const k of Object.keys(items ?? {})) {
      if (k) opts.add(k);
    }
    return Array.from(opts).sort((a, b) => a.localeCompare(b));
  }, [catalog.keys, items]);

  // Build value options for selected key: union of catalog + current series value
  const valueOptions = React.useMemo(() => {
    const k =
      selectedKey && selectedKey !== NEW_KEY_SENTINEL
        ? selectedKey.trim()
        : customKey.trim();
    if (!k) return [];

    const set = new Set<string>(catalog.valuesByKey[k] ?? []);
    // Include the series' current value for that key
    const currentVal = items[k];
    if (currentVal) set.add(String(currentVal));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalog.valuesByKey, items, selectedKey, customKey]);

  // When key changes, prefill selectedValue with the series' current value (if any)
  React.useEffect(() => {
    if (!selectedKey || selectedKey === NEW_KEY_SENTINEL) return;
    const v = items[selectedKey];
    setSelectedValue(typeof v !== "undefined" ? String(v ?? "") : "");
    setCustomValue("");
  }, [selectedKey, items]);

  const applyChange = async () => {
    if (!series) return;
    setSaving(true);
    setError(null);

    try {
      let keyToSave = "";
      let valueToSave = "";

      if (selectedKey && selectedKey !== NEW_KEY_SENTINEL) {
        keyToSave = selectedKey.trim();
      } else if (selectedKey === NEW_KEY_SENTINEL) {
        keyToSave = customKey.trim();
      }

      if (selectedValue && selectedValue !== NEW_VALUE_SENTINEL) {
        valueToSave = selectedValue.trim();
      } else if (selectedValue === NEW_VALUE_SENTINEL) {
        valueToSave = customValue.trim();
      } else {
        // allow empty string values if desired
        valueToSave = customValue.trim() || "";
      }

      if (!keyToSave) {
        setError("Please select a key or enter a new key.");
        setSaving(false);
        return;
      }

      // Merge-safe single-key write
      await putSeriesCustomTags(series.id, { [keyToSave]: valueToSave });

      // Reload series tags
      const after = await getSeriesCustomTags(series.id);
      setItems(after ?? {});

      // Keep dropdowns in sync
      setSelectedKey(keyToSave);
      setSelectedValue(valueToSave);
      setCustomKey("");
      setCustomValue("");

      // Update catalog in memory so next open reflects the new value
      setCatalog((prev) => {
        const keys = prev.keys.includes(keyToSave)
          ? prev.keys
          : [...prev.keys, keyToSave].sort((a, b) => a.localeCompare(b));
        const valuesByKey = { ...prev.valuesByKey };
        const vals = new Set<string>(valuesByKey[keyToSave] ?? []);
        if (valueToSave) vals.add(valueToSave);
        valuesByKey[keyToSave] = Array.from(vals).sort((a, b) => a.localeCompare(b));
        return { keys, valuesByKey };
      });

      onSaved();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async (key: string) => {
    if (!series || !key) return;
    try {
      await deleteSeriesCustomTag(series.id, key);
      const after = await getSeriesCustomTags(series.id);
      setItems(after ?? {});
      // If we deleted the selected key, clear the value selection
      if (selectedKey === key) {
        setSelectedValue("");
      }
      onSaved();
    } catch (e) {
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
    width: "min(900px, 96vw)",
    maxHeight: "80vh",
    overflow: "auto",
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  };

  if (!series) return null;

  const disabledSelectors = catalogLoading && keyOptions.length === 0;

  return (
    <div style={modalStyle} onClick={onClose} aria-modal="true" role="dialog">
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Edit Custom Tags</h2>
          <button className="button" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
        <div style={{ marginTop: "0.5rem", color: "#6b7280" }}>
          Series ID: <code>{series.id}</code>
        </div>

        {/* Top edit/add panel */}
        <div
          style={{
            marginTop: "0.75rem",
            borderTop: "1px solid #E5E7EB",
            paddingTop: "0.75rem",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Edit or Add Tag</h3>

          {/* Row 1: KEY & VALUE DROPDOWNS (no buttons here) */}
          <div
            style={{
              marginTop: "0.5rem",
              display: "grid",
              gridTemplateColumns: "2fr 3fr",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <select
              value={selectedKey}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedKey(v);
                if (v === NEW_KEY_SENTINEL) {
                  setCustomKey("");
                  setSelectedValue(""); // reset value selection
                }
              }}
              disabled={disabledSelectors}
              style={{
                padding: "0.48rem 0.6rem",
                borderRadius: "0.5rem",
                border: "1px solid #e5e7eb",
              }}
            >
              <option value="">{catalogLoading ? "Loading keys…" : "(select key)"}</option>
              {keyOptions.map((k) => (
                <option key={`k-${k}`} value={k}>
                  {k}
                </option>
              ))}
              <option value={NEW_KEY_SENTINEL}>➕ Add new key…</option>
            </select>

            <select
              value={selectedValue}
              onChange={(e) => setSelectedValue(e.target.value)}
              disabled={disabledSelectors && (selectedKey !== NEW_KEY_SENTINEL && valueOptions.length === 0)}
              style={{
                padding: "0.48rem 0.6rem",
                borderRadius: "0.5rem",
                border: "1px solid #e5e7eb",
              }}
            >
              <option value="">{catalogLoading ? "Loading values…" : "(select value)"}</option>
              {valueOptions.map((v) => (
                <option key={`v-${v}`} value={v}>
                  {v}
                </option>
              ))}
              <option value={NEW_VALUE_SENTINEL}>➕ Add new value…</option>
            </select>
          </div>

          {/* Row 2: CONDITIONAL INPUTS (aligned to same columns) */}
          {(selectedKey === NEW_KEY_SENTINEL || selectedValue === NEW_VALUE_SENTINEL) && (
            <div
              style={{
                marginTop: "0.4rem",
                display: "grid",
                gridTemplateColumns: "2fr 3fr",
                gap: "0.5rem",
                alignItems: "center",
              }}
            >
              {/* New key input (only when "Add new key…" selected) */}
              {selectedKey === NEW_KEY_SENTINEL ? (
                <input
                  type="text"
                  placeholder="New key (e.g., Project)"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  style={{
                    padding: "0.48rem 0.6rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #e5e7eb",
                    minWidth: 0,
                  }}
                />
              ) : (
                <div />
              )}

              {/* New value input (only when "Add new value…" selected) */}
              {selectedValue === NEW_VALUE_SENTINEL ? (
                <input
                  type="text"
                  placeholder="New value (e.g., Fenix)"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  style={{
                    padding: "0.48rem 0.6rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #e5e7eb",
                    minWidth: 0,
                  }}
                />
              ) : (
                <div />
              )}
            </div>
          )}

          {/* Row 3: ACTIONS (left-aligned; separate row for perfect alignment) */}
          <div
            style={{
              marginTop: "0.6rem",
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <button className="button" onClick={applyChange} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="button"
              onClick={() => {
                setSelectedKey("");
                setCustomKey("");
                setSelectedValue("");
                setCustomValue("");
              }}
              disabled={saving}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Chips list of existing tags (read-only display with optional delete) */}
        <div style={{ marginTop: "1rem", borderTop: "1px solid #E5E7EB", paddingTop: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Current Custom Tags</h3>

          {loading ? (
            <div style={{ marginTop: "0.5rem" }}>Loading…</div>
          ) : Object.keys(items).length === 0 ? (
            <div style={{ marginTop: "0.5rem", color: "#6b7280" }}>No custom tags on this series.</div>
          ) : (
            <div style={{ marginTop: "0.5rem", ...chipWrap }}>
              {Object.entries(items).map(([k, v]) => (
                <div key={`chip-${series!.id}-${k}`} style={chip} title={`${k}: ${String(v ?? "")}`}>
                  <span style={chipKey}>{k}:</span>
                  <span style={chipVal}>{String(v ?? "")}</span>
                  {/* Optional: delete */}
                  <button
                    type="button"
                    style={chipDangerBtn}
                    onClick={() => handleDeleteTag(k)}
                    title="Delete this tag"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: "0.75rem", color: "#b91c1c" }}>
            {error}
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
          <button className="button" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
