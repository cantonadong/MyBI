import { useSyncExternalStore } from 'react';
import english from './locales/en.json';

export type Language = 'auto' | 'zh-CN' | 'en';
const key = 'data-workbench.language';
const chartKey = 'data-workbench.chart-language';
function readLanguage(storageKey = key): Language {
  try { const value = localStorage.getItem(storageKey); return value === 'zh-CN' || value === 'en' ? value : 'auto'; }
  catch { return 'auto'; }
}
let language = readLanguage();
let chartLanguage = readLanguage(chartKey);
const listeners = new Set<() => void>();
export function getLocale(): 'zh-CN' | 'en' {
  if (language !== 'auto') return language;
  const preferred = (navigator.languages || [navigator.language]).find(value => /^(zh|en)(-|$)/i.test(value)) || navigator.language;
  return /^zh(-|$)/i.test(preferred) ? 'zh-CN' : 'en';
}
export function getChartLocale(): 'zh-CN' | 'en' {
  return chartLanguage === 'auto' ? getLocale() : chartLanguage;
}
function notify() {
  document.documentElement.lang = getLocale();
  listeners.forEach(listener => listener());
}
export function setLanguage(value: Language) {
  localStorage.setItem(key, value); language = value; notify();
}
export function setChartLanguage(value: Language) {
  localStorage.setItem(chartKey, value); chartLanguage = value; notify();
}
window.addEventListener('languagechange', notify);
window.addEventListener('storage', event => {
  if (event.key === key || event.key === chartKey || event.key === null) {
    language = readLanguage(); chartLanguage = readLanguage(chartKey); notify();
  }
});
document.documentElement.lang = getLocale();
export function useLanguage() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => language + ':' + getLocale());
  return { language, locale: getLocale() };
}
export function useChartLanguage() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => chartLanguage + ':' + getChartLocale());
  return { chartLanguage, locale: getChartLocale() };
}
export function t(text: string, ...values: unknown[]): string {
  return translate(getLocale(), text, values);
}
export function chartT(text: string, ...values: unknown[]): string {
  return translate(getChartLocale(), text, values);
}
export function translate(locale: string, text: string, values: unknown[] = []): string {
  const translated = locale === 'en' ? (english as Record<string, string>)[text] ?? text : text;
  return translated.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''));
}
