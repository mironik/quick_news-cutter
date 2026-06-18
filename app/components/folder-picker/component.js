/* folder-picker — system core service: tamni native odabir mape/datotek preko hosta. */
window.QNC = window.QNC || {};

(function (QNC) {
  const PANEL_ID = 'folder-picker';
  const PICK_DIR = '/api/shell/pick-directory';
  const PICK_FILES = '/api/shell/pick-files';

  function isCancelled(err) {
    return String(err?.message || err || '').includes('cancelled');
  }

  async function pickDirectory(options) {
    const initial = String(options?.initial_dir || options?.initialDir || '').trim();
    const data = await QNC.api('POST', PICK_DIR, { initial_dir: initial });
    const path = String(data?.path || '').trim();
    if (!path) throw new Error('empty path');
    return path;
  }

  async function pickDirectoryOrCancel(options) {
    try {
      return await pickDirectory(options);
    } catch (err) {
      if (isCancelled(err)) return null;
      throw err;
    }
  }

  async function pickMediaFiles(options) {
    const initial = String(options?.initial_dir || options?.initialDir || '').trim();
    const data = await QNC.api('POST', PICK_FILES, { initial_dir: initial });
    const paths = Array.isArray(data?.paths) ? data.paths : [];
    return paths.map((p) => String(p || '').trim()).filter(Boolean);
  }

  async function pickMediaFilesOrCancel(options) {
    try {
      return await pickMediaFiles(options);
    } catch (err) {
      if (isCancelled(err)) return null;
      throw err;
    }
  }

  const api = {
    PANEL_ID,
    pickDirectory,
    pickDirectoryOrCancel,
    pickMediaFiles,
    pickMediaFilesOrCancel,
    isCancelled,
  };

  QNC.components = QNC.components || { register: function () {} };
  if (QNC.components.register) {
    QNC.components.register(PANEL_ID, api);
  }
  QNC.folderPicker = api;
})(window.QNC);
