/* Event bus — jedini kanal razmjene između tab modula */
window.QNC = window.QNC || {};

(function (QNC) {
  const listeners = new Map();

  QNC.bus = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      set.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error('[bus]', event, e);
        }
      });
    },
  };

  /** Događaji:
   *  project:opened { projectId } — shell učita workspace iz baze i prebaci workflow tab
   *  project:changed { projectId } — aktivni projekt promijenjen; plugin tabovi čitaju svoj API iz SQLite
   */
})(window.QNC);
