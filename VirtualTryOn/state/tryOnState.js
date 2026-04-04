/**
 * @typedef {Object} ClothingItem
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} categoryLabel
 * @property {string} color
 * @property {string} garmentImageUrl
 * @property {{x:number,y:number,w:number,h:number}} overlayPlacement
 */

/**
 * @typedef {Object} TryOnState
 * @property {HTMLImageElement|null} photo
 * @property {ClothingItem|null} selectedItem
 * @property {'idle'|'uploading'|'generating'|'ready'} status
 * @property {string|null} error
 */

/**
 * Создаёт изолированное хранилище состояния для VirtualTryOn.
 * Важно: рендеринг вынесен наружу, а состояние лишь триггерит callback.
 */
export function createTryOnState({ onChange } = {}) {
  /** @type {TryOnState} */
  const s = {
    photo: null,
    selectedItem: null,
    status: 'idle',
    error: null,
  };

  function notify() {
    if (typeof onChange !== 'function') return;
    // Avoid blocking UI; caller can debounce if needed.
    void onChange();
  }

  return {
    /**
     * @returns {HTMLImageElement|null}
     */
    getPhoto() {
      return s.photo;
    },

    /**
     * @param {HTMLImageElement|null} photo
     */
    setPhoto(photo) {
      s.photo = photo;
      s.error = null;
      notify();
    },

    /**
     * @returns {ClothingItem|null}
     */
    getSelectedItem() {
      return s.selectedItem;
    },

    /**
     * @param {ClothingItem|null} item
     */
    setSelectedItem(item) {
      s.selectedItem = item;
      s.error = null;
      notify();
    },

    /**
     * @param {'idle'|'uploading'|'generating'|'ready'} status
     */
    setStatus(status) {
      s.status = status;
    },

    /**
     * @param {string|null} message
     */
    setError(message) {
      s.error = message;
    },

    /**
     * @returns {TryOnState}
     */
    snapshot() {
      return { ...s };
    },
  };
}

