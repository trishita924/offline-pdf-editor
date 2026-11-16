import { loadPdfProxy, renderPageItemToCanvas } from './utils/pdfRenderer.js';
import {
  readAndValidatePdfFile,
  buildPdfFromPages,
  parseSplitRanges,
} from './utils/pdfManipulator.js';

const state = {
  sourceFiles: new Map(),
  pages: [],
  activePageId: null,
  draggedPageId: null,
};

const els = {
  btnUpload: document.getElementById('btn-upload'),
  btnEmptyUpload: document.getElementById('btn-empty-upload'),
  btnMerge: document.getElementById('btn-merge'),
  btnReorder: document.getElementById('btn-reorder'),
  btnClear: document.getElementById('btn-clear'),
  btnSave: document.getElementById('btn-save'),
  inputUpload: document.getElementById('input-upload'),
  inputMerge: document.getElementById('input-merge'),

  btnSelectAll: document.getElementById('btn-select-all'),
  selectAllLabel: document.getElementById('select-all-label'),
  selectionCountBadge: document.getElementById('selection-count-badge'),
  btnRotateLeft: document.getElementById('btn-rotate-left'),
  btnRotateRight: document.getElementById('btn-rotate-right'),
  btnRotate180: document.getElementById('btn-rotate-180'),
  btnDuplicate: document.getElementById('btn-duplicate'),
  btnInsertBlank: document.getElementById('btn-insert-blank'),
  btnCrop: document.getElementById('btn-crop'),
  btnDelete: document.getElementById('btn-delete'),
  btnExtract: document.getElementById('btn-extract'),
  btnSplit: document.getElementById('btn-split'),

  sidebar: document.getElementById('sidebar'),
  thumbnailList: document.getElementById('thumbnail-list'),
  pageCountBadge: document.getElementById('page-count-badge'),
  emptyState: document.getElementById('empty-state'),
  dropzone: document.getElementById('dropzone'),
  canvasWrapper: document.getElementById('canvas-wrapper'),
  mainCanvas: document.getElementById('main-pdf-canvas'),
  previewPageInfo: document.getElementById('preview-page-info'),
  previewRotationTag: document.getElementById('preview-rotation-tag'),
  previewCropTag: document.getElementById('preview-crop-tag'),
  previewSourceInfo: document.getElementById('preview-source-info'),

  modalSplit: document.getElementById('modal-split'),
  splitTotalPages: document.getElementById('split-total-pages'),
  splitRangesBox: document.getElementById('split-ranges-box'),
  inputSplitRanges: document.getElementById('input-split-ranges'),
  btnConfirmSplit: document.getElementById('btn-confirm-split'),

  modalBlank: document.getElementById('modal-blank'),
  selectBlankPosition: document.getElementById('select-blank-position'),
  selectBlankSize: document.getElementById('select-blank-size'),
  btnConfirmBlank: document.getElementById('btn-confirm-blank'),

  modalCrop: document.getElementById('modal-crop'),
  cropTargetCount: document.getElementById('crop-target-count'),
  cropTop: document.getElementById('crop-top'),
  cropBottom: document.getElementById('crop-bottom'),
  cropLeft: document.getElementById('crop-left'),
  cropRight: document.getElementById('crop-right'),
  btnResetCrop: document.getElementById('btn-reset-crop'),
  btnConfirmCrop: document.getElementById('btn-confirm-crop'),

  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toastContainer: document.getElementById('toast-container'),
};

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function setLoading(isLoading, message = 'Processing PDF locally...') {
  els.loadingText.textContent = message;
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3800);
}

function triggerBinaryDownload(pdfBytes, fileName) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function getBaseDocumentName() {
  const firstPdfPage = state.pages.find((p) => p.type === 'pdf');
  if (!firstPdfPage) return 'document';
  const rawName = state.sourceFiles.get(firstPdfPage.fileId)?.name || 'document.pdf';
  return rawName.replace(/\.pdf$/i, '');
}

function getTargetPages() {
  const checked = state.pages.filter((p) => p.selected);
  if (checked.length > 0) return checked;
  const active = state.pages.find((p) => p.id === state.activePageId);
  return active ? [active] : [];
}

function updateToolbarState() {
  const total = state.pages.length;
  const hasPages = total > 0;
  const checkedCount = state.pages.filter((p) => p.selected).length;
  const hasTarget = hasPages && (checkedCount > 0 || Boolean(state.activePageId));

  els.btnMerge.disabled = !hasPages;
  els.btnReorder.disabled = total < 2;
  els.btnClear.disabled = !hasPages;
  els.btnSave.disabled = !hasPages;

  els.btnSelectAll.disabled = !hasPages;
  els.selectAllLabel.textContent = hasPages && checkedCount === total ? 'Deselect All' : 'Select All';
  els.selectionCountBadge.textContent = `${checkedCount} selected`;

  els.btnRotateLeft.disabled = !hasTarget;
  els.btnRotateRight.disabled = !hasTarget;
  els.btnRotate180.disabled = !hasTarget;
  els.btnDuplicate.disabled = !hasTarget;
  els.btnCrop.disabled = !hasTarget;
  els.btnDelete.disabled = !hasTarget;
  els.btnExtract.disabled = !hasTarget;

  els.btnInsertBlank.disabled = !hasPages;
  els.btnSplit.disabled = !hasPages;

  els.pageCountBadge.textContent = `${total} ${total === 1 ? 'page' : 'pages'}`;
}

async function ingestFiles(fileList, { replaceExisting = false } = {}) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  setLoading(true, `Loading ${files.length} PDF ${files.length === 1 ? 'file' : 'files'}...`);

  try {
    if (replaceExisting) {
      clearWorkspaceState();
    }

    let addedPagesCount = 0;

    for (const file of files) {
      try {
        const buffer = await readAndValidatePdfFile(file);
        const pdfProxy = await loadPdfProxy(buffer);
        const fileId = generateId('file');

        state.sourceFiles.set(fileId, {
          name: file.name,
          buffer,
          pdfProxy,
        });

        for (let i = 0; i < pdfProxy.numPages; i++) {
          const page = await pdfProxy.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });

          state.pages.push({
            id: generateId('page'),
            type: 'pdf',
            fileId,
            pageIndex: i,
            width: vp.width,
            height: vp.height,
            rotation: 0,
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
            selected: false,
          });
          addedPagesCount++;
        }
      } catch (fileError) {
        showToast(fileError.message, 'error');
      }
    }

    if (addedPagesCount > 0) {
      if (!state.activePageId || !state.pages.some((p) => p.id === state.activePageId)) {
        state.activePageId = state.pages[0].id;
      }

      await renderSidebarThumbnails();
      await renderMainPreview();
      updateToolbarState();

      const actionWord = replaceExisting ? 'Loaded' : 'Merged';
      showToast(`${actionWord} ${addedPagesCount} ${addedPagesCount === 1 ? 'page' : 'pages'}.`, 'success');
    }
  } finally {
    setLoading(false);
    els.inputUpload.value = '';
    els.inputMerge.value = '';
  }
}

function clearWorkspaceState() {
  for (const fileRecord of state.sourceFiles.values()) {
    if (fileRecord.pdfProxy && typeof fileRecord.pdfProxy.destroy === 'function') {
      fileRecord.pdfProxy.destroy();
    }
  }
  state.sourceFiles.clear();
  state.pages = [];
  state.activePageId = null;
  state.draggedPageId = null;

  els.thumbnailList.innerHTML = '<div class="sidebar-empty-hint">No pages loaded</div>';
  els.emptyState.classList.remove('hidden');
  els.canvasWrapper.classList.add('hidden');
  updateToolbarState();
}

async function renderSidebarThumbnails() {
  if (state.pages.length === 0) {
    els.thumbnailList.innerHTML = '<div class="sidebar-empty-hint">No pages loaded</div>';
    return;
  }

  els.thumbnailList.innerHTML = '';

  for (let idx = 0; idx < state.pages.length; idx++) {
    const pageItem = state.pages[idx];
    const sourceRecord = pageItem.type === 'pdf' ? state.sourceFiles.get(pageItem.fileId) : null;
    if (pageItem.type === 'pdf' && !sourceRecord) continue;

    const card = document.createElement('div');
    card.className = 'thumbnail-item';
    if (pageItem.id === state.activePageId) card.classList.add('active');
    if (pageItem.selected) card.classList.add('selected');
    card.draggable = true;
    card.dataset.pageId = pageItem.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'thumbnail-checkbox';
    checkbox.checked = pageItem.selected;
    checkbox.title = 'Select page for batch actions';
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      pageItem.selected = checkbox.checked;
      card.classList.toggle('selected', pageItem.selected);
      updateToolbarState();
    });
    card.appendChild(checkbox);

    const isCropped =
      pageItem.crop &&
      (pageItem.crop.top > 0 ||
        pageItem.crop.bottom > 0 ||
        pageItem.crop.left > 0 ||
        pageItem.crop.right > 0);
    if (pageItem.rotation > 0 || isCropped) {
      const pill = document.createElement('span');
      pill.className = 'thumbnail-badge-pill';
      const labels = [];
      if (pageItem.rotation > 0) labels.push(`${pageItem.rotation}°`);
      if (isCropped) labels.push('Crop');
      pill.textContent = labels.join(' • ');
      card.appendChild(pill);
    }

    const canvasBox = document.createElement('div');
    canvasBox.className = 'thumbnail-canvas-box';

    const thumbCanvas = document.createElement('canvas');
    canvasBox.appendChild(thumbCanvas);

    const fileLabel = pageItem.type === 'blank' ? 'Blank Page' : sourceRecord.name;
    const meta = document.createElement('div');
    meta.className = 'thumbnail-meta';
    meta.innerHTML = `
      <span class="thumbnail-number">${idx + 1}</span>
      <span class="thumbnail-file-label" title="${fileLabel}">${fileLabel}</span>
    `;

    card.appendChild(canvasBox);
    card.appendChild(meta);
    els.thumbnailList.appendChild(card);

    card.addEventListener('click', () => {
      if (state.activePageId !== pageItem.id) {
        state.activePageId = pageItem.id;
        updateActiveThumbnailHighlight();
        renderMainPreview();
      }
    });

    attachDragEvents(card, pageItem.id);
    await renderPageItemToCanvas(pageItem, sourceRecord, thumbCanvas, 170);
  }
}

function updateActiveThumbnailHighlight() {
  const cards = els.thumbnailList.querySelectorAll('.thumbnail-item');
  cards.forEach((card) => {
    card.classList.toggle('active', card.dataset.pageId === state.activePageId);
  });
}

async function renderMainPreview() {
  if (state.pages.length === 0 || !state.activePageId) {
    els.emptyState.classList.remove('hidden');
    els.canvasWrapper.classList.add('hidden');
    return;
  }

  const currentIdx = state.pages.findIndex((p) => p.id === state.activePageId);
  const pageItem = state.pages[currentIdx];
  if (!pageItem) return;

  const sourceRecord = pageItem.type === 'pdf' ? state.sourceFiles.get(pageItem.fileId) : null;
  if (pageItem.type === 'pdf' && !sourceRecord) return;

  els.emptyState.classList.add('hidden');
  els.canvasWrapper.classList.remove('hidden');

  els.previewPageInfo.textContent = `Page ${currentIdx + 1} of ${state.pages.length}`;
  els.previewSourceInfo.textContent =
    pageItem.type === 'blank'
      ? 'Inserted Blank Page'
      : `${sourceRecord.name} (Orig. p.${pageItem.pageIndex + 1})`;

  if (pageItem.rotation > 0) {
    els.previewRotationTag.textContent = `Rotated ${pageItem.rotation}°`;
    els.previewRotationTag.classList.remove('hidden');
  } else {
    els.previewRotationTag.classList.add('hidden');
  }

  const isCropped =
    pageItem.crop &&
    (pageItem.crop.top > 0 ||
      pageItem.crop.bottom > 0 ||
      pageItem.crop.left > 0 ||
      pageItem.crop.right > 0);
  if (isCropped) {
    els.previewCropTag.textContent = `Cropped (T:${Math.round(pageItem.crop.top * 100)}% B:${Math.round(
      pageItem.crop.bottom * 100
    )}% L:${Math.round(pageItem.crop.left * 100)}% R:${Math.round(pageItem.crop.right * 100)}%)`;
    els.previewCropTag.classList.remove('hidden');
  } else {
    els.previewCropTag.classList.add('hidden');
  }

  const containerWidth = els.canvasWrapper.clientWidth - 64;
  const targetWidth = Math.max(300, Math.min(760, containerWidth));

  await renderPageItemToCanvas(pageItem, sourceRecord, els.mainCanvas, targetWidth);
}

async function rotateTargetPages(deltaDegrees) {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  for (const page of targets) {
    page.rotation = (page.rotation + deltaDegrees) % 360;
  }

  await renderSidebarThumbnails();
  await renderMainPreview();
  showToast(`Rotated ${targets.length} ${targets.length === 1 ? 'page' : 'pages'} by ${deltaDegrees}°.`, 'success');
}

async function deleteTargetPages() {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  const targetIds = new Set(targets.map((p) => p.id));
  const deletedCount = targetIds.size;

  const firstDeletedIdx = state.pages.findIndex((p) => targetIds.has(p.id));
  state.pages = state.pages.filter((p) => !targetIds.has(p.id));

  if (state.pages.length === 0) {
    clearWorkspaceState();
    showToast(`Deleted ${deletedCount} ${deletedCount === 1 ? 'page' : 'pages'}. Workspace is now empty.`, 'info');
    return;
  }

  if (!state.pages.some((p) => p.id === state.activePageId)) {
    const nextIdx = Math.min(firstDeletedIdx, state.pages.length - 1);
    state.activePageId = state.pages[nextIdx].id;
  }

  await renderSidebarThumbnails();
  await renderMainPreview();
  updateToolbarState();
  showToast(`Deleted ${deletedCount} ${deletedCount === 1 ? 'page' : 'pages'}.`, 'success');
}

async function duplicateTargetPages() {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  const targetIds = new Set(targets.map((p) => p.id));
  const updatedPages = [];
  let lastClonedId = null;

  for (const page of state.pages) {
    updatedPages.push(page);
    if (targetIds.has(page.id)) {
      const clone = {
        ...page,
        id: generateId('page'),
        crop: { ...page.crop },
        selected: false,
      };
      updatedPages.push(clone);
      lastClonedId = clone.id;
    }
  }

  state.pages = updatedPages;
  if (lastClonedId) {
    state.activePageId = lastClonedId;
  }

  await renderSidebarThumbnails();
  await renderMainPreview();
  updateToolbarState();
  showToast(`Duplicated ${targets.length} ${targets.length === 1 ? 'page' : 'pages'}.`, 'success');
}

async function extractTargetPages() {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  setLoading(true, `Extracting ${targets.length} ${targets.length === 1 ? 'page' : 'pages'}...`);
  try {
    const pdfBytes = await buildPdfFromPages(state.sourceFiles, targets);
    const fileName = `${getBaseDocumentName()}_extracted_${targets.length}p.pdf`;
    triggerBinaryDownload(pdfBytes, fileName);
    showToast(`Extracted ${targets.length} ${targets.length === 1 ? 'page' : 'pages'} to "${fileName}".`, 'success');
  } catch (err) {
    showToast(`Extraction failed: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function openSplitModal() {
  if (state.pages.length === 0) return;
  els.splitTotalPages.textContent = state.pages.length;
  els.inputSplitRanges.value = state.pages.length > 1 ? `1-${Math.ceil(state.pages.length / 2)}, ${Math.ceil(state.pages.length / 2) + 1}-${state.pages.length}` : '1';
  els.modalSplit.classList.remove('hidden');
}

async function handleConfirmSplit() {
  const mode = document.querySelector('input[name="split-mode"]:checked')?.value || 'ranges';
  const baseName = getBaseDocumentName();

  try {
    let groups = [];

    if (mode === 'all') {
      groups = state.pages.map((page, idx) => ({
        label: `page_${idx + 1}`,
        pages: [page],
      }));
    } else {
      const parsed = parseSplitRanges(els.inputSplitRanges.value, state.pages.length);
      groups = parsed.map((g) => ({
        label: g.label,
        pages: g.indices.map((i) => state.pages[i]),
      }));
    }

    els.modalSplit.classList.add('hidden');
    setLoading(true, `Splitting into ${groups.length} PDF ${groups.length === 1 ? 'file' : 'files'}...`);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const pdfBytes = await buildPdfFromPages(state.sourceFiles, group.pages);
      const fileName = `${baseName}_split_${i + 1}_${group.label}.pdf`;
      triggerBinaryDownload(pdfBytes, fileName);
      if (groups.length > 1) {
        await new Promise((r) => setTimeout(r, 220));
      }
    }

    showToast(`Split into ${groups.length} separate PDF ${groups.length === 1 ? 'file' : 'files'}.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

function openBlankPageModal() {
  if (state.pages.length === 0) return;
  els.modalBlank.classList.remove('hidden');
}

async function handleConfirmBlankPage() {
  const position = els.selectBlankPosition.value;
  const sizeMode = els.selectBlankSize.value;

  const activeIdx = Math.max(0, state.pages.findIndex((p) => p.id === state.activePageId));
  const refPage = state.pages[activeIdx];

  let width = 612;
  let height = 792;

  if (sizeMode === 'a4') {
    width = 595.28;
    height = 841.89;
  } else if (sizeMode === 'match' && refPage) {
    width = refPage.width || 612;
    height = refPage.height || 792;
  }

  const blankPage = {
    id: generateId('blank'),
    type: 'blank',
    width,
    height,
    rotation: 0,
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    selected: false,
  };

  let insertIndex = state.pages.length;
  if (position === 'start') insertIndex = 0;
  else if (position === 'before') insertIndex = activeIdx;
  else if (position === 'after') insertIndex = activeIdx + 1;

  state.pages.splice(insertIndex, 0, blankPage);
  state.activePageId = blankPage.id;

  els.modalBlank.classList.add('hidden');
  await renderSidebarThumbnails();
  await renderMainPreview();
  updateToolbarState();
  showToast(`Inserted blank page at position ${insertIndex + 1}.`, 'success');
}

function openCropModal() {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  els.cropTargetCount.textContent = `${targets.length} ${targets.length === 1 ? 'page' : 'pages'}`;
  const sample = targets[0].crop || { top: 0, bottom: 0, left: 0, right: 0 };

  els.cropTop.value = Math.round(sample.top * 100);
  els.cropBottom.value = Math.round(sample.bottom * 100);
  els.cropLeft.value = Math.round(sample.left * 100);
  els.cropRight.value = Math.round(sample.right * 100);

  els.modalCrop.classList.remove('hidden');
}

async function applyCropToTargets(topPct, bottomPct, leftPct, rightPct) {
  const targets = getTargetPages();
  if (targets.length === 0) return;

  if (topPct + bottomPct >= 90 || leftPct + rightPct >= 90) {
    showToast('Combined opposite crop margins must be less than 90%.', 'error');
    return;
  }

  for (const page of targets) {
    page.crop = {
      top: topPct / 100,
      bottom: bottomPct / 100,
      left: leftPct / 100,
      right: rightPct / 100,
    };
  }

  els.modalCrop.classList.add('hidden');
  await renderSidebarThumbnails();
  await renderMainPreview();
  showToast(`Applied crop to ${targets.length} ${targets.length === 1 ? 'page' : 'pages'}.`, 'success');
}

function attachDragEvents(cardElement, pageId) {
  cardElement.addEventListener('dragstart', (e) => {
    state.draggedPageId = pageId;
    cardElement.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pageId);
  });

  cardElement.addEventListener('dragend', () => {
    state.draggedPageId = null;
    cardElement.classList.remove('dragging');
    document.querySelectorAll('.thumbnail-item').forEach((el) => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  });

  cardElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.draggedPageId || state.draggedPageId === pageId) return;

    const rect = cardElement.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    cardElement.classList.remove('drag-over-top', 'drag-over-bottom');
    if (e.clientY < midpoint) {
      cardElement.classList.add('drag-over-top');
    } else {
      cardElement.classList.add('drag-over-bottom');
    }
  });

  cardElement.addEventListener('dragleave', () => {
    cardElement.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  cardElement.addEventListener('drop', async (e) => {
    e.preventDefault();
    const isTop = cardElement.classList.contains('drag-over-top');
    cardElement.classList.remove('drag-over-top', 'drag-over-bottom');

    const draggedId = state.draggedPageId;
    if (!draggedId || draggedId === pageId) return;

    const fromIndex = state.pages.findIndex((p) => p.id === draggedId);
    let toIndex = state.pages.findIndex((p) => p.id === pageId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [movedPage] = state.pages.splice(fromIndex, 1);
    toIndex = state.pages.findIndex((p) => p.id === pageId);
    const insertIndex = isTop ? toIndex : toIndex + 1;

    state.pages.splice(insertIndex, 0, movedPage);

    await renderSidebarThumbnails();
    await renderMainPreview();
  });
}

async function handleSavePdf() {
  if (state.pages.length === 0) return;

  setLoading(true, 'Building and exporting arranged PDF...');
  try {
    const pdfBytes = await buildPdfFromPages(state.sourceFiles, state.pages);
    const baseName = getBaseDocumentName();
    const fileName = state.sourceFiles.size > 1 ? `${baseName}_merged.pdf` : `${baseName}_edited.pdf`;

    triggerBinaryDownload(pdfBytes, fileName);
    showToast(`Exported "${fileName}" successfully.`, 'success');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function initEventListeners() {
  els.btnUpload.addEventListener('click', () => els.inputUpload.click());
  els.btnEmptyUpload.addEventListener('click', () => els.inputUpload.click());
  els.inputUpload.addEventListener('change', (e) => ingestFiles(e.target.files, { replaceExisting: true }));

  els.btnMerge.addEventListener('click', () => els.inputMerge.click());
  els.inputMerge.addEventListener('change', (e) => ingestFiles(e.target.files, { replaceExisting: false }));

  els.btnReorder.addEventListener('click', () => {
    els.sidebar.classList.add('reorder-pulse');
    showToast('Drag and drop page thumbnails in the left sidebar to rearrange pages.', 'info');
    setTimeout(() => els.sidebar.classList.remove('reorder-pulse'), 1800);
  });

  els.btnClear.addEventListener('click', () => {
    clearWorkspaceState();
    showToast('Workspace cleared.', 'info');
  });

  els.btnSave.addEventListener('click', handleSavePdf);

  els.btnSelectAll.addEventListener('click', async () => {
    const allSelected = state.pages.length > 0 && state.pages.every((p) => p.selected);
    const nextState = !allSelected;
    state.pages.forEach((p) => (p.selected = nextState));
    await renderSidebarThumbnails();
    updateToolbarState();
  });

  els.btnRotateRight.addEventListener('click', () => rotateTargetPages(90));
  els.btnRotate180.addEventListener('click', () => rotateTargetPages(180));
  els.btnRotateLeft.addEventListener('click', () => rotateTargetPages(270));
  els.btnDuplicate.addEventListener('click', duplicateTargetPages);
  els.btnDelete.addEventListener('click', deleteTargetPages);
  els.btnExtract.addEventListener('click', extractTargetPages);
  els.btnSplit.addEventListener('click', openSplitModal);
  els.btnInsertBlank.addEventListener('click', openBlankPageModal);
  els.btnCrop.addEventListener('click', openCropModal);

  document.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      els.splitRangesBox.classList.toggle('hidden', e.target.value !== 'ranges');
    });
  });
  els.btnConfirmSplit.addEventListener('click', handleConfirmSplit);

  els.btnConfirmBlank.addEventListener('click', handleConfirmBlankPage);

  els.btnConfirmCrop.addEventListener('click', () => {
    const t = Math.max(0, Math.min(45, Number(els.cropTop.value) || 0));
    const b = Math.max(0, Math.min(45, Number(els.cropBottom.value) || 0));
    const l = Math.max(0, Math.min(45, Number(els.cropLeft.value) || 0));
    const r = Math.max(0, Math.min(45, Number(els.cropRight.value) || 0));
    applyCropToTargets(t, b, l, r);
  });

  els.btnResetCrop.addEventListener('click', () => {
    applyCropToTargets(0, 0, 0, 0);
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      document.getElementById(modalId)?.classList.add('hidden');
    });
  });

  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag-active');
  });

  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('drag-active');
  });

  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('drag-active');
    if (e.dataTransfer?.files?.length) {
      ingestFiles(e.dataTransfer.files, { replaceExisting: true });
    }
  });

  window.addEventListener('keydown', (e) => {
    if (state.pages.length === 0) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    const currentIdx = state.pages.findIndex((p) => p.id === state.activePageId);
    if (currentIdx === -1) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (currentIdx < state.pages.length - 1) {
        state.activePageId = state.pages[currentIdx + 1].id;
        updateActiveThumbnailHighlight();
        renderMainPreview();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (currentIdx > 0) {
        state.activePageId = state.pages[currentIdx - 1].id;
        updateActiveThumbnailHighlight();
        renderMainPreview();
      }
    }
  });
}

initEventListeners();
updateToolbarState();
