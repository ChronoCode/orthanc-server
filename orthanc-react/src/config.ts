// // src/config.ts - Comment reverse for Local Vite run
// const isDev = !!import.meta.env.DEV;

// // All API calls go through the dev origin so proxy applies (no CORS)
// export const ORTHANC_BASE = "/orthanc";

// // Navigation to OHIF uses nginx directly; navigation isn’t subject to CORS
// export const OHIF_ROOT    = isDev ? "http://localhost/ohif" : "/ohif";

// Reads values injected at runtime by /app/config.js 
const cfg = (window as any).__APP_CONFIG || {};
export const ORTHANC_BASE = (cfg.ORTHANC_BASE ?? "/orthanc").replace(/\/+$/, "");
export const OHIF_ROOT    = (cfg.OHIF_ROOT    ?? "/ohif").replace(/\/+$/, "");

export const API = {
  find: `${ORTHANC_BASE}/tools/find`,
  series: (id: string) => `${ORTHANC_BASE}/series/${id}`,
  label: (id: string, label: string) =>
    `${ORTHANC_BASE}/series/${id}/labels/${encodeURIComponent(label)}`,
};
