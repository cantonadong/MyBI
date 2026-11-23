# Implementation

1. Extend chart configuration with ordered dimensions and data label density/unit settings. Reuse existing metric row controls for dimensions and localize new controls.
2. Send dimensions to view-query. Validate text/date dimensions and group by every requested X dimension plus independent legend dimensions.
3. Render tuple categories without merging distinct tuples that share display text. Preserve original values for formatting, sorting and tooltips. Apply density and unit formatting only to data labels.
4. Build the frontend and restart the existing local server. Do not run tests, per user instructions.
