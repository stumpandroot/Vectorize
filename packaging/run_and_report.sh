#!/bin/bash
# Runs a command, prints its output, and repeats the last 40 lines as a notice
# (or an error when the command fails) so they show on the run's summary page.
# Usage: packaging/run_and_report.sh "Title" command [args...]
TITLE="$1"; shift
LOG="$(mktemp)"
"$@" > "$LOG" 2>&1
CODE=$?
cat "$LOG"
BODY="$(tail -n 40 "$LOG" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
if [ $CODE -eq 0 ]; then echo "::notice title=$TITLE::$BODY"; else echo "::error title=$TITLE (exit $CODE)::$BODY"; fi
exit $CODE
