# Chart dimensions and data labels

Bar, line, area and mixed charts support an ordered list of text/date X-axis dimensions. Each distinct tuple is aggregated independently and displayed as a combined category, such as `2026-10-13 / pre_activity`. The properties sidebar provides compact add, remove, move-up and move-down actions. Existing single-dimension charts retain their behavior. Legend grouping remains independent.

Data label density supports automatic, all, skip one, skip two and skip three. Skipping is based on category position and applies consistently across series. Automatic retains the existing density calculation.

Data label units support automatic, original, K, M and B. Original retains field formatting. K/M/B divide display values by 1,000/1,000,000/1,000,000,000; automatic chooses a unit based on magnitude. Percent labels retain percentage formatting. Tooltip values and axis values are unchanged. Source values and calculation precision are preserved.

Settings persist with the chart. Controls reuse existing styles and shared Chinese/English localization. No dependencies or tests are added or run; build the frontend and restart the local server for user verification.
