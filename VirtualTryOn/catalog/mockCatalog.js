/**
 * Мок-каталог одежды для VirtualTryOn.
 * Данные намеренно структурированы так, чтобы в будущем можно было заменить на реальные API-данные и модели одежды.
 */

/**
 * @typedef {Object} ClothingItem
 * @property {string} id
 * @property {string} name
 * @property {'top'|'bottom'|'dress'|'outerwear'|'skirt'} category
 * @property {string} categoryLabel
 * @property {string} color
 * @property {string} garmentImageUrl
 * @property {{x:number,y:number,w:number,h:number}} overlayPlacement
 */

/**
 * @returns {Array<{value:string,label:string}>}
 */
export function getAllCategories() {
  return [
    { value: 'top', label: 'Верх' },
    { value: 'bottom', label: 'Низ' },
    { value: 'dress', label: 'Платье' },
    { value: 'outerwear', label: 'Верхняя одежда' },
    { value: 'skirt', label: 'Юбка' },
  ];
}

/**
 * @returns {ClothingItem[]}
 */
export function getMockCatalog() {
  /** Placement (x/y/w/h) в долях от canvas. */
  return [
    {
      id: 'black-jacket-01',
      name: 'Черная куртка',
      category: 'outerwear',
      categoryLabel: 'Куртка',
      color: '#111827',
      garmentImageUrl: 'https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/black_jacket.jpg',
      overlayPlacement: { x: 0.25, y: 0.15, w: 0.5, h: 0.48 },
    },
    {
      id: 'black-top-01',
      name: 'Черный топ',
      category: 'top',
      categoryLabel: 'Топ',
      color: '#111827',
      garmentImageUrl: 'https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/black_top.jpg',
      overlayPlacement: { x: 0.27, y: 0.2, w: 0.46, h: 0.38 },
    },
    {
      id: 'green-pullover-01',
      name: 'Зеленый пуловер',
      category: 'top',
      categoryLabel: 'Пуловер',
      color: '#166534',
      garmentImageUrl: 'https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/green_pullover.jpg',
      overlayPlacement: { x: 0.28, y: 0.22, w: 0.44, h: 0.36 },
    },
    {
      id: 'grey-pullover-01',
      name: 'Серый пуловер',
      category: 'top',
      categoryLabel: 'Пуловер',
      color: '#6b7280',
      garmentImageUrl: 'https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/grey_pullover.jpg',
      overlayPlacement: { x: 0.28, y: 0.22, w: 0.44, h: 0.36 },
    },
    {
      id: 'white-jacket-01',
      name: 'Белая куртка',
      category: 'outerwear',
      categoryLabel: 'Куртка',
      color: '#e5e7eb',
      garmentImageUrl: 'https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/white_jacket.jpg',
      overlayPlacement: { x: 0.25, y: 0.15, w: 0.5, h: 0.48 },
    },
  ];
}

