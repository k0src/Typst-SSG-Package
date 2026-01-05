const TSSG_COPY_PREFIX = "tssg:copy:";
const TSSG_SAMETAB_PREFIX = "tssg:sametab:";

async function renderPdf() {
  try {
    const base = window.BASE_PATH || "/";

    const pdfUrl = window.location.pathname.endsWith("/")
      ? window.location.pathname + "index.pdf"
      : window.location.pathname + "/index.pdf";
    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const pdfData = new Uint8Array(await response.arrayBuffer());

    const { init } = await import(`${base}assets/_pdfium/pdfium.esm.js`);
    const pdfium = await init({
      locateFile: (path, prefix) => {
        if (path.endsWith(".wasm")) {
          return `${base}assets/_pdfium/pdfium.wasm`;
        }
        return prefix + path;
      },
    });

    pdfium.PDFiumExt_Init();

    const filePtr = pdfium.pdfium.wasmExports.malloc(pdfData.length);
    pdfium.pdfium.HEAPU8.set(pdfData, filePtr);
    const docPtr = pdfium.FPDF_LoadMemDocument(filePtr, pdfData.length, "");

    if (!docPtr) {
      throw new Error("Failed to load PDF");
    }

    const pageCount = pdfium.FPDF_GetPageCount(docPtr);
    const container = document.getElementById("pdf-container");

    for (let i = 0; i < pageCount; i++) {
      await renderPage(pdfium, docPtr, i, container);
    }

    pdfium.FPDF_CloseDocument(docPtr);
    pdfium.pdfium.wasmExports.free(filePtr);

    document.getElementById("loading").style.display = "none";
  } catch (error) {
    document.getElementById("loading").textContent =
      "Error loading PDF: " + error.message;
    console.error("Error:", error);
  }
}

async function renderPage(pdfium, docPtr, pageIndex, container) {
  const pagePtr = pdfium.FPDF_LoadPage(docPtr, pageIndex);
  if (!pagePtr) return;

  const width = pdfium.FPDF_GetPageWidthF(pagePtr);
  const height = pdfium.FPDF_GetPageHeightF(pagePtr);

  const displayScale = 1.5;
  const qualityMultiplier = window.PDF_QUALITY || 2.0;
  const dpr = window.devicePixelRatio || 1;

  const displayWidth = Math.floor(width * displayScale);
  const displayHeight = Math.floor(height * displayScale);

  const renderScale = displayScale * qualityMultiplier * dpr;
  const renderWidth = Math.floor(width * renderScale);
  const renderHeight = Math.floor(height * renderScale);

  const pageDiv = document.createElement("div");
  pageDiv.className = "pdf-page";
  pageDiv.style.width = displayWidth + "px";
  pageDiv.style.height = displayHeight + "px";

  const canvas = document.createElement("canvas");
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  canvas.style.width = displayWidth + "px";
  canvas.style.height = displayHeight + "px";
  canvas.style.imageRendering = "auto";
  pageDiv.appendChild(canvas);

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  pageDiv.appendChild(textLayer);

  const linkLayer = document.createElement("div");
  linkLayer.className = "linkLayer";
  pageDiv.appendChild(linkLayer);

  container.appendChild(pageDiv);

  const ctx = canvas.getContext("2d");

  const fullPageMemory = renderWidth * renderHeight * 4;
  const maxMemory = 10 * 1024 * 1024;

  if (fullPageMemory > maxMemory) {
    const maxTileSize = 2048;
    const tilesX = Math.ceil(renderWidth / maxTileSize);
    const tilesY = Math.ceil(renderHeight / maxTileSize);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileX = tx * maxTileSize;
        const tileY = ty * maxTileSize;
        const tileWidth = Math.min(maxTileSize, renderWidth - tileX);
        const tileHeight = Math.min(maxTileSize, renderHeight - tileY);

        const bitmapPtr = pdfium.FPDFBitmap_Create(tileWidth, tileHeight, 0);
        pdfium.FPDFBitmap_FillRect(
          bitmapPtr,
          0,
          0,
          tileWidth,
          tileHeight,
          0xffffffff
        );

        pdfium.FPDF_RenderPageBitmap(
          bitmapPtr,
          pagePtr,
          -tileX,
          -tileY,
          renderWidth,
          renderHeight,
          0,
          0x10 | 0x01 | 0x800
        );

        const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
        const bufferSize = tileWidth * tileHeight * 4;
        const buffer = new Uint8Array(
          pdfium.pdfium.HEAPU8.buffer,
          pdfium.pdfium.HEAPU8.byteOffset + bufferPtr,
          bufferSize
        ).slice();
        const tileImageData = new ImageData(
          new Uint8ClampedArray(buffer.buffer),
          tileWidth,
          tileHeight
        );

        ctx.putImageData(tileImageData, tileX, tileY);

        pdfium.FPDFBitmap_Destroy(bitmapPtr);
      }
    }
  } else {
    const bitmapPtr = pdfium.FPDFBitmap_Create(renderWidth, renderHeight, 0);
    pdfium.FPDFBitmap_FillRect(
      bitmapPtr,
      0,
      0,
      renderWidth,
      renderHeight,
      0xffffffff
    );
    pdfium.FPDF_RenderPageBitmap(
      bitmapPtr,
      pagePtr,
      0,
      0,
      renderWidth,
      renderHeight,
      0,
      0x10 | 0x01 | 0x800
    );

    const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
    const bufferSize = renderWidth * renderHeight * 4;
    const buffer = new Uint8Array(
      pdfium.pdfium.HEAPU8.buffer,
      pdfium.pdfium.HEAPU8.byteOffset + bufferPtr,
      bufferSize
    ).slice();
    const imageData = new ImageData(
      new Uint8ClampedArray(buffer.buffer),
      renderWidth,
      renderHeight
    );

    ctx.putImageData(imageData, 0, 0);

    pdfium.FPDFBitmap_Destroy(bitmapPtr);
  }

  renderTextLayer(pdfium, pagePtr, textLayer, width, height, displayScale, dpr);

  renderLinkLayer(
    pdfium,
    docPtr,
    pagePtr,
    linkLayer,
    width,
    height,
    displayScale
  );

  pdfium.FPDF_ClosePage(pagePtr);
}

function renderTextLayer(
  pdfium,
  pagePtr,
  textLayer,
  pageWidth,
  pageHeight,
  scale,
  dpr
) {
  const textPagePtr = pdfium.FPDFText_LoadPage(pagePtr);
  if (!textPagePtr) return;

  const charCount = pdfium.FPDFText_CountChars(textPagePtr);
  if (charCount <= 0) {
    pdfium.FPDFText_ClosePage(textPagePtr);
    return;
  }

  const rectCount = pdfium.FPDFText_CountRects(textPagePtr, 0, charCount);
  if (rectCount <= 0) {
    pdfium.FPDFText_ClosePage(textPagePtr);
    return;
  }

  const leftPtr = pdfium.pdfium._malloc(8);
  const topPtr = pdfium.pdfium._malloc(8);
  const rightPtr = pdfium.pdfium._malloc(8);
  const bottomPtr = pdfium.pdfium._malloc(8);
  const textBufferPtr = pdfium.pdfium._malloc(2000);

  for (let i = 0; i < rectCount; i++) {
    if (
      !pdfium.FPDFText_GetRect(
        textPagePtr,
        i,
        leftPtr,
        topPtr,
        rightPtr,
        bottomPtr
      )
    )
      continue;

    const left = pdfium.pdfium.HEAPF64[leftPtr >> 3];
    const top = pdfium.pdfium.HEAPF64[topPtr >> 3];
    const right = pdfium.pdfium.HEAPF64[rightPtr >> 3];
    const bottom = pdfium.pdfium.HEAPF64[bottomPtr >> 3];

    const textLength = pdfium.FPDFText_GetBoundedText(
      textPagePtr,
      left,
      top,
      right,
      bottom,
      textBufferPtr,
      1000
    );

    if (textLength > 1) {
      const text = pdfium.pdfium.UTF16ToString(textBufferPtr);
      const span = document.createElement("span");
      span.textContent = text;

      const x = left * scale;
      const y = (pageHeight - top) * scale;
      const fontSize = (top - bottom) * scale;
      const pdfWidth = (right - left) * scale;

      span.style.left = x + "px";
      span.style.top = y + "px";
      span.style.fontSize = fontSize + "px";

      textLayer.appendChild(span);

      const naturalWidth = span.offsetWidth;

      if (naturalWidth > 0) {
        const scaleX = pdfWidth / naturalWidth;
        span.style.transform = `scaleX(${scaleX})`;
        span.style.width = pdfWidth + "px";
      }
    }
  }

  pdfium.pdfium._free(textBufferPtr);
  pdfium.pdfium._free(leftPtr);
  pdfium.pdfium._free(topPtr);
  pdfium.pdfium._free(rightPtr);
  pdfium.pdfium._free(bottomPtr);
  pdfium.FPDFText_ClosePage(textPagePtr);
}

function renderLinkLayer(
  pdfium,
  docPtr,
  pagePtr,
  linkLayer,
  pageWidth,
  pageHeight,
  scale
) {
  if (typeof pdfium.FPDFLink_Enumerate !== "function") {
    console.error("FPDFLink_Enumerate not available");
    return;
  }

  const rectBuffer = pdfium.pdfium._malloc(16); // FS_RECTF: 4 floats * 4 bytes
  const posPtr = pdfium.pdfium._malloc(4); // int for startPos
  const linkPtr = pdfium.pdfium._malloc(4); // FPDF_LINK pointer
  const urlBufferSize = 2048;
  const urlBufferPtr = pdfium.pdfium._malloc(urlBufferSize);

  pdfium.pdfium.HEAP32[posPtr >> 2] = 0;
  let linkCount = 0;

  while (pdfium.FPDFLink_Enumerate(pagePtr, posPtr, linkPtr)) {
    linkCount++;
    const link = pdfium.pdfium.HEAP32[linkPtr >> 2];
    if (!link) break;

    const hasRect = pdfium.FPDFLink_GetAnnotRect(link, rectBuffer);
    if (!hasRect) {
      continue;
    }

    const left = pdfium.pdfium.HEAPF32[(rectBuffer >> 2) + 0];
    const bottom = pdfium.pdfium.HEAPF32[(rectBuffer >> 2) + 1];
    const right = pdfium.pdfium.HEAPF32[(rectBuffer >> 2) + 2];
    const top = pdfium.pdfium.HEAPF32[(rectBuffer >> 2) + 3];

    const action = pdfium.FPDFLink_GetAction(link);
    const linkElement = document.createElement("a");

    if (!action) {
      const dest = pdfium.FPDFLink_GetDest(docPtr, link);

      if (dest) {
        const destPageIndex = pdfium.FPDFDest_GetDestPageIndex(docPtr, dest);

        const hasXPtr = pdfium.pdfium._malloc(4);
        const hasYPtr = pdfium.pdfium._malloc(4);
        const hasZoomPtr = pdfium.pdfium._malloc(4);
        const xPtr = pdfium.pdfium._malloc(4);
        const yPtr = pdfium.pdfium._malloc(4);
        const zoomPtr = pdfium.pdfium._malloc(4);

        const hasLocation = pdfium.FPDFDest_GetLocationInPage(
          dest,
          hasXPtr,
          hasYPtr,
          hasZoomPtr,
          xPtr,
          yPtr,
          zoomPtr
        );

        let scrollX = null,
          scrollY = null;
        if (hasLocation) {
          const hasX = pdfium.pdfium.HEAP32[hasXPtr >> 2];
          const hasY = pdfium.pdfium.HEAP32[hasYPtr >> 2];
          if (hasX) scrollX = pdfium.pdfium.HEAPF32[xPtr >> 2];
          if (hasY) scrollY = pdfium.pdfium.HEAPF32[yPtr >> 2];
        }

        pdfium.pdfium._free(hasXPtr);
        pdfium.pdfium._free(hasYPtr);
        pdfium.pdfium._free(hasZoomPtr);
        pdfium.pdfium._free(xPtr);
        pdfium.pdfium._free(yPtr);
        pdfium.pdfium._free(zoomPtr);

        linkElement.href = "#";
        linkElement.onclick = (e) => {
          e.preventDefault();
          const targetPage =
            document.querySelectorAll(".pdf-page")[destPageIndex];
          if (targetPage && scrollY !== null) {
            const pageHeight = parseFloat(targetPage.style.height);
            const screenY = pageHeight / scale - scrollY;
            const scrollTop = targetPage.offsetTop + screenY * scale;
            window.scrollTo({ top: scrollTop, behavior: "smooth" });
          } else if (targetPage) {
            targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        };
      } else {
        continue;
      }
    } else {
      const actionType = pdfium.FPDFAction_GetType(action);

      if (actionType === 3) {
        const uriLength = pdfium.FPDFAction_GetURIPath(docPtr, action, null, 0);
        if (uriLength <= 0) {
          continue;
        }

        pdfium.FPDFAction_GetURIPath(
          docPtr,
          action,
          urlBufferPtr,
          urlBufferSize
        );

        const urlBytes = new Uint8Array(
          pdfium.pdfium.HEAPU8.buffer,
          pdfium.pdfium.HEAPU8.byteOffset + urlBufferPtr,
          uriLength - 1
        );
        let url = new TextDecoder().decode(urlBytes);

        if (!url) {
          continue;
        }

        if (url.startsWith(TSSG_COPY_PREFIX)) {
          const textToCopy = url.substring(TSSG_COPY_PREFIX.length);
          linkElement.href = "#";
          linkElement.onclick = async (e) => {
            e.preventDefault();
            await navigator.clipboard.writeText(textToCopy);
          };
        } else if (url.startsWith(TSSG_SAMETAB_PREFIX)) {
          linkElement.href = url.substring(TSSG_SAMETAB_PREFIX.length);
        } else {
          linkElement.href = url;
          linkElement.target = "_blank";
          linkElement.rel = "noopener noreferrer";
        }
      } else if (actionType === 1) {
        const dest = pdfium.FPDFAction_GetDest(docPtr, action);

        if (dest) {
          const destPageIndex = pdfium.FPDFDest_GetDestPageIndex(docPtr, dest);

          const hasXPtr = pdfium.pdfium._malloc(4);
          const hasYPtr = pdfium.pdfium._malloc(4);
          const hasZoomPtr = pdfium.pdfium._malloc(4);
          const xPtr = pdfium.pdfium._malloc(4);
          const yPtr = pdfium.pdfium._malloc(4);
          const zoomPtr = pdfium.pdfium._malloc(4);

          const hasLocation = pdfium.FPDFDest_GetLocationInPage(
            dest,
            hasXPtr,
            hasYPtr,
            hasZoomPtr,
            xPtr,
            yPtr,
            zoomPtr
          );

          let scrollX = null,
            scrollY = null;
          if (hasLocation) {
            const hasX = pdfium.pdfium.HEAP32[hasXPtr >> 2];
            const hasY = pdfium.pdfium.HEAP32[hasYPtr >> 2];
            if (hasX) scrollX = pdfium.pdfium.HEAPF32[xPtr >> 2];
            if (hasY) scrollY = pdfium.pdfium.HEAPF32[yPtr >> 2];
          }

          pdfium.pdfium._free(hasXPtr);
          pdfium.pdfium._free(hasYPtr);
          pdfium.pdfium._free(hasZoomPtr);
          pdfium.pdfium._free(xPtr);
          pdfium.pdfium._free(yPtr);
          pdfium.pdfium._free(zoomPtr);

          linkElement.href = "#";
          linkElement.onclick = (e) => {
            e.preventDefault();
            const targetPage =
              document.querySelectorAll(".pdf-page")[destPageIndex];
            if (targetPage && scrollY !== null) {
              const pageHeight = parseFloat(targetPage.style.height);
              const screenY = pageHeight / scale - scrollY;
              const scrollTop = targetPage.offsetTop + screenY * scale;
              window.scrollTo({ top: scrollTop, behavior: "smooth" });
            } else if (targetPage) {
              targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          };
        } else {
          continue;
        }
      } else {
        console.warn("Unsupported action type:", actionType);
        continue;
      }
    }

    const x = left * scale;
    const y = (pageHeight - bottom) * scale;
    const width = (right - left) * scale;
    const height = (bottom - top) * scale;

    linkElement.style.position = "absolute";
    linkElement.style.left = x + "px";
    linkElement.style.top = y + "px";
    linkElement.style.width = width + "px";
    linkElement.style.height = height + "px";
    linkElement.style.cursor = "pointer";

    linkLayer.appendChild(linkElement);
  }

  pdfium.pdfium._free(rectBuffer);
  pdfium.pdfium._free(posPtr);
  pdfium.pdfium._free(linkPtr);
  pdfium.pdfium._free(urlBufferPtr);
}

async function renderSidebarPdf(pdfUrl, containerId) {
  try {
    const base = window.BASE_PATH || "/";

    const response = await fetch(pdfUrl);
    if (!response.ok) return;

    const pdfData = new Uint8Array(await response.arrayBuffer());
    const { init } = await import(`${base}assets/_pdfium/pdfium.esm.js`);
    const pdfium = await init({
      locateFile: (path, prefix) => {
        if (path.endsWith(".wasm")) {
          return `${base}assets/_pdfium/pdfium.wasm`;
        }
        return prefix + path;
      },
    });

    pdfium.PDFiumExt_Init();

    const filePtr = pdfium.pdfium.wasmExports.malloc(pdfData.length);
    pdfium.pdfium.HEAPU8.set(pdfData, filePtr);
    const docPtr = pdfium.FPDF_LoadMemDocument(filePtr, pdfData.length, "");

    if (!docPtr) return;

    const pageCount = pdfium.FPDF_GetPageCount(docPtr);
    const container = document.getElementById(containerId);

    for (let i = 0; i < pageCount; i++) {
      await renderPage(pdfium, docPtr, i, container);
    }

    pdfium.FPDF_CloseDocument(docPtr);
    pdfium.pdfium.wasmExports.free(filePtr);
  } catch (error) {
    console.error(`Error loading ${pdfUrl}:`, error);
  }
}

renderPdf();

if (window.HAS_SIDEBAR) {
  const sidebarUrl = window.location.pathname.endsWith("/")
    ? window.location.pathname + "sidebar.pdf"
    : window.location.pathname + "/sidebar.pdf";
  renderSidebarPdf(sidebarUrl, "sidebar-container");
}

if (window.HAS_TOC) {
  const tocUrl = window.location.pathname.endsWith("/")
    ? window.location.pathname + "toc.pdf"
    : window.location.pathname + "/toc.pdf";
  renderSidebarPdf(tocUrl, "toc-container");
}
