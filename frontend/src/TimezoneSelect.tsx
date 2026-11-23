import { useMemo } from 'react';
import { SearchSelect } from './SearchSelect';
import { t, translate, useLanguage } from './i18n';

const cities: Record<string, string> = {
  'Asia/Shanghai': '北京、上海', 'Asia/Hong_Kong': '香港', 'Asia/Taipei': '台北',
  'Asia/Tokyo': '东京', 'Asia/Seoul': '首尔', 'Asia/Singapore': '新加坡',
  'Asia/Kolkata': '新德里、孟买', 'Asia/Calcutta': '新德里、孟买', 'Asia/Dubai': '迪拜',
  'Pacific/Auckland': '奥克兰、惠灵顿', 'Australia/Sydney': '悉尼、墨尔本',
  'Australia/Perth': '珀斯', 'Europe/London': '伦敦', 'Europe/Paris': '巴黎',
  'Europe/Berlin': '柏林', 'America/New_York': '纽约、华盛顿',
  'America/Chicago': '芝加哥、达拉斯', 'America/Denver': '丹佛',
  'America/Los_Angeles': '洛杉矶、旧金山', 'America/Toronto': '多伦多、渥太华',
  'America/Vancouver': '温哥华', 'Pacific/Honolulu': '檀香山',
};

export function TimezoneSelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { locale } = useLanguage();
  const options = useMemo(() => {
    const zones = new Set(['UTC', ...Intl.supportedValuesOf('timeZone'), value].filter(Boolean));
    const now = new Date();
    return [...zones].map(zone => {
      let offset = 'GMT';
      try { offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || 'GMT'; }
      catch { return { value: zone, label: zone, search: zone, minutes: 0 }; }
      const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
      const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
      const utc = match ? offset.replace('GMT', 'UTC') : 'UTC+00:00';
      const city = cities[zone] ? translate('en', cities[zone]) : zone.split('/').slice(1).join(' / ').replaceAll('_', ' ') || translate('en', '协调世界时');
      const shortOffset = match ? `UTC${match[1]}${Number(match[2])}${Number(match[3]) ? ':' + match[3] : ''}` : 'UTC+0';
      return { value: zone, label: `${utc} · ${city}`, search: `${zone} ${offset} ${utc} ${shortOffset} ${city} ${cities[zone] || ''} ${translate('en', cities[zone] || '')}`, minutes };
    }).sort((a, b) => a.minutes - b.minutes || a.label.localeCompare(b.label, locale));
  }, [value, locale]);
  return <label className="timezone-select">{t('时区')}<SearchSelect value={value} options={options} onChange={onChange} disabled={disabled} label={t('时区')} placeholder={t('搜索城市或 UTC 时差')} /></label>;
}
