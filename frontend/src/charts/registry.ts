import type { FieldFormats } from "../fieldDisplay";
import { getChartLocale as getLocale, t } from '../i18n';
export type ChartType = "candlestick" | "filter" | "kpi" | "table" | "bar" | "line" | "area" | "mixed" | "pie" | "scatter" | "radar" | "funnel" | "gauge" | "waterfall" | "heatmap" | "histogram" | "boxplot" | "tree" | "treemap" | "sunburst" | "sankey" | "map";
export type ChartConfig = { type: ChartType; annotationStyle?: "start" | "range"; axisLabelRotate?: boolean; legendPercent?: boolean; piePercent?: boolean; autoTitle?: boolean; metricAggregations?: Record<string, NonNullable<ChartConfig["aggregation"]>>; sortMeasure?: string; showAnnotations?: boolean; annotations?: import('../dashboard').Annotation[]; highlightWeekends?: boolean; locale?: 'zh-CN' | 'en'; title?: string; description?: string; filterStyle?: "date-range" | "date-last" | "dropdown" | "tiles" | "cascade"; filterAutoWidth?: boolean; filterSelection?: "single" | "multiple"; filterSort?: "none" | "asc" | "desc" | "custom"; filterOrderText?: string; filterFields?: string[]; filterValues?: Record<string, (string | number | boolean | null)[]>; filterRange?: [string, string]; filterRangeAuto?: boolean; filterLastCount?: number; filterLastUnit?: "day" | "week" | "month" | "quarter" | "year"; legendAuto?: boolean; fieldFormats?: FieldFormats; showUpdatedAt?: boolean; legendField?: string; dimension?: string; dimensions?: string[]; labelDensity?: 'auto' | 'all' | '1' | '2' | '3'; axisLabelDensity?: 'auto' | 'all' | '1' | '2' | '3'; labelUnit?: 'auto' | 'none' | 'k' | 'm' | 'b'; measure?: string; measures?: string[]; metricSeries?: { type: "bar" | "line"; axis: "left" | "right" }[]; mixedSeries?: Record<string, { type: "bar" | "line"; axis: "left" | "right" }>; axisSettings?: Partial<Record<"left" | "right", { min?: number; max?: number }>>; secondDimension?: string; secondMeasure?: string; expression?: string; aggregation?: "sum" | "avg" | "count" | "min" | "max" | "count_distinct"; format?: "number" | "percent" | "currency"; color?: string; palette?: string; colors?: string[]; stacked?: boolean; smooth?: boolean; labels?: boolean; axisHover?: boolean; legend?: boolean; horizontal?: boolean; donut?: boolean; sort?: string; xAxisSort?: "none" | "asc" | "desc" | "custom"; xAxisOrderText?: string; limit?: number; mapGeoJSON?: object };

const entries: [ChartType, string][] = [
  ["kpi", "指标卡"], ["table", "数据表"], ["bar", "柱状图"], ["line", "折线图"], ["area", "面积图"], ["mixed", "组合图"], ["candlestick", "蜡烛图"], ["pie", "饼图"], ["scatter", "散点图"], ["radar", "雷达图"], ["funnel", "漏斗图"], ["gauge", "仪表盘"], ["waterfall", "瀑布图"], ["heatmap", "热力图"], ["histogram", "直方图"], ["boxplot", "箱线图"], ["tree", "树图"], ["treemap", "矩形树图"], ["sunburst", "旭日图"], ["sankey", "桑基图"], ["map", "地图"],
];

export const chartRegistry = entries.map(([id, label]) => ({ id, get label() { return t(label); } }));

export function chartLegend(config: ChartConfig): boolean {
  if (config.legendAuto === false) return !!config.legend;
  return ['bar', 'line', 'area', 'mixed'].includes(config.type) && (config.measures || [config.measure, config.secondMeasure]).filter(Boolean).length > 1;
}

export function validateChartConfig(config: ChartConfig): string[] {
  if (config.type === "table") return [];
  const errors: string[] = [];
  if (!config.measure) errors.push("measure is required");
  if (!["kpi", "gauge"].includes(config.type) && !config.dimension) errors.push("dimension is required");
  return errors;
}

export function formatValue(value: number, format: ChartConfig["format"], locale = getLocale()): string {
  if (format === "percent") return `${(value * 100).toFixed(2)}%`;
  if (format === "currency") return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}
