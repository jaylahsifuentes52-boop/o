const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const resultsEl = document.getElementById("results");
const fileMeta = document.getElementById("fileMeta");
const progressFill = document.getElementById("progressFill");

let selectedFile = null;
let outputBlob = null;
let outputName = "data_noantis.unity3d";

function log(msg, kind = "") {
  const line = document.createElement("div");
  line.className = "log-line" + (kind ? " " + kind : "");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setProgress(pct) {
  progressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

function onFile(file) {
  selectedFile = file;
  outputBlob = null;
  downloadBtn.disabled = true;
  processBtn.disabled = false;
  resultsEl.innerHTML = "";
  logEl.innerHTML = "";
  fileMeta.textContent = file.name + "  ·  " + formatBytes(file.size);
  setStatus("Ready. Tap Remove Anticheats.");
  setProgress(0);
  log("Loaded " + file.name + " (" + formatBytes(file.size) + ")");
}

browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) onFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("hot");
  });
});
["dragleave", "drop"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("hot");
  });
});
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) onFile(f);
});
dropzone.addEventListener("click", (e) => {
  if (e.target === browseBtn) return;
  fileInput.click();
});

function findAll(haystack, needleBytes) {
  const hits = [];
  const n = needleBytes.length;
  if (n === 0 || n > haystack.length) return hits;
  let i = 0;
  const limit = haystack.length - n;
  while (i <= limit) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needleBytes[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      hits.push(i);
      i += n;
    } else {
      i++;
    }
  }
  return hits;
}

function sameLengthFill(len) {
  // Keep length identical so Unity serialized offsets stay valid.
  const fill = new Uint8Array(len);
  const ch = "_".charCodeAt(0);
  for (let i = 0; i < len; i++) fill[i] = ch;
  return fill;
}

async function processFile() {
  if (!selectedFile) return;
  processBtn.disabled = true;
  downloadBtn.disabled = true;
  resultsEl.innerHTML = "";
  setStatus("Reading file…");
  setProgress(5);
  log("Reading into memory…");

  const buf = await selectedFile.arrayBuffer();
  const bytes = new Uint8Array(buf);
  setProgress(15);
  log("Scanning all " + UNIQUE_SIGNATURES.length + " names from your list…");

  const found = [];
  let totalHits = 0;
  const encoder = new TextEncoder();

  for (let s = 0; s < UNIQUE_SIGNATURES.length; s++) {
    const name = UNIQUE_SIGNATURES[s];
    const needle = encoder.encode(name);
    const hits = findAll(bytes, needle);
    if (hits.length) {
      const fill = sameLengthFill(needle.length);
      for (const pos of hits) {
        bytes.set(fill, pos);
      }
      found.push({ name, count: hits.length, first: hits[0] });
      totalHits += hits.length;
      log("Removed \"" + name + "\"  ×" + hits.length, "hit");
    }
    if (s % 8 === 0) {
      setProgress(15 + (s / UNIQUE_SIGNATURES.length) * 70);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  setProgress(90);
  if (!found.length) {
    setStatus("No listed anticheat strings found.");
    log("Nothing matched. File unchanged.", "warn");
    processBtn.disabled = false;
    setProgress(100);
    return;
  }

  outputName = "data_noantis.unity3d";
  outputBlob = new Blob([bytes], { type: "application/octet-stream" });
  downloadBtn.disabled = false;
  processBtn.disabled = false;
  setProgress(100);
  setStatus("Done. " + found.length + " names, " + totalHits + " hits stripped.");
  log("Wrote " + outputName + " (" + formatBytes(outputBlob.size) + ")", "ok");

  found.sort((a, b) => b.count - a.count);
  resultsEl.innerHTML = found
    .map(
      (f) =>
        `<div class="res-row"><span class="res-name">${escapeHtml(
          f.name
        )}</span><span class="res-count">×${f.count}</span></div>`
    )
    .join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

processBtn.addEventListener("click", () => {
  processFile().catch((err) => {
    setStatus("Error");
    log(String(err), "warn");
    processBtn.disabled = false;
  });
});

function bytesToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

downloadBtn.addEventListener("click", async () => {
  if (!outputBlob) return;
  const zipName = "data_noantis.zip";
  const innerName = "data_noantis.unity3d";

  // Android: chunked transfer + native zip to Downloads
  if (window.Android && typeof Android.beginSave === "function") {
    try {
      setStatus("Saving zip to Downloads…");
      const buf = await outputBlob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      Android.beginSave();
      const piece = 256 * 1024;
      for (let i = 0; i < bytes.length; i += piece) {
        const slice = bytes.subarray(i, Math.min(i + piece, bytes.length));
        Android.appendChunk(bytesToB64(slice));
        setProgress(Math.min(99, Math.round((i / bytes.length) * 100)));
        await new Promise((r) => setTimeout(r, 0));
      }
      Android.finishSaveZip(innerName, zipName);
      log("Saved " + zipName + " (contains " + innerName + ")", "ok");
      setStatus("Saved to Downloads/" + zipName);
      setProgress(100);
      return;
    } catch (e) {
      log("Native save failed: " + e, "warn");
    }
  }

  // Browser fallback
  const a = document.createElement("a");
  a.href = URL.createObjectURL(outputBlob);
  a.download = innerName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  log("Download started: " + innerName, "ok");
});
