# Field roles and vertical data settings

Dimensions offer only string/date; primary and secondary measures offer only number/integer, including numeric chart defaults and legend candidates. Server validates the same roles before querying.
New import and field-edit options: text, date, numeric integer, numeric decimal. Shared first-row inference covers delimited and Excel input; boolean becomes text and timestamp input becomes date. Integer conversion rejects fractions, preserving data until the user chooses decimal or text.
All field settings appear vertically, separate from the preview. Preview requests and displays the first five columns and ten rows; all fields remain editable. Save/cancel/X/Esc and backend batch conversion remain unchanged.
Five columns follows the literal user request; the row-versus-column clarification was offered asynchronously, without a response during implementation.
After checks, forcibly stop identified project backend processes so the next bat launch loads current code.
