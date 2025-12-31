// src/config.ts
const isDev = !!import.meta.env.DEV;

// All API calls go through the dev origin so proxy applies (no CORS)
export const ORTHANC_BASE = "/orthanc";

// Navigation to OHIF uses nginx directly; navigation isn’t subject to CORS
export const OHIF_ROOT    = isDev ? "http://localhost/ohif" : "/ohif";

export const API = {
  find: `${ORTHANC_BASE}/tools/find`,
  series: (id: string) => `${ORTHANC_BASE}/series/${id}`,
  label: (id: string, label: string) =>
    `${ORTHANC_BASE}/series/${id}/labels/${encodeURIComponent(label)}`,
};
