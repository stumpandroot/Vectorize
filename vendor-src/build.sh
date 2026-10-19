#!/bin/sh
# Rebuilds the vendored browser bundles in ui-src/vendor from pinned npm packages.
# fontkit (MIT) and its dependencies; tesseract.js (Apache-2.0) is copied as shipped.
set -e
cd "$(dirname "$0")"
npm ci
echo 'import * as fontkit from "fontkit"; window.fontkit = fontkit;' > fk.js
npx esbuild fk.js --bundle --minify --format=iife --platform=browser --outfile=../ui-src/vendor/fontkit.min.js
rm fk.js
