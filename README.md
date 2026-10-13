# Vectorize for Mac

Vectorize turns PNG and JPEG logos into clean SVG, PDF, and EPS files. This repository builds the Mac app and the web preview from one interface.

## What's here

| Path | What it is |
| --- | --- |
| `ui-src/` | The interface: tracing engine (`fit.js`, `app.js`), editor (`editor.js`), and page (`template.html`) |
| `ui/index.html` | The built interface that ships inside the app. Rebuild it after changing `ui-src/`. |
| `app/` | The Mac side: the window and menus (`main.py`), what the interface can ask the Mac to do (`bridge.py`), Apple Vision cutout and fonts (`native.py`), PDF and EPS writing (`vector_export.py`), and the GreenLaunch license check |
| `packaging/` | The app recipe (`Vectorize.spec`), icon, signing settings, and the sign-and-DMG script |
| `.github/workflows/build.yml` | Builds, tests, signs, and notarizes the app on GitHub's Macs |
| `tests/` | Python tests, plus interface tests that run in a headless browser |

The interface detects the Mac app at run time. In the app it adds AI background cutout, PDF and EPS export, native save dialogs, the full list of installed fonts, opening Versa directly, and the license check. In a browser it runs as the web preview.

## Run it from source

You need a Mac with Python 3.12.

1. Install the requirements:

   ```
   pip3 install -r requirements.txt
   ```

2. Build the interface:

   ```
   python3 ui-src/build.py
   ```

3. Start the app:

   ```
   python3 -m app.main
   ```

## Build the app on GitHub

Every push to `main` builds two DMGs, named with the version and build number (see CHANGELOG.md): one for Apple silicon Macs and one for Intel Macs. Find them on the **Actions** tab: open the latest run and scroll to **Artifacts**.

Until you add the signing secrets below, the DMGs are unsigned. They're fine for testing on your own Mac, but don't sell them. To open an unsigned copy, drag it to Applications and open it once. When macOS blocks it, go to **System Settings > Privacy & Security**, scroll down, and click **Open Anyway** next to the Vectorize message.

### Set up signing (once)

You need the Account Holder role on your Apple Developer account for step 1.

1. **Make a Developer ID Application certificate.** In Xcode, choose **Xcode > Settings > Accounts**, select your Apple ID, click **Manage Certificates**, click **+**, and choose **Developer ID Application**.
2. **Export it.** Open **Keychain Access**, find **Developer ID Application: *your name* (*team ID*)** under **My Certificates**, right-click it, and choose **Export**. Save it as `Certificates.p12` and set a password.
3. **Copy it as text.** In Terminal, run:

   ```
   base64 -i ~/Desktop/Certificates.p12 | pbcopy
   ```

   Change the path if you saved it somewhere else. The text is now on your clipboard.
4. **Make an app-specific password** for notarizing. Sign in at [account.apple.com](https://account.apple.com), go to **Sign-In and Security > App-Specific Passwords**, and create one named "Vectorize notarizing".
5. **Find your team ID** at [developer.apple.com/account](https://developer.apple.com/account) under **Membership details**. It's 10 letters and numbers.
6. **Add six secrets to GitHub.** In this repository, go to **Settings > Secrets and variables > Actions** and click **New repository secret** for each:

   | Name | Value |
   | --- | --- |
   | `MACOS_CERTIFICATE` | The text from step 3 |
   | `MACOS_CERTIFICATE_PWD` | The password from step 2 |
   | `MACOS_SIGN_IDENTITY` | `Developer ID Application: Your Name (TEAMID)`, exactly as Keychain Access shows it |
   | `APPLE_ID` | The email address of your Apple developer account |
   | `APPLE_APP_PASSWORD` | The app-specific password from step 4 |
   | `APPLE_TEAM_ID` | The team ID from step 5 |

7. Delete `Certificates.p12` from your Desktop.

The next build signs the app, notarizes the DMG with Apple, and staples the approval to it, so it opens without warnings on any Mac.

### Release a version

1. On the **Actions** tab, click **Build Vectorize** in the list on the left.
2. Click **Run workflow**, type the version, such as `1.0.0`, and click the green **Run workflow** button.
3. When the run finishes (about 20 minutes), go to **Releases**. A draft named **Vectorize 1.0.0** has both DMGs attached.
4. Download each DMG and open it on a Mac to check it, then click **Edit** on the draft and **Publish release**.

The version you type becomes the version inside the app and the `v1.0.0` tag on GitHub. Use the DMG links from the published release as the download links in the license service.

## Turn on licensing

Licensing stays off until the GreenLaunch license service is running. To turn it on:

1. Open `app/greenlaunch_license.py`.
2. Replace `REPLACE_WITH_PUBLIC_KEY` with the public key from the license service setup.
3. If your license server address isn't `https://license.greenlaunch.co`, change `LICENSE_SERVER` too.
4. Commit and push.

With licensing on, anyone can open, convert, and edit images. Exporting, separations, and Send to Versa ask for a license key first. The **Buy a license** button opens `https://greenlaunch.co`; change `BUY_URL` at the top of `ui-src/editor.js` if the store lives elsewhere.

## Test

- Python tests: `python3 -m unittest discover -s tests`
- Interface tests (need `pip install playwright` and `python3 -m playwright install chromium`):

  ```
  python3 tests/ui/test_editor.py
  python3 tests/ui/test_native.py
  ```

- A built app checks itself: `dist/Vectorize.app/Contents/MacOS/Vectorize --self-test` checks the bundled parts, and `--smoke-test` opens the window, converts the sample logo, and closes.

GitHub runs all of these on every build.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| ⌘O | Open images (choose several to batch them) |
| ⌘E / ⇧⌘E | Export / export the selection |
| ⌘Z | Undo |
| ⌘A, Esc | Select all parts, deselect |
| Delete | Delete the selected parts |
| V, H | Select tool, hand tool (hold Space to pan with either) |
| ⌘=, ⌘−, ⌘1, ⌘0 | Zoom in, zoom out, actual size, zoom to fit |
| Pinch or ⌘-scroll | Zoom where the pointer is |
