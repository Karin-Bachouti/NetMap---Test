'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'netmap_devices';
const FIELDS = ['deviceName', 'macAddress', 'ipAddress'];

// ── State ──────────────────────────────────────────────────────────────────────

let devices = [];
let selectedIds = new Set();
let internalClipboard = [];   // fallback when Clipboard API is unavailable
let activeEdit = null;        // { tr, td, field, id, original }
let ctxTargetId = null;       // row id for right-click context menu

// ── Utilities ──────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── Validation ─────────────────────────────────────────────────────────────────

const MAC_RE = /^([0-9A-Fa-f]{2}[:\-.]){5}([0-9A-Fa-f]{2})$/;
const IP_RE  = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function isValid(field, value) {
  if (!value) return true;
  if (field === 'macAddress') return MAC_RE.test(value);
  if (field === 'ipAddress')  return IP_RE.test(value);
  return true;
}

// ── Data persistence ───────────────────────────────────────────────────────────

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    devices = Array.isArray(stored) && stored.length ? stored : sampleData();
  } catch {
    devices = sampleData();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

function sampleData() {
  return [
    { id: uid(), deviceName: 'Gateway Router',  macAddress: '00:1A:2B:3C:4D:5E', ipAddress: '192.168.1.1'  },
    { id: uid(), deviceName: 'Core Switch',      macAddress: 'AA:BB:CC:DD:EE:FF', ipAddress: '192.168.1.2'  },
    { id: uid(), deviceName: 'Access Point',     macAddress: '11:22:33:44:55:66', ipAddress: '192.168.1.10' },
    { id: uid(), deviceName: 'NAS Storage',      macAddress: 'DE:AD:BE:EF:CA:FE', ipAddress: '192.168.1.20' },
  ];
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

function createDevice(afterId = null) {
  const device = { id: uid(), deviceName: '', macAddress: '', ipAddress: '' };
  if (afterId !== null) {
    const idx = devices.findIndex(d => d.id === afterId);
    devices.splice(idx + 1, 0, device);
  } else {
    devices.push(device);
  }
  save();
  return device;
}

function insertDevices(rows, afterId = null) {
  if (afterId !== null) {
    const idx = devices.findIndex(d => d.id === afterId);
    devices.splice(idx + 1, 0, ...rows);
  } else {
    devices.push(...rows);
  }
  save();
}

function updateDevice(id, field, value) {
  const d = devices.find(d => d.id === id);
  if (d) { d[field] = value; save(); }
}

function deleteDevice(id) {
  devices = devices.filter(d => d.id !== id);
  selectedIds.delete(id);
  save();
}

function deleteSelected() {
  const count = selectedIds.size;
  devices = devices.filter(d => !selectedIds.has(d.id));
  selectedIds.clear();
  save();
  return count;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';
  devices.forEach(d => tbody.appendChild(buildRow(d)));
  syncSelectAll();
  syncToolbar();
  syncStatus();
  syncEmpty();
}

function buildRow(device) {
  const tr = document.createElement('tr');
  tr.dataset.id = device.id;
  if (selectedIds.has(device.id)) tr.classList.add('selected');

  // — Checkbox cell
  const tdCk = document.createElement('td');
  tdCk.className = 'col-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = selectedIds.has(device.id);
  cb.addEventListener('change', () => toggleSelect(device.id, cb.checked));
  tdCk.addEventListener('click', e => e.stopPropagation());
  tdCk.appendChild(cb);
  tr.appendChild(tdCk);

  // — Data cells
  FIELDS.forEach(field => {
    const td = document.createElement('td');
    td.dataset.field = field;
    td.textContent = device[field];
    if (!isValid(field, device[field])) {
      td.classList.add('invalid');
      td.title = validationHint(field);
    }

    td.addEventListener('click', () => {
      if (activeEdit?.td === td) return;
      if (activeEdit) commitEdit();
      startEdit(tr, td, device, field);
    });

    tr.appendChild(td);
  });

  // — Copy MAC cell
  const tdCopyMac = document.createElement('td');
  tdCopyMac.className = 'col-copy';
  const btnCopyMac = document.createElement('button');
  btnCopyMac.className = 'btn-copy-field';
  btnCopyMac.textContent = 'Copy MAC';
  btnCopyMac.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(device.macAddress)
      .then(() => toast(`Copied: ${device.macAddress || '(empty)'}`))
      .catch(() => {});
  });
  tdCopyMac.addEventListener('click', e => e.stopPropagation());
  tdCopyMac.appendChild(btnCopyMac);
  tr.appendChild(tdCopyMac);

  // — Copy IP cell
  const tdCopyIp = document.createElement('td');
  tdCopyIp.className = 'col-copy';
  const btnCopyIp = document.createElement('button');
  btnCopyIp.className = 'btn-copy-field';
  btnCopyIp.textContent = 'Copy IP';
  btnCopyIp.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(device.ipAddress)
      .then(() => toast(`Copied: ${device.ipAddress || '(empty)'}`))
      .catch(() => {});
  });
  tdCopyIp.addEventListener('click', e => e.stopPropagation());
  tdCopyIp.appendChild(btnCopyIp);
  tr.appendChild(tdCopyIp);

  // — Actions cell
  const tdAct = document.createElement('td');
  tdAct.className = 'col-act';
  const btnDel = document.createElement('button');
  btnDel.className = 'btn-del-row';
  btnDel.title = 'Delete row';
  btnDel.textContent = '×';
  btnDel.addEventListener('click', e => {
    e.stopPropagation();
    if (activeEdit) commitEdit();
    deleteDevice(device.id);
    renderTable();
    toast('Device deleted');
  });
  tdAct.addEventListener('click', e => e.stopPropagation());
  tdAct.appendChild(btnDel);
  tr.appendChild(tdAct);

  // — Row click → select/deselect
  tr.addEventListener('click', () => {
    if (activeEdit) return;
    toggleSelect(device.id, !selectedIds.has(device.id));
  });

  // — Right-click → context menu
  tr.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (activeEdit) commitEdit();
    ctxTargetId = device.id;
    openCtxMenu(e.clientX, e.clientY);
  });

  return tr;
}

// ── Inline editing ─────────────────────────────────────────────────────────────

function startEdit(tr, td, device, field) {
  activeEdit = { tr, td, field, id: device.id, original: device[field] };

  td.setAttribute('contenteditable', 'true');
  td.focus();

  // Select all text
  const range = document.createRange();
  range.selectNodeContents(td);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  td.addEventListener('paste',   onEditPaste);
  td.addEventListener('keydown', onEditKeydown);
  td.addEventListener('blur',    onEditBlur);
}

function commitEdit(cancel = false) {
  if (!activeEdit) return;
  const { tr, td, field, id, original } = activeEdit;

  // Remove listeners first to prevent re-entry
  td.removeEventListener('paste',   onEditPaste);
  td.removeEventListener('keydown', onEditKeydown);
  td.removeEventListener('blur',    onEditBlur);
  activeEdit = null;

  const value = cancel ? original : td.textContent.trim();
  td.textContent = value;
  td.removeAttribute('contenteditable');

  if (!isValid(field, value)) {
    td.classList.add('invalid');
    td.title = validationHint(field);
  } else {
    td.classList.remove('invalid');
    td.title = '';
  }

  if (!cancel) updateDevice(id, field, value);
  syncStatus();
}

function onEditPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)
    .getData('text/plain')
    .replace(/[\r\n]+/g, ' ');
  document.execCommand('insertText', false, text);
}

function onEditKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    commitEdit(true);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const { tr, field } = activeEdit;
    commitEdit();
    navigateFrom(tr, field, 'down');
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const { tr, field } = activeEdit;
    commitEdit();
    navigateFrom(tr, field, e.shiftKey ? 'left' : 'right');
  }
}

function onEditBlur() {
  // Defer so Tab/Enter keydown handlers run first and clear activeEdit
  setTimeout(() => { if (activeEdit) commitEdit(); }, 0);
}

function navigateFrom(tr, field, dir) {
  const fi = FIELDS.indexOf(field);
  let nextTr = tr;
  let nfi = fi;

  if (dir === 'right') {
    if (fi < FIELDS.length - 1) { nfi = fi + 1; }
    else { nextTr = tr.nextElementSibling; nfi = 0; }
  } else if (dir === 'left') {
    if (fi > 0) { nfi = fi - 1; }
    else { nextTr = tr.previousElementSibling; nfi = FIELDS.length - 1; }
  } else if (dir === 'down') {
    nextTr = tr.nextElementSibling;
  } else if (dir === 'up') {
    nextTr = tr.previousElementSibling;
  }

  if (!nextTr) return;
  const nextTd = nextTr.querySelector(`[data-field="${FIELDS[nfi]}"]`);
  if (!nextTd) return;
  const id = nextTr.dataset.id;
  const device = devices.find(d => d.id === id);
  if (device) startEdit(nextTr, nextTd, device, FIELDS[nfi]);
}

function validationHint(field) {
  if (field === 'macAddress') return 'Expected format: AA:BB:CC:DD:EE:FF';
  if (field === 'ipAddress')  return 'Expected format: 192.168.1.1';
  return '';
}

// ── Selection ──────────────────────────────────────────────────────────────────

function toggleSelect(id, on) {
  on ? selectedIds.add(id) : selectedIds.delete(id);
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    tr.classList.toggle('selected', on);
    tr.querySelector('input[type="checkbox"]').checked = on;
  }
  syncToolbar();
  syncSelectAll();
  syncStatus();
}

function selectAll(on) {
  devices.forEach(d => on ? selectedIds.add(d.id) : selectedIds.delete(d.id));
  document.querySelectorAll('#table-body tr').forEach(tr => {
    tr.classList.toggle('selected', on);
    tr.querySelector('input[type="checkbox"]').checked = on;
  });
  syncToolbar();
  syncStatus();
}

function syncSelectAll() {
  const cb = document.getElementById('select-all');
  const n = selectedIds.size;
  if (n === 0)              { cb.checked = false; cb.indeterminate = false; }
  else if (n === devices.length) { cb.checked = true;  cb.indeterminate = false; }
  else                      { cb.checked = false; cb.indeterminate = true;  }
}

// ── Clipboard ──────────────────────────────────────────────────────────────────

function rowsToTSV(rows) {
  return rows.map(d => FIELDS.map(f => d[f]).join('\t')).join('\n');
}

function parseTSV(text) {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .trim().split('\n')
    .filter(line => line.trim())
    .map(line => {
      // support tab-separated or comma-separated (e.g. from Excel)
      const cells = line.includes('\t') ? line.split('\t') : line.split(',');
      return {
        id:         uid(),
        deviceName: (cells[0] ?? '').trim().replace(/^"|"$/g, ''),
        macAddress: (cells[1] ?? '').trim().replace(/^"|"$/g, ''),
        ipAddress:  (cells[2] ?? '').trim().replace(/^"|"$/g, ''),
      };
    });
}

function copyRows(ids = [...selectedIds]) {
  const rows = devices.filter(d => ids.includes(d.id));
  if (!rows.length) return;
  internalClipboard = rows.map(d => ({ ...d }));
  const tsv = rowsToTSV(rows);
  navigator.clipboard.writeText(tsv)
    .then(() => toast(`Copied ${rows.length} row${rows.length > 1 ? 's' : ''}`))
    .catch(() => toast('Copied to internal clipboard'));
}

function pasteRows(afterId = null) {
  navigator.clipboard.readText()
    .then(text => {
      const rows = parseTSV(text);
      if (!rows.length) return;
      insertDevices(rows, afterId);
      renderTable();
      toast(`Pasted ${rows.length} row${rows.length > 1 ? 's' : ''}`);
    })
    .catch(() => {
      // Clipboard API blocked — use internal clipboard
      if (!internalClipboard.length) { toast('Nothing to paste'); return; }
      const rows = internalClipboard.map(d => ({ ...d, id: uid() }));
      insertDevices(rows, afterId);
      renderTable();
      toast(`Pasted ${rows.length} row${rows.length > 1 ? 's' : ''}`);
    });
}

// ── Context menu ───────────────────────────────────────────────────────────────

function openCtxMenu(x, y) {
  const menu = document.getElementById('ctx-menu');
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth  || 170;
  const mh = menu.offsetHeight || 160;
  menu.style.left = Math.min(x, window.innerWidth  - mw - 8) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

function closeCtxMenu() {
  document.getElementById('ctx-menu').classList.add('hidden');
  ctxTargetId = null;
}

// ── Sync UI helpers ────────────────────────────────────────────────────────────

function syncToolbar() {
  const hasSel = selectedIds.size > 0;
  document.getElementById('btn-copy').disabled   = !hasSel;
  document.getElementById('btn-delete').disabled = !hasSel;
}

function syncStatus() {
  const n = devices.length;
  const s = selectedIds.size;
  document.getElementById('status-text').textContent =
    `${n} device${n !== 1 ? 's' : ''}${s ? `  ·  ${s} selected` : ''}`;
}

function syncEmpty() {
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('device-table');
  const isEmpty = devices.length === 0;
  empty.classList.toggle('hidden', !isEmpty);
  table.classList.toggle('hidden', isEmpty);
}

// ── Init & event wiring ────────────────────────────────────────────────────────

function addDeviceAndFocus(afterId = null) {
  if (activeEdit) commitEdit();
  const device = createDevice(afterId);
  renderTable();
  const tr = document.querySelector(`tr[data-id="${device.id}"]`);
  if (tr) {
    const td = tr.querySelector('[data-field="deviceName"]');
    startEdit(tr, td, device, 'deviceName');
  }
}

function init() {
  load();
  renderTable();

  // ── Toolbar
  document.getElementById('btn-add').addEventListener('click', () => addDeviceAndFocus());
  document.getElementById('btn-empty-add').addEventListener('click', () => addDeviceAndFocus());
  document.getElementById('btn-copy').addEventListener('click', () => copyRows());
  document.getElementById('btn-paste').addEventListener('click', () => pasteRows());
  document.getElementById('btn-delete').addEventListener('click', () => {
    if (activeEdit) commitEdit();
    const count = deleteSelected();
    renderTable();
    toast(`Deleted ${count} device${count !== 1 ? 's' : ''}`);
  });

  // ── Select-all checkbox
  document.getElementById('select-all').addEventListener('change', e => {
    selectAll(e.target.checked);
  });

  // ── Keyboard shortcuts (global)
  document.addEventListener('keydown', e => {
    if (activeEdit) return;

    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      selectAll(true);
    }
    if (e.ctrlKey && e.key === 'c') {
      if (selectedIds.size) copyRows();
    }
    if (e.ctrlKey && e.key === 'v') {
      pasteRows();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
      if (document.activeElement.tagName === 'INPUT') return;
      const count = deleteSelected();
      renderTable();
      toast(`Deleted ${count} device${count !== 1 ? 's' : ''}`);
    }
    if (e.key === 'Escape') {
      selectAll(false);
      syncSelectAll();
    }
  });

  // ── Context menu actions
  document.getElementById('ctx-menu').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = ctxTargetId;

    if (action === 'copy-row' && id) {
      copyRows([id]);
    }
    if (action === 'paste-after') {
      pasteRows(id);
    }
    if (action === 'insert-above' && id) {
      const idx = devices.findIndex(d => d.id === id);
      const device = { id: uid(), deviceName: '', macAddress: '', ipAddress: '' };
      devices.splice(idx, 0, device);
      save();
      renderTable();
      const tr = document.querySelector(`tr[data-id="${device.id}"]`);
      if (tr) {
        const td = tr.querySelector('[data-field="deviceName"]');
        startEdit(tr, td, device, 'deviceName');
      }
    }
    if (action === 'insert-below' && id) {
      addDeviceAndFocus(id);
    }
    if (action === 'delete-row' && id) {
      deleteDevice(id);
      renderTable();
      toast('Device deleted');
    }

    closeCtxMenu();
  });

  // ── Close context menu on outside click or Escape
  document.addEventListener('click', e => {
    if (!document.getElementById('ctx-menu').contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCtxMenu();
  });
}

document.addEventListener('DOMContentLoaded', init);
