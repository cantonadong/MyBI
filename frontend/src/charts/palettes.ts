import type { ChartConfig } from './registry';

export const chartPalettes = [
  { id: 'modern', label: '现代蓝紫', colors: ['#5969F4', '#18A999', '#F2A541', '#8B5CF6', '#E76F9A', '#45A3D9'] },
  { id: 'fresh', label: '清新青绿', colors: ['#169C80', '#4A90D9', '#E5B447', '#8D79C7', '#DC7A72', '#73B6A2'] },
  { id: 'coast', label: '海岸蓝橙', colors: ['#2878B5', '#F29D52', '#4DAF9D', '#9A7BC0', '#D76B78', '#84B6CE'] },
  { id: 'muted', label: '柔和莫兰迪', colors: ['#6F86A6', '#89A894', '#C2A878', '#A08BB0', '#C58E91', '#78A5AC'] },
  { id: 'bright', label: '明快糖果', colors: ['#7067E9', '#31B8AE', '#F2B544', '#EA7A9A', '#5CA8DE', '#A0BC58'] },
  { id: 'peach', label: '蜜桃乌龙', colors: ['#EF8C83', '#67B5A5', '#E9BA68', '#A58BD4', '#72AED0', '#D98EAF'] },
  { id: 'lavender', label: '薰衣草园', colors: ['#9A80DA', '#65B8AD', '#EDAA88', '#7EAFE0', '#D981AB', '#B6BC6C'] },
  { id: 'citrus', label: '青柠汽水', colors: ['#83B953', '#48B6BB', '#F0BA4E', '#8586D8', '#EB8E76', '#D681AB'] },
  { id: 'sunset', label: '落日微光', colors: ['#E88965', '#B781CE', '#E5B954', '#64ADA8', '#D5789D', '#7D9DD4'] },
  { id: 'breeze', label: '晴空微风', colors: ['#5AACE0', '#77BDA1', '#EAB468', '#A48ADA', '#E58FA8', '#65BFC5'] },
];

export const randomColors = [
  '#BB3030', '#2FD760', '#9C51D2', '#C5B126', '#3AB4CC', '#DC4797', '#53BB30', '#362FD7',
  '#D27C51', '#26C589', '#C03ACC', '#BDDC47', '#3075BB', '#D72F52', '#51D25C', '#6226C5',
  '#CC9C3A', '#47DCD6', '#BB3098', '#7CD72F', '#5166D2', '#C53A26', '#3ACC78', '#B147DC',
  '#BABB30', '#2FA6D7', '#D25186', '#39C526', '#533ACC', '#DC8C47', '#30BB98', '#D72FD0',
  '#A6D251', '#2661C5', '#CC3A46', '#47DC67', '#7630BB', '#D7B52F', '#51C7D2', '#C52688',
  '#6ACC3A', '#474CDC', '#BB5330', '#2FD78B', '#BD51D2', '#B0C526', '#3A8FCC', '#DC4771',
  '#30BB31', '#612FD7', '#D29D51', '#26C5B2', '#CC3AB3', '#97DC47', '#3052BB', '#D7372F',
  '#51D27D', '#8A26C5', '#CCC13A', '#47BCDC', '#BB3074', '#51D72F', '#5D51D2', '#C56326',
];

export function randomChartColors(componentId: string): string[] {
  let seed = 2166136261;
  for (const character of componentId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const colors = [...randomColors];
  for (let i = colors.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  return colors;
}

export function chartColors(config: ChartConfig): string[] {
  if (config.palette === 'random') return config.colors?.length === 64 ? config.colors : randomColors;
  if (config.palette === 'custom' && config.colors?.length) return config.colors;
  return chartPalettes.find(palette => palette.id === config.palette)?.colors || chartPalettes[0].colors;
}
