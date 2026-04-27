/**
 * @param {string} genderValue
 * @returns {Array<{value:string,label:string}>}
 */
export function getAllCategories(genderValue = 'all') {
  const g = String(genderValue || 'all').toLowerCase();
  const teesLabel = g === 'male' ? 'Футболки' : 'Футболки и топы';
  return [
    { value: 'tees_tops', label: teesLabel },
    { value: 'shirts', label: 'Рубашки' },
    { value: 'pants', label: 'Штаны' },
    { value: 'skirts', label: 'Юбки' },
    { value: 'dresses', label: 'Платья' },
  ];
}

