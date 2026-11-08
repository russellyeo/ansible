// ---- health-ingest "Retry guard" node ----
// The branch moved (Russell pushed, or the other automation committed first).
// Go round again from "Get ref", at most 5 times in all.
if ($runIndex >= 4) throw new Error('GitHub branch kept moving; gave up after 5 tries');
return $input.all();
