/* Landing page script */

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('request-form-el');
  const successEl = document.getElementById('form-success');

  if (form && successEl) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // Скрываем поля формы и кнопку, показываем сообщение об успехе
      form.querySelectorAll('input, textarea, button').forEach(function (el) {
        el.style.display = 'none';
      });
      successEl.hidden = false;
      successEl.style.display = 'block';

      // Здесь можно добавить отправку на сервер
      // fetch('/api/request', { method: 'POST', body: new FormData(form) });
    });
  }
});
