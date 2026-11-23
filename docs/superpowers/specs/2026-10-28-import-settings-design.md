# Two-step import and aligned field settings

Import first selects a file or pasted source, then advances to a separate configuration screen with Back/Cancel/Confirm. Excel discovers sheets and loads the first sheet automatically; switching worksheets reloads the preview.
One shared table serves import and dataset editing: each field occupies one row with name, main type, numeric subtype, decimal count, and five transposed samples. All fields remain visible and editable.
Main types are text/date/numeric. Numeric cascades to integer/decimal/percent; decimal and percent offer exactly 0, 1, 2 digits. Backend inference uses each field's first original sample, preserving decimal notation and percent markers; percentage tokens become ratios, while explicit text preserves the source. Display settings persist with renamed fields and never round stored values.
Existing atomic batch conversion, explicit save/cancel, typed chart roles, and rejection of fractional integer conversions remain. No new dependencies.
