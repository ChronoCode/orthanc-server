
// src/components/UploadDicomButton.tsx
import React from "react";
import { ORTHANC_BASE } from "../config";

/**
 * Upload to Orthanc:
 * - Single ZIP: POST /instances with Content-Type: application/zip (bulk import)
 * - Any other file: POST /instances with Content-Type: application/dicom (one-by-one)
 *
 * NOTE:
 * - Filenames/extensions don't matter to Orthanc; payload must be a valid DICOM dataset or a ZIP of DICOMs.
 * - Directory selection uses `webkitdirectory` (Chromium/Edge/Safari). Firefox support is limited; see fallback notes.
 */
interface Props {
  onUploaded: () => void; // refresh table after success
}

export function UploadDicomButton({ onUploaded }: Props) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const dirInputRef = React.useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = React.useState<string>("");

  const openFilePicker = () => fileInputRef.current?.click();
  const openDirPicker  = () => dirInputRef.current?.click();

  const isZip = (f: File) =>
    f.type === "application/zip" || f.name.toLowerCase().endsWith(".zip");

  const uploadZip = async (zip: File) => {
    setStatus(`Uploading ZIP: ${zip.name}…`);
    const res = await fetch(`${ORTHANC_BASE.replace(/\/+$/, "")}/instances`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zip,
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Upload ZIP failed: ${res.status} ${msg}`);
    }
  };

  const uploadDicom = async (f: File) => {
    const name = f.name || "file";
    setStatus(`Uploading ${name}…`);
    // application/dicom is preferred; application/octet-stream also works for DICOM payloads
    const res = await fetch(`${ORTHANC_BASE.replace(/\/+$/, "")}/instances`, {
      method: "POST",
      headers: { "Content-Type": "application/dicom" },
      body: f,
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Upload DICOM failed (${name}): ${res.status} ${msg}`);
    }
  };

  const uploadList = async (files: FileList | File[]) => {
    setStatus("");
    const arr = Array.from(files);
    if (arr.length === 0) return;

    try {
      // If exactly one ZIP, upload it once (bulk import)
      if (arr.length === 1 && isZip(arr[0])) {
        await uploadZip(arr[0]);
        setStatus(`Uploaded ZIP: ${arr[0].name}`);
      } else {
        // Mixed batch: upload each file individually or ZIPs one-by-one
        let okCount = 0;
        for (const f of arr) {
          if (isZip(f)) {
            await uploadZip(f);
            okCount++;
          } else {
            await uploadDicom(f);
            okCount++;
          }
        }
        setStatus(`Uploaded ${okCount}/${arr.length} item(s).`);
      }

      // Refresh table (series list & filter keys)
      onUploaded();
      setTimeout(() => setStatus(""), 2000);
    } catch (e: any) {
      console.error(e);
      setStatus(String(e?.message || e));
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      {/* Regular file selection (any file or ZIP) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"     // allow any; we detect ZIP by type/name
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && uploadList(e.target.files)}
      />

      {/* Directory selection: webkitdirectory (Chromium/Edge/Safari) */}
      <input
        ref={dirInputRef}
        type="file"
        accept="*/*"
        // @ts-expect-error: non-standard attribute used by Chromium/Safari
        webkitdirectory="true"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && uploadList(e.target.files)}
      />

      <button className="button" onClick={openFilePicker}>
        Upload DICOM (Files)
      </button>
      <button className="button" onClick={openDirPicker}>
        Upload DICOM (Folder)
      </button>

      {status && <span style={{ color: "#374151" }}>{status}</span>}
    </div>
  );
}
