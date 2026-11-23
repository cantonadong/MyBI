import { describe, expect, it } from "vitest";
import { chartRegistry, formatValue, validateChartConfig } from "./registry";

describe("chart registry", () => {
  it("contains the complete V1 catalog", () => {
    expect(chartRegistry.map((chart) => chart.id)).toEqual([
      "kpi", "table", "bar", "line", "area", "mixed", "pie", "scatter", "radar",
      "funnel", "gauge", "waterfall", "heatmap", "histogram", "boxplot", "tree",
      "treemap", "sunburst", "sankey", "map",
    ]);
  });

  it("rejects a chart without a measure", () => {
    expect(validateChartConfig({ type: "bar", dimension: "region", measure: "" })).toContain("measure is required");
  });

  it("formats ratios without mutating them", () => {
    const value = 0.1234;
    expect(formatValue(value, "percent")).toBe("12.34%");
    expect(value).toBe(0.1234);
  });
});
