import { PDFDocument, degrees } from 'pdf-lib';

export async function readAndValidatePdfFile(file) {
  if (!file) {
    throw new Error('No file provided.');
  }

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength < 5) {
    throw new Error(`"${file.name}" is empty or corrupted.`);
  }

  const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
  const header = String.fromCharCode(...headerBytes);
  if (header !== '%PDF-') {
    throw new Error(`"${file.name}" is not a valid PDF document.`);
  }

  try {
    await PDFDocument.load(arrayBuffer);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('encrypted')) {
      throw new Error(`"${file.name}" is password-protected and cannot be opened.`);
    }
    throw new Error(`"${file.name}" appears to be corrupted or unsupported.`);
  }

  return arrayBuffer;
}

export async function buildPdfFromPages(sourceFilesMap, pagesList) {
  if (!pagesList || pagesList.length === 0) {
    throw new Error('No pages selected to generate PDF.');
  }

  const outputPdf = await PDFDocument.create();
  const loadedSourceDocs = new Map();

  for (const item of pagesList) {
    let page;

    if (item.type === 'blank') {
      const w = item.width || 612;
      const h = item.height || 792;
      page = outputPdf.addPage([w, h]);
    } else {
      let srcDoc = loadedSourceDocs.get(item.fileId);
      if (!srcDoc) {
        const record = sourceFilesMap.get(item.fileId);
        if (!record) {
          throw new Error('Original source file missing from memory.');
        }
        srcDoc = await PDFDocument.load(record.buffer);
        loadedSourceDocs.set(item.fileId, srcDoc);
      }

      const [copiedPage] = await outputPdf.copyPages(srcDoc, [item.pageIndex]);
      page = outputPdf.addPage(copiedPage);
    }

    if (item.rotation && item.rotation !== 0) {
      const existingAngle = page.getRotation().angle || 0;
      page.setRotation(degrees((existingAngle + item.rotation) % 360));
    }

    const crop = item.crop;
    if (crop && (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0)) {
      const { x, y, width, height } = page.getMediaBox();
      const angle = (page.getRotation().angle || 0) % 360;

      let normLeft = crop.left;
      let normRight = crop.right;
      let normTop = crop.top;
      let normBottom = crop.bottom;

      if (angle === 90) {
        normLeft = crop.bottom;
        normRight = crop.top;
        normTop = crop.left;
        normBottom = crop.right;
      } else if (angle === 180) {
        normLeft = crop.right;
        normRight = crop.left;
        normTop = crop.bottom;
        normBottom = crop.top;
      } else if (angle === 270) {
        normLeft = crop.top;
        normRight = crop.bottom;
        normTop = crop.right;
        normBottom = crop.left;
      }

      const newX = x + width * normLeft;
      const newY = y + height * normBottom;
      const newW = Math.max(10, width * (1 - normLeft - normRight));
      const newH = Math.max(10, height * (1 - normTop - normBottom));

      page.setCropBox(newX, newY, newW, newH);
      page.setMediaBox(newX, newY, newW, newH);
    }
  }

  return await outputPdf.save();
}

export function parseSplitRanges(rangeText, totalPages) {
  const cleaned = (rangeText || '').trim();
  if (!cleaned) {
    throw new Error('Please enter at least one page range (e.g., 1-3, 4-6).');
  }

  const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const pageNum = parseInt(part, 10);
      if (pageNum < 1 || pageNum > totalPages) {
        throw new Error(`Page ${pageNum} is out of bounds (1–${totalPages}).`);
      }
      results.push({ label: `p${pageNum}`, indices: [pageNum - 1] });
    } else if (/^(\d+)\s*-\s*(\d+)$/.test(part)) {
      const [, startStr, endStr] = part.match(/^(\d+)\s*-\s*(\d+)$/);
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`Invalid range "${part}". Valid pages are 1–${totalPages}.`);
      }

      const indices = [];
      for (let i = start; i <= end; i++) {
        indices.push(i - 1);
      }
      results.push({ label: `p${start}-${end}`, indices });
    } else {
      throw new Error(`Invalid format "${part}". Use numbers or ranges like "1-3, 4-6".`);
    }
  }

  return results;
}
