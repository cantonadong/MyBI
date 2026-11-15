import { t } from './i18n';

export function confirmAction(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal report-confirmation';
    dialog.setAttribute('aria-label', t('确认'));
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const finish = (accepted: boolean) => { dialog.close(); dialog.remove(); resolve(accepted); };
    for (const accepted of [false, true]) {
      const button = document.createElement('button');
      button.textContent = t(accepted ? '确认' : '取消');
      if (accepted) button.className = 'primary';
      button.onclick = () => finish(accepted);
      actions.append(button);
    }
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.append(text, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}
