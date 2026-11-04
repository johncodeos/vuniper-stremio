import { createHash } from 'node:crypto';

export const settingsScript = `
for (const button of document.querySelectorAll('[data-test-provider]')) {
  button.addEventListener('click', async () => {
    const form = button.form;
    const status = form.querySelector('[data-test-status]');
    const fields = new URLSearchParams(new FormData(form));
    fields.set('test', button.dataset.testProvider);
    button.disabled = true;
    status.textContent = 'Checking credentials…';
    try {
      const response = await fetch(location.pathname, { method: 'POST', body: fields });
      const result = await response.json();
      status.textContent = result.message;
    } catch {
      status.textContent = 'Could not check credentials. Try again shortly.';
    } finally {
      button.disabled = false;
    }
  });
}
`;

export const settingsScriptHash = createHash('sha256').update(settingsScript).digest('base64');
