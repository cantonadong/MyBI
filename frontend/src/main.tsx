import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { t } from './i18n';

// crypto.randomUUID only exists on https/localhost; servers opened over plain http (e.g. http://192.168.x.x:8000) need this fallback.
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16)) as ReturnType<Crypto['randomUUID']>;
}

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (!['y', 'n', 'enter'].includes(key)) return;
  const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].pop();
  if (!dialog) return;
  const actions = [...dialog.querySelectorAll<HTMLElement>('.modal-actions')].pop();
  const buttons = [...(actions?.querySelectorAll<HTMLButtonElement>('button') || [])];
  const cancel = buttons.find(button => button.textContent?.trim() === t('取消'));
  const confirm = buttons.find(button => button.classList.contains('primary'));
  if (!cancel || !confirm) return;
  const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]');
  if (editing && (key !== 'enter' || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const button = key === 'n' ? cancel : confirm;
  if (!button.disabled) button.click();
});

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
