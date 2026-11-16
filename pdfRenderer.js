import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function loadPdfProxy(arrayBuffer) {
  const bufferCopy = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
  return await loadingTask.promise;
}

export async function renderPageItemToCanvas(pageItem, sourceRecord, targetCanvas, targetWidth) {
  const outputScale = window.devicePixelRatio || 1;
  const extraRotation = pageItem.rotation || 0;
  const crop = pageItem.crop || { top: 0, bottom: 0, left: 0, right: 0 };

  const offscreen = document.createElement('canvas');

  if (pageItem.type === 'blank') {
    const isSwapped = extraRotation === 90 || extraRotation === 270;
    const rawW = isSwapped ? pageItem.height : pageItem.width;
    const rawH = isSwapped ? pageItem.width : pageItem.height;
    const baseScale = (targetWidth * outputScale) / rawW;

    offscreen.width = Math.max(1, Math.floor(rawW * baseScale));
    offscreen.height = Math.max(1, Math.floor(rawH * baseScale));

    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = Math.max(1, 2 * outputScale);
    ctx.setLineDash([6 * outputScale, 4 * outputScale]);
    ctx.strokeRect(
      4 * outputScale,
      4 * outputScale,
      offscreen.width - 8 * outputScale,
      offscreen.height - 8 * outputScale
    );
  } else {
    const page = await sourceRecord.pdfProxy.getPage(pageItem.pageIndex + 1);
    const totalRotation = (page.rotate + extraRotation) % 360;
    const unscaledViewport = page.getViewport({ scale: 1, rotation: totalRotation });
    const renderScale = (targetWidth * outputScale) / unscaledViewport.width;
    const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

    offscreen.width = Math.max(1, Math.floor(viewport.width));
    offscreen.height = Math.max(1, Math.floor(viewport.height));

    const offCtx = offscreen.getContext('2d');
    await page.render({
      canvasContext: offCtx,
      viewport,
    }).promise;
  }

  const sx = Math.floor(offscreen.width * crop.left);
  const sy = Math.floor(offscreen.height * crop.top);
  const sw = Math.max(1, Math.floor(offscreen.width * (1 - crop.left - crop.right)));
  const sh = Math.max(1, Math.floor(offscreen.height * (1 - crop.top - crop.bottom)));

  const aspectRatio = sh / sw;
  const displayCssWidth = Math.floor(targetWidth);
  const displayCssHeight = Math.max(1, Math.floor(displayCssWidth * aspectRatio));

  targetCanvas.width = Math.floor(displayCssWidth * outputScale);
  targetCanvas.height = Math.floor(displayCssHeight * outputScale);
  targetCanvas.style.width = `${displayCssWidth}px`;
  targetCanvas.style.height = `${displayCssHeight}px`;

  const targetCtx = targetCanvas.getContext('2d');
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetCtx.drawImage(offscreen, sx, sy, sw, sh, 0, 0, targetCanvas.width, targetCanvas.height);
}
