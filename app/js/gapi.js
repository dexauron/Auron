(() => {
  'use strict';

  // ─── SHEETS ────────────────────────────────────────────────────────────────

  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

  async function sheetsReq(url, opts = {}) {
    const token = await window.AUTH.getToken();
    const headers = Object.assign({ Authorization: `Bearer ${token}` }, opts.headers || {});
    const resp = await fetch(url, Object.assign({}, opts, { headers }));

    if (resp.status === 401) {
      window.AUTH.signOut();
      throw new Error('Session expired');
    }

    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        message = (body.error && body.error.message) ? body.error.message : message;
      } catch (_) {}
      if (resp.status === 403 && message.includes('disabled')) {
        message = 'Google Sheets API не включён. Включите его на console.cloud.google.com → APIs & Services → Enable APIs → Google Sheets API.';
      }
      throw new Error(message);
    }

    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  async function getMeta(ssId) {
    return sheetsReq(`${SHEETS_BASE}/${ssId}?fields=sheets(properties(sheetId,title))`);
  }

  async function batchGet(ssId, ranges) {
    const params = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const data = await sheetsReq(`${SHEETS_BASE}/${ssId}/values:batchGet?${params}`);
    return (data.valueRanges || []).map(vr => vr.values || []);
  }

  async function getRange(ssId, range) {
    const data = await sheetsReq(`${SHEETS_BASE}/${ssId}/values/${encodeURIComponent(range)}`);
    return data.values || [];
  }

  async function append(ssId, range, values) {
    const url = `${SHEETS_BASE}/${ssId}/values/${encodeURIComponent(range)}:append`
      + '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
    return sheetsReq(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
  }

  async function update(ssId, range, values) {
    const url = `${SHEETS_BASE}/${ssId}/values/${encodeURIComponent(range)}`
      + '?valueInputOption=USER_ENTERED';
    return sheetsReq(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
  }

  async function clear(ssId, range) {
    return sheetsReq(`${SHEETS_BASE}/${ssId}/values/${encodeURIComponent(range)}:clear`, {
      method: 'POST',
    });
  }

  async function batchUpdate(ssId, requests) {
    return sheetsReq(`${SHEETS_BASE}/${ssId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  }

  async function createSpreadsheet(title) {
    return sheetsReq(SHEETS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } }),
    });
  }

  async function addSheet(ssId, title) {
    return batchUpdate(ssId, [{
      addSheet: { properties: { title } },
    }]);
  }

  async function deleteRows(ssId, sheetId, startIndex, endIndex) {
    return batchUpdate(ssId, [{
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex,
          endIndex,
        },
      },
    }]);
  }

  async function updateCell(ssId, sheetId, rowIndex, colIndex, value) {
    return batchUpdate(ssId, [{
      updateCells: {
        rows: [{
          values: [{
            userEnteredValue: typeof value === 'number'
              ? { numberValue: value }
              : { stringValue: String(value) },
          }],
        }],
        fields: 'userEnteredValue',
        start: { sheetId, rowIndex, columnIndex: colIndex },
      },
    }]);
  }

  window.SHEETS = {
    getMeta,
    batchGet,
    getRange,
    append,
    update,
    clear,
    batchUpdate,
    create: createSpreadsheet,
    addSheet,
    deleteRows,
    updateCell,
  };

  // ─── DRIVE ─────────────────────────────────────────────────────────────────

  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

  async function driveReq(url, opts = {}) {
    const token = await window.AUTH.getToken();
    const headers = Object.assign({ Authorization: `Bearer ${token}` }, opts.headers || {});
    const resp = await fetch(url, Object.assign({}, opts, { headers }));

    if (resp.status === 401) {
      window.AUTH.signOut();
      throw new Error('Session expired');
    }

    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        message = (body.error && body.error.message) ? body.error.message : message;
      } catch (_) {}
      if (resp.status === 403 && message.includes('disabled')) {
        message = 'Google Drive API не включён. Включите его на console.cloud.google.com → APIs & Services → Enable APIs → Google Drive API.';
      }
      throw new Error(message);
    }

    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  function _driveQ(q) { return encodeURIComponent(q.replace(/'/g, "\\'")); }

  async function findByName(name) {
    const q = _driveQ(`name='${name}' and trashed=false`);
    const data = await driveReq(`${DRIVE_BASE}/files?q=${q}&fields=files(id,name,webViewLink)`);
    return data.files || [];
  }

  async function findFolderByName(name) {
    const q = _driveQ(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const data = await driveReq(`${DRIVE_BASE}/files?q=${q}&fields=files(id,name)`);
    return data.files || [];
  }

  async function createDriveSpreadsheet(title) {
    return driveReq(`${DRIVE_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
      }),
    });
  }

  async function createFolder(name) {
    return driveReq(`${DRIVE_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
  }

  async function uploadFile(name, mimeType, base64data, parentId) {
    const boundary = 'auron_boundary_' + Date.now();
    const meta = { name, mimeType };
    if (parentId) meta.parents = [parentId];
    const metadata = JSON.stringify(meta);
    const binaryStr = atob(base64data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const metaPart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
    ].join('\r\n');

    const filePart = [
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64data,
      `--${boundary}--`,
    ].join('\r\n');

    const body = metaPart + '\r\n' + filePart;

    return driveReq(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      }
    );
  }

  async function makePublic(fileId) {
    await driveReq(`${DRIVE_BASE}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  async function getOrCreateFolder(name) {
    const files = await findFolderByName(name);
    if (files.length > 0) return files[0].id;
    const folder = await createFolder(name);
    return folder.id;
  }

  async function trashFile(fileId) {
    return driveReq(`${DRIVE_BASE}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  window.DRIVE = {
    findByName,
    findFolderByName,
    createSpreadsheet: createDriveSpreadsheet,
    createFolder,
    uploadFile,
    makePublic,
    getOrCreateFolder,
    trashFile,
  };
})();
