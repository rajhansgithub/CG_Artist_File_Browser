// Lazy pdf.js loader: the PDF engine (and its worker) is only fetched the first time a PDF is opened or
// thumbnailed, so startup and the main bundle stay lean.
let pdfjsPromise = null;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/build/pdf.mjs'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

// Read the raw file bytes (binary IPC, no JSON) and open the document with pdf.js.
export async function openPdfDocument(filePath) {
  const pdfjs = await loadPdfjs();
  let data;
  if (window.electronAPI?.readFileBuffer) {
    const buf = await window.electronAPI.readFileBuffer(filePath);
    data = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf?.buffer || buf);
  } else {
    const url = window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(filePath) : filePath;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${filePath}`);
    data = new Uint8Array(await response.arrayBuffer());
  }
  return pdfjs.getDocument({ data }).promise;
}
