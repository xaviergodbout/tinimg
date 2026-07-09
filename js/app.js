const els = {
      fileInput: document.getElementById("fileInput"),
      dropzone: document.getElementById("dropzone"),
      inputPanel: document.getElementById("inputPanel"),
      outputPanel: document.getElementById("outputPanel"),
      inputRows: document.getElementById("inputRows"),
      outputRows: document.getElementById("outputRows"),
      outputEmpty: document.getElementById("outputEmpty"),
      compressBtn: document.getElementById("compressBtn"),
      downloadAllBtn: document.getElementById("downloadAllBtn"),
      downloadSelectedBtn: document.getElementById("downloadSelectedBtn"),
      downloadDialog: document.getElementById("downloadDialog"),
      downloadDialogClose: document.getElementById("downloadDialogClose"),
      downloadDialogMeta: document.getElementById("downloadDialogMeta"),
      downloadOptions: document.getElementById("downloadOptions"),
      downloadSelectedLabel: document.getElementById("downloadSelectedLabel"),
      inputClearBtn: document.getElementById("inputClearBtn"),
      outputClearBtn: document.getElementById("outputClearBtn"),
      targetSize: document.getElementById("targetSize"),
      targetUnit: document.getElementById("targetUnit"),
      formatGrid: document.getElementById("formatGrid"),
      supportNote: document.getElementById("supportNote")
    };

    const extensionByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };

    const items = [];
    const selectedOutputIds = new Set();
    const downloadPresets = [
      { id: "original", label: "Original size", maxEdge: null, suffix: "" },
      { id: "4k", label: "4K", maxEdge: 3840, suffix: "4k" },
      { id: "2k", label: "2K", maxEdge: 2048, suffix: "2k" },
      { id: "1080p", label: "1080p", maxEdge: 1920, suffix: "1080p" }
    ];
    const encoderSupport = new Map();
    let idCounter = 0;
    let isWorking = false;
    let supportReady = false;
    let goalTouched = false;
    let lastTargetUnit = "1024";
    let downloadRequest = [];

    function iconDownload() {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function iconArrowRight() {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function formatBytes(bytes) {
      if (!bytes) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }
      const places = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
      return `${value.toFixed(places)} ${units[unitIndex]}`;
    }

    function getTargetBytes(item) {
      if (els.targetUnit.value === "percent") {
        const percent = Math.min(100, Math.max(1, Number(els.targetSize.value || 50)));
        return Math.max(1, Math.round(item.file.size * (percent / 100)));
      }
      const size = Math.max(0.1, Number(els.targetSize.value || 1));
      return Math.max(1, Math.round(size * Number(els.targetUnit.value)));
    }

    function getSelectedMime() {
      return document.querySelector('input[name="format"]:checked')?.value || "image/jpeg";
    }

    function stripExtension(name) {
      return name.replace(/\.[^.]+$/, "") || "image";
    }

    function getInputLabel(file) {
      const byType = file.type ? file.type.split("/").pop() : "";
      const byName = (file.name.match(/\.([^.]+)$/) || [])[1] || "";
      return (byType || byName || "image").toUpperCase().replace("JPEG", "JPG");
    }

    function outputNameFor(item, mime) {
      return `${stripExtension(item.file.name)}.${extensionByMime[mime] || "img"}`;
    }

    function isImageLike(file) {
      return file.type.startsWith("image/") || /\.(webp|jpe?g|png|gif|bmp|tiff?|heic|heif)$/i.test(file.name);
    }

    function cleanNumber(value) {
      return Number(value.toFixed(value >= 10 ? 1 : 2)).toString();
    }

    function applyTargetUnitConstraints(unit) {
      if (unit === "percent") {
        els.targetSize.step = "1";
        els.targetSize.min = "1";
        els.targetSize.max = "100";
        return;
      }

      els.targetSize.removeAttribute("max");
      if (unit === "1048576") {
        els.targetSize.step = "0.01";
        els.targetSize.min = "0.01";
      } else {
        els.targetSize.step = "1";
        els.targetSize.min = "1";
      }
    }

    function setSizeGoalFromBytes(bytes) {
      const safeBytes = Math.max(1, Math.round(bytes));
      if (safeBytes >= 1048576) {
        els.targetUnit.value = "1048576";
        applyTargetUnitConstraints("1048576");
        els.targetSize.value = cleanNumber(safeBytes / 1048576);
      } else {
        els.targetUnit.value = "1024";
        applyTargetUnitConstraints("1024");
        els.targetSize.value = Math.max(1, Math.round(safeBytes / 1024)).toString();
      }
    }

    function setAutomaticGoalFromInput() {
      if (goalTouched) return;
      const inputItems = items.filter(isInputItem);
      if (inputItems.length === 0) return;
      const averageBytes = inputItems.reduce((sum, item) => sum + item.file.size, 0) / inputItems.length;
      setSizeGoalFromBytes(averageBytes * 0.5);
      lastTargetUnit = els.targetUnit.value;
    }

    function averageInputBytes() {
      const inputItems = items.filter(isInputItem);
      if (inputItems.length === 0) return 0;
      return inputItems.reduce((sum, item) => sum + item.file.size, 0) / inputItems.length;
    }

    function currentTargetBytesFromPreviousUnit(previousUnit) {
      const value = Math.max(0.1, Number(els.targetSize.value || 1));
      if (previousUnit === "percent") {
        const average = averageInputBytes();
        return average ? average * Math.min(100, Math.max(1, value)) / 100 : 0;
      }
      return value * Number(previousUnit || 1024);
    }

    function updateTargetForUnitChange(previousUnit, nextUnit) {
      if (nextUnit === previousUnit) return;
      const currentBytes = currentTargetBytesFromPreviousUnit(previousUnit);

      if (nextUnit === "percent") {
        const average = averageInputBytes();
        const percent = average ? Math.max(1, Math.min(100, Math.round((currentBytes / average) * 100))) : 50;
        applyTargetUnitConstraints(nextUnit);
        els.targetSize.value = percent.toString();
      } else {
        applyTargetUnitConstraints(nextUnit);
        const bytes = currentBytes || averageInputBytes() * 0.5 || Number(nextUnit);
        els.targetSize.value = nextUnit === "1048576"
          ? cleanNumber(bytes / 1048576)
          : Math.max(1, Math.round(bytes / 1024)).toString();
      }

      lastTargetUnit = nextUnit;
      render();
    }

    function isOutputItem(item) {
      return Boolean(item.outputBlob && !item.isMoving && (item.status === "Done" || item.status === "Closest"));
    }

    function isInputItem(item) {
      return !isOutputItem(item);
    }

    function canCompressInput(item) {
      return isInputItem(item) && (item.status === "Ready" || item.status === "Error");
    }

    function compressionConcurrency(queue) {
      if (queue.length <= 1) return 1;
      const cores = Math.max(1, Number(navigator.hardwareConcurrency) || 4);
      const memory = Number(navigator.deviceMemory) || 4;
      const largestFile = Math.max(...queue.map((item) => item.file.size));
      const coreLimit = cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
      const memoryLimit = memory >= 6 && largestFile < 30 * 1024 * 1024 ? coreLimit : Math.min(coreLimit, 2);
      return Math.max(1, Math.min(queue.length, memoryLimit));
    }

    function uniqueZipName(name, used) {
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
      const base = stripExtension(name);
      const ext = (name.match(/\.([^.]+)$/) || [])[1];
      let n = 2;
      let candidate = `${base}-${n}${ext ? `.${ext}` : ""}`;
      while (used.has(candidate)) {
        n += 1;
        candidate = `${base}-${n}${ext ? `.${ext}` : ""}`;
      }
      used.add(candidate);
      return candidate;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function canEncode(mime) {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#315dff";
      ctx.fillRect(0, 0, 2, 2);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const timer = setTimeout(() => finish(false), 1200);
        canvas.toBlob((blob) => {
          clearTimeout(timer);
          finish(Boolean(blob && blob.type === mime));
        }, mime, 0.82);
      });
    }

    async function setupEncoderSupport() {
      const choices = [...document.querySelectorAll('input[name="format"]')];
      for (const choice of choices) {
        const supported = await canEncode(choice.value);
        encoderSupport.set(choice.value, supported);
        choice.disabled = !supported;
      }

      const selected = getSelectedMime();
      if (!encoderSupport.get(selected)) {
        const fallback = choices.find((choice) => !choice.disabled);
        if (fallback) fallback.checked = true;
      }

      const unsupported = choices
        .filter((choice) => choice.disabled)
        .map((choice) => choice.nextElementSibling.textContent)
        .join(", ");

      els.supportNote.textContent = unsupported
        ? `Output not available here: ${unsupported}.`
        : "";
      supportReady = true;
      render();
    }

    async function decodeBitmap(file) {
      if ("createImageBitmap" in window) {
        try {
          return await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch (error) {
          // Fall through to HTMLImageElement decoding.
        }
      }

      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return "createImageBitmap" in window ? await createImageBitmap(canvas) : canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function probeDimensions(item) {
      try {
        const bitmap = await decodeBitmap(item.file);
        item.width = bitmap.width;
        item.height = bitmap.height;
        bitmap.close?.();
        item.status = "Ready";
      } catch (error) {
        item.status = "Unsupported";
        item.error = "This browser cannot read that image.";
      }
      render();
    }

    function renderToBlob(bitmap, mime, quality, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const ctx = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error("This browser could not save that format."));
          else resolve(blob);
        }, mime, quality);
      });
    }

    function resultFromBlob(blob, width, height, quality, targetBytes) {
      return {
        blob,
        width,
        height,
        quality,
        meetsTarget: blob.size <= targetBytes
      };
    }

    async function encodePng(bitmap, targetBytes) {
      const full = await renderToBlob(bitmap, "image/png", 1, bitmap.width, bitmap.height);
      if (full.size <= targetBytes) {
        return resultFromBlob(full, bitmap.width, bitmap.height, 1, targetBytes);
      }

      let low = 0.04;
      let high = 1;
      let bestUnder = null;
      let smallest = resultFromBlob(full, bitmap.width, bitmap.height, 1, targetBytes);

      for (let i = 0; i < 12; i += 1) {
        const scale = (low + high) / 2;
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const blob = await renderToBlob(bitmap, "image/png", 1, width, height);
        const result = resultFromBlob(blob, width, height, 1, targetBytes);
        if (blob.size <= targetBytes) {
          bestUnder = result;
          low = scale;
        } else {
          high = scale;
          if (blob.size < smallest.blob.size) smallest = result;
        }
      }

      return bestUnder || smallest;
    }

    async function encodeLossy(bitmap, mime, targetBytes) {
      const minQuality = 0.12;
      const maxQuality = 0.94;
      let scale = 1;
      let smallest = null;

      for (let round = 0; round < 8; round += 1) {
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        let low = minQuality;
        let high = maxQuality;
        let bestUnder = null;
        let closestOver = null;

        for (let i = 0; i < 9; i += 1) {
          const quality = (low + high) / 2;
          const blob = await renderToBlob(bitmap, mime, quality, width, height);
          const result = resultFromBlob(blob, width, height, quality, targetBytes);

          if (!smallest || blob.size < smallest.blob.size) smallest = result;

          if (blob.size <= targetBytes) {
            bestUnder = result;
            low = quality;
          } else {
            closestOver = result;
            high = quality;
          }
        }

        if (bestUnder) return bestUnder;

        const referenceSize = closestOver?.blob.size || smallest?.blob.size || targetBytes * 2;
        const nextScale = scale * Math.max(0.28, Math.min(0.82, Math.sqrt(targetBytes / referenceSize) * 0.92));
        scale = Math.max(0.025, Math.min(scale * 0.82, nextScale));

        if (width <= 24 || height <= 24) break;
      }

      return smallest;
    }

    function nextFrame() {
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    async function animateMoveToOutput(itemId) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      await nextFrame();
      const source = els.inputRows.querySelector(`[data-id="${itemId}"]`);
      if (!source) return;

      const sourceRect = source.getBoundingClientRect();
      const outputRect = els.outputPanel.getBoundingClientRect();
      const rowsRect = els.outputRows.getBoundingClientRect();
      const targetX = outputRect.left + 18;
      const targetY = Math.max(outputRect.top + 78, rowsRect.top + Math.min(els.outputRows.children.length, 5) * 78);
      const targetWidth = Math.min(sourceRect.width, Math.max(260, outputRect.width - 36));

      const clone = source.cloneNode(true);
      clone.classList.add("flight-card");
      clone.style.left = `${sourceRect.left}px`;
      clone.style.top = `${sourceRect.top}px`;
      clone.style.width = `${sourceRect.width}px`;
      clone.style.height = `${sourceRect.height}px`;
      clone.style.margin = "0";
      document.body.appendChild(clone);
      source.classList.add("is-moving-source");

      try {
        await clone.animate([
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          {
            transform: `translate(${targetX - sourceRect.left}px, ${targetY - sourceRect.top}px) scale(${targetWidth / sourceRect.width})`,
            opacity: 0.88
          }
        ], {
          duration: 620,
          easing: "cubic-bezier(.22, .85, .25, 1)"
        }).finished;
      } catch (error) {
        // Animation cancellation should not block the finished output.
      } finally {
        clone.remove();
        source.classList.remove("is-moving-source");
      }
    }

    async function compressItem(item, mime, targetBytes) {
      item.status = "Compressing";
      item.error = "";
      item.outputBlob = null;
      item.outputName = "";
      item.isMoving = false;
      render();

      const bitmap = await decodeBitmap(item.file);
      item.width = bitmap.width;
      item.height = bitmap.height;

      const result = mime === "image/png"
        ? await encodePng(bitmap, targetBytes)
        : await encodeLossy(bitmap, mime, targetBytes);

      bitmap.close?.();

      if (!result || !result.blob) {
        throw new Error("No output was created.");
      }

      item.outputBlob = result.blob;
      item.outputSize = result.blob.size;
      item.outputName = outputNameFor(item, mime);
      item.outputWidth = result.width;
      item.outputHeight = result.height;
      item.quality = result.quality;
      item.meetsTarget = result.meetsTarget;
      item.status = "Moving";
      item.isMoving = true;
      item.error = result.meetsTarget ? "" : "The closest version is still above the goal.";
      render();

      await animateMoveToOutput(item.id);

      item.isMoving = false;
      item.status = result.meetsTarget ? "Done" : "Closest";
      render();
    }

    function thumbMarkup(item) {
      return item.previewUrl
        ? `<div class="thumb"><img src="${item.previewUrl}" alt=""></div>`
        : `<div class="thumb">IMG</div>`;
    }

    function statusClass(item) {
      if (item.status === "Done") return "done";
      if (item.status === "Closest") return "warn";
      if (item.status === "Unsupported" || item.status === "Error") return "error";
      if (item.status === "Compressing" || item.status === "Moving") return "working";
      return "";
    }

    function statusLabel(item) {
      if (item.status === "Moving") return "Moving";
      return item.status;
    }

    function dimensionsLabel(item) {
      return item.width && item.height ? `${item.width} x ${item.height}` : "Reading...";
    }

    function savedLabel(item) {
      if (!item.outputBlob) return "-";
      const saved = Math.max(0, (1 - item.outputBlob.size / item.file.size) * 100);
      return `${saved.toFixed(saved >= 10 ? 0 : 1)}%`;
    }

    function maxDownloadEdge(item) {
      return Math.max(item.width || item.outputWidth || 0, item.height || item.outputHeight || 0);
    }

    function renderInputRow(item) {
      const processing = item.status === "Compressing" || item.status === "Moving";
      const status = item.status === "Ready" ? "" : `<span class="status ${statusClass(item)}" title="${escapeHtml(item.error || item.status)}">${statusLabel(item)}</span>`;
      const canCompress = supportReady && !isWorking && canCompressInput(item);
      return `
        <article class="file-row input-row ${processing ? "is-processing" : ""}" data-id="${item.id}">
          ${thumbMarkup(item)}
          <div class="file-name">
            <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
            <span>${dimensionsLabel(item)}</span>
          </div>
          <div class="pill-value format-cell">${getInputLabel(item.file)}</div>
          <div class="pill-value size-cell">${status || formatBytes(item.file.size)}</div>
          <button class="icon-button row-compress" type="button" data-action="compress-one" data-id="${item.id}" title="Compress ${escapeHtml(item.file.name)}" ${canCompress ? "" : "disabled"}>
            ${iconArrowRight()}
          </button>
        </article>
      `;
    }

    function renderOutputRow(item) {
      const selected = selectedOutputIds.has(item.id);
      return `
        <article class="file-row output-row ${selected ? "is-selected" : ""}" data-id="${item.id}" aria-selected="${selected}">
          ${thumbMarkup(item)}
          <div class="file-name">
            <strong title="${escapeHtml(item.outputName || item.file.name)}">${escapeHtml(item.outputName || item.file.name)}</strong>
            <span>${item.outputWidth && item.outputHeight ? `${item.outputWidth} x ${item.outputHeight}` : dimensionsLabel(item)}</span>
          </div>
          <div class="pill-value format-cell">${(extensionByMime[getSelectedMime()] || getInputLabel(item.file)).toUpperCase()}</div>
          <div class="output-stat">
            <span>Original</span>
            <strong>${formatBytes(item.file.size)}</strong>
          </div>
          <div class="output-stat">
            <span>Output</span>
            <strong>${formatBytes(item.outputBlob.size)}</strong>
          </div>
          <div class="output-stat saved-stat">
            <span>Saved</span>
            <strong>${savedLabel(item)}</strong>
          </div>
          <div class="status-cell"><span class="status ${statusClass(item)}" title="${escapeHtml(item.error || item.status)}">${statusLabel(item)}</span></div>
          <button class="icon-button" type="button" data-action="download" data-id="${item.id}" title="Download ${escapeHtml(item.outputName)}">
            ${iconDownload()}
          </button>
        </article>
      `;
    }

    function render() {
      const inputItems = items.filter(isInputItem);
      const outputItems = items.filter(isOutputItem);

      els.inputRows.innerHTML = inputItems.map(renderInputRow).join("");
      els.outputRows.innerHTML = outputItems.map(renderOutputRow).join("");
      els.outputEmpty.hidden = outputItems.length > 0;
      const outputIds = new Set(outputItems.map((item) => item.id));
      for (const id of [...selectedOutputIds]) {
        if (!outputIds.has(id)) selectedOutputIds.delete(id);
      }

      const readyCount = inputItems.filter(canCompressInput).length;
      const selectedCount = selectedOutputIds.size;

      els.compressBtn.disabled = isWorking || !supportReady || readyCount === 0;
      els.inputClearBtn.disabled = isWorking || inputItems.length === 0;
      els.outputClearBtn.disabled = isWorking || outputItems.length === 0;
      els.downloadAllBtn.disabled = isWorking || outputItems.length === 0;
      els.downloadSelectedBtn.hidden = selectedCount === 0;
      els.downloadSelectedBtn.disabled = isWorking || selectedCount === 0;
      els.downloadSelectedLabel.textContent = `Download selected (${selectedCount})`;
      els.fileInput.disabled = isWorking;
      els.targetSize.disabled = isWorking;
      els.targetUnit.disabled = isWorking;

      document.querySelectorAll('input[name="format"]').forEach((choice) => {
        choice.disabled = isWorking || !supportReady || encoderSupport.get(choice.value) === false;
      });
    }

    function addFiles(fileList) {
      const nextFiles = [...fileList].filter(isImageLike);
      for (const file of nextFiles) {
        const item = {
          id: String(++idCounter),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "Reading",
          error: "",
          isMoving: false
        };
        items.push(item);
        probeDimensions(item);
      }
      setAutomaticGoalFromInput();
      render();
    }

    async function compressQueue(queue) {
      const mime = getSelectedMime();
      if (!supportReady) return;
      if (!encoderSupport.get(mime)) return;
      const pending = queue.filter(canCompressInput);
      if (pending.length === 0) return;
      isWorking = true;
      render();

      let nextIndex = 0;
      const workerCount = compressionConcurrency(pending);

      async function runWorker() {
        while (nextIndex < pending.length) {
          const item = pending[nextIndex];
          nextIndex += 1;
          if (!canCompressInput(item)) continue;

          try {
            await compressItem(item, mime, getTargetBytes(item));
          } catch (error) {
            item.status = "Error";
            item.error = error.message || "Compression failed.";
            item.outputBlob = null;
            item.isMoving = false;
            render();
          }
        }
      }

      try {
        await Promise.all(Array.from({ length: workerCount }, runWorker));
      } finally {
        isWorking = false;
        render();
      }
    }

    async function compressAll() {
      await compressQueue(items.filter(canCompressInput));
    }

    async function compressSingle(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      await compressQueue([item]);
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function downloadNameForPreset(item, preset) {
      const name = item.outputName || outputNameFor(item, getSelectedMime());
      if (preset.id === "original") return name;
      const ext = (name.match(/\.([^.]+)$/) || [])[1] || extensionByMime[getSelectedMime()] || "img";
      return `${stripExtension(name)}-${preset.suffix}.${ext}`;
    }

    function presetDescription(preset, requestItems) {
      if (preset.id === "original") {
        return requestItems.length === 1
          ? `${requestItems[0].width || requestItems[0].outputWidth} x ${requestItems[0].height || requestItems[0].outputHeight}`
          : "Use each source image dimensions";
      }
      return `Longest side ${preset.maxEdge}px`;
    }

    function isPresetAvailable(preset, requestItems) {
      if (preset.id === "original") return true;
      return requestItems.length > 0 && requestItems.every((item) => maxDownloadEdge(item) > preset.maxEdge);
    }

    function unavailablePresetReason(preset, requestItems) {
      if (preset.id === "original") return "";
      const tooSmall = requestItems.filter((item) => maxDownloadEdge(item) <= preset.maxEdge).length;
      if (tooSmall === 0) return "";
      return requestItems.length === 1 ? "Already smaller" : `${tooSmall} already smaller`;
    }

    function openDownloadDialog(requestItems) {
      downloadRequest = requestItems.filter(isOutputItem);
      if (downloadRequest.length === 0) return;

      els.downloadDialogMeta.textContent = downloadRequest.length === 1
        ? `Choose dimensions for ${downloadRequest[0].outputName || downloadRequest[0].file.name}.`
        : `Choose dimensions for ${downloadRequest.length} images.`;

      els.downloadOptions.innerHTML = downloadPresets.map((preset) => {
        const available = isPresetAvailable(preset, downloadRequest);
        const reason = available ? "" : unavailablePresetReason(preset, downloadRequest);
        return `
          <button class="download-option" type="button" data-preset="${preset.id}" ${available ? "" : "disabled"}>
            <span>
              <strong>${preset.label}</strong>
              <span>${presetDescription(preset, downloadRequest)}</span>
            </span>
            <em>${available ? "Download" : reason}</em>
          </button>
        `;
      }).join("");

      if (typeof els.downloadDialog.showModal === "function") {
        els.downloadDialog.showModal();
      }
    }

    function closeDownloadDialog() {
      if (els.downloadDialog.open) els.downloadDialog.close();
      downloadRequest = [];
    }

    async function resizedDownloadBlob(item, preset) {
      const bitmap = await decodeBitmap(item.file);
      try {
        const currentMax = Math.max(bitmap.width, bitmap.height);
        const scale = preset.maxEdge && currentMax > preset.maxEdge ? preset.maxEdge / currentMax : 1;
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const mime = item.outputBlob.type || getSelectedMime();
        const quality = item.quality || 0.88;
        return await renderToBlob(bitmap, mime, quality, width, height);
      } finally {
        bitmap.close?.();
      }
    }

    async function downloadItemsWithPreset(requestItems, preset) {
      const used = new Set();
      const files = [];

      for (const item of requestItems) {
        const blob = await resizedDownloadBlob(item, preset);
        files.push({
          name: uniqueZipName(downloadNameForPreset(item, preset), used),
          blob
        });
      }

      if (files.length === 0) return;
      if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name);
        return;
      }

      const zip = await makeZip(files);
      const suffix = preset.id === "original" ? "original" : preset.suffix;
      downloadBlob(zip, `tinimg-${suffix}.zip`);
    }

    function removeMatchingItems(predicate) {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (predicate(items[i])) {
          if (items[i].previewUrl) URL.revokeObjectURL(items[i].previewUrl);
          selectedOutputIds.delete(items[i].id);
          items.splice(i, 1);
        }
      }
      els.fileInput.value = "";
      render();
    }

    function clearInputItems() {
      removeMatchingItems(isInputItem);
    }

    function clearOutputItems() {
      removeMatchingItems(isOutputItem);
    }

    const crcTable = (() => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      return table;
    })();

    function crc32(bytes) {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i += 1) {
        c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      }
      return (c ^ 0xffffffff) >>> 0;
    }

    function u16(value) {
      return new Uint8Array([value & 255, (value >>> 8) & 255]);
    }

    function u32(value) {
      return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
    }

    function dosTimeDate(date) {
      const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
      const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
      return { time, day };
    }

    function concatArrays(parts) {
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      const out = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    }

    async function makeZip(files) {
      const encoder = new TextEncoder();
      const locals = [];
      const centrals = [];
      const dateParts = dosTimeDate(new Date());
      let offset = 0;

      for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        const crc = crc32(bytes);
        const localParts = [
          u32(0x04034b50), u16(20), u16(0x0800), u16(0),
          u16(dateParts.time), u16(dateParts.day),
          u32(crc), u32(bytes.length), u32(bytes.length),
          u16(nameBytes.length), u16(0), nameBytes, bytes
        ];
        const local = concatArrays(localParts);
        locals.push(local);

        const central = concatArrays([
          u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
          u16(dateParts.time), u16(dateParts.day),
          u32(crc), u32(bytes.length), u32(bytes.length),
          u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(offset), nameBytes
        ]);
        centrals.push(central);
        offset += local.length;
      }

      const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
      const end = concatArrays([
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(centralSize), u32(offset), u16(0)
      ]);

      return new Blob([...locals, ...centrals, end], { type: "application/zip" });
    }

    async function downloadAll() {
      openDownloadDialog(items.filter(isOutputItem));
    }

    function downloadSelected() {
      openDownloadDialog(items.filter((item) => selectedOutputIds.has(item.id)));
    }

    els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
    els.compressBtn.addEventListener("click", compressAll);
    els.inputClearBtn.addEventListener("click", clearInputItems);
    els.outputClearBtn.addEventListener("click", clearOutputItems);
    els.downloadAllBtn.addEventListener("click", downloadAll);
    els.downloadSelectedBtn.addEventListener("click", downloadSelected);
    els.downloadDialogClose.addEventListener("click", closeDownloadDialog);
    els.downloadDialog.addEventListener("click", (event) => {
      if (event.target === els.downloadDialog) closeDownloadDialog();
    });
    els.downloadOptions.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-preset]");
      if (!button || button.disabled) return;
      const preset = downloadPresets.find((entry) => entry.id === button.dataset.preset);
      if (!preset) return;
      const requestItems = [...downloadRequest];
      closeDownloadDialog();
      await downloadItemsWithPreset(requestItems, preset);
    });
    els.targetSize.addEventListener("input", () => {
      goalTouched = true;
    });

    els.targetUnit.addEventListener("change", () => {
      goalTouched = true;
      updateTargetForUnitChange(lastTargetUnit, els.targetUnit.value);
    });

    els.inputRows.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='compress-one']");
      if (!button) return;
      compressSingle(button.dataset.id);
    });

    els.outputRows.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='download']");
      if (button) {
        const item = items.find((entry) => entry.id === button.dataset.id);
        if (item?.outputBlob) openDownloadDialog([item]);
        return;
      }

      const row = event.target.closest(".output-row[data-id]");
      if (!row) return;
      if (selectedOutputIds.has(row.dataset.id)) selectedOutputIds.delete(row.dataset.id);
      else selectedOutputIds.add(row.dataset.id);
      render();
    });

    ["dragenter", "dragover"].forEach((type) => {
      document.addEventListener(type, (event) => {
        event.preventDefault();
        els.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((type) => {
      document.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === "drop") {
          addFiles(event.dataTransfer.files);
          els.dropzone.classList.remove("dragover");
          return;
        }
        if (!event.relatedTarget || event.target === document || event.target === document.documentElement) {
          els.dropzone.classList.remove("dragover");
        }
      });
    });

    els.formatGrid.addEventListener("change", () => {
      for (const item of items) {
        item.outputBlob = null;
        item.outputSize = 0;
        item.outputName = "";
        item.isMoving = false;
        if (item.status === "Done" || item.status === "Closest" || item.status === "Moving") item.status = "Ready";
      }
      render();
    });

    setupEncoderSupport();
    render();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {
          // The app still works without offline support.
        });
      });
    }

