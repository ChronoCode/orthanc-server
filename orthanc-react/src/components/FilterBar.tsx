
import React from "react";

export type KVScope = "dicom" | "custom";
export type KVMode = "contains" | "equals" | "startsWith" | "endsWith" | "dateRange";

export interface KVPair {
  key: string;      // must be one of existing keys
  value?: string;   // string modes
  scope: KVScope;
  mode: KVMode;
  from?: string;    // YYYYMMDD for dateRange
  to?: string;      // YYYYMMDD for dateRange
}

export interface AdvancedFilterState {
  kvPairs: KVPair[];
}

interface FilterBarProps {
  query: string;
  onQueryChange: (v: string) => void;
  advanced: AdvancedFilterState;
  onAdvancedChange: (v: AdvancedFilterState) => void;
  dicomKeys?: string[];
  customKeys?: string[];
}

export function FilterBar({
  query,
  onQueryChange,
  advanced,
  onAdvancedChange,
  dicomKeys = [],
  customKeys = [],
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(true);

  const update = (patch: Partial<AdvancedFilterState>) =>
    onAdvancedChange({ ...advanced, ...patch });

  const addKv = () => {
    update({
      kvPairs: [
        ...advanced.kvPairs,
        { key: "", value: "", scope: "dicom", mode: "contains" },
      ],
    });
  };

  const removeKv = (idx: number) => {
    const next = [...advanced.kvPairs];
    next.splice(idx, 1);
    update({ kvPairs: next });
  };

  const updateKv = (idx: number, patch: Partial<KVPair>) => {
    const next = [...advanced.kvPairs];
    next[idx] = { ...next[idx], ...patch };
    update({ kvPairs: next });
  };

  return (
    <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e5e7eb", background: "#ffffff" }}>
      {/* Global filter */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="global-query" style={{ fontWeight: 600 }}>
          Filter:
        </label>
        <input
          id="global-query"
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search across all tags…"
          style={{
            padding: "0.4rem 0.6rem",
            borderRadius: "0.5rem",
            border: "1px solid #e5e7eb",
            minWidth: "280px",
            flex: "1 1 420px",
          }}
        />
        <button
          className="button"
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "Hide Tag Filters" : "Show Tag Filters"}
        </button>
      </div>

      {showAdvanced && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>Tag Filters</span>
            <button className="button" type="button" onClick={addKv}>Add Tag Filter</button>
          </div>

          {advanced.kvPairs.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No tag filters.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "0.5rem" }}>
              {advanced.kvPairs.map((kv, idx) => {
                const keysSource = kv.scope === "custom" ? customKeys : dicomKeys;
                const isDate = kv.mode === "dateRange";
                return (
                  <React.Fragment key={`kv-${idx}`}>
                    {/* Scope */}
                    <select
                      value={kv.scope}
                      onChange={(e) => updateKv(idx, { scope: e.target.value as KVScope })}
                      style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                    >
                      <option value="dicom">DICOM</option>
                      <option value="custom">Custom</option>
                    </select>

                    {/* Mode */}
                    <select
                      value={kv.mode}
                      onChange={(e) => updateKv(idx, { mode: e.target.value as KVMode })}
                      style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                    >
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="startsWith">starts with</option>
                      <option value="endsWith">ends with</option>
                      <option value="dateRange">date range (YYYYMMDD)</option>
                    </select>

                    {/* Key (from existing keys only) */}
                    <select
                      value={kv.key}
                      onChange={(e) => updateKv(idx, { key: e.target.value })}
                      style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                    >
                      <option value="">(select key)</option>
                      {keysSource.map((k) => (
                        <option key={`${kv.scope}-${k}`} value={k}>{k}</option>
                      ))}
                    </select>

                    {/* Value or Date range */}
                    {isDate ? (
                      <>
                        <input
                          type="text"
                          placeholder="from YYYYMMDD"
                          value={kv.from ?? ""}
                          onChange={(e) => updateKv(idx, { from: e.target.value })}
                          style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                        />
                        <input
                          type="text"
                          placeholder="to YYYYMMDD"
                          value={kv.to ?? ""}
                          onChange={(e) => updateKv(idx, { to: e.target.value })}
                          style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                        />
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="value…"
                          value={kv.value ?? ""}
                          onChange={(e) => updateKv(idx, { value: e.target.value })}
                          style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                        />
                      </>
                    )}

                    {/* Remove */}
                    <button className="button danger" type="button" onClick={() => removeKv(idx)}>
                      Remove
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
