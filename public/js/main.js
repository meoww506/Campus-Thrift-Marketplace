document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"], button:not([type])');
      if (button && !button.dataset.noLoading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Please wait…';
        setTimeout(() => { button.disabled = false; button.textContent = button.dataset.originalText; }, 5000);
      }
    });
  });
});
