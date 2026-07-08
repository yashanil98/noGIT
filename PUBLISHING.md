# Publishing noGIT to the VS Code Marketplace

A complete, self-contained walkthrough. Everything here is free. You do NOT need
an Azure subscription, the Azure free trial, or a credit card. Total time is
about 15 minutes, most of it one-time account setup you never repeat.

The two names that cause confusion:
- Azure portal (portal.azure.com) is the paid cloud. You never touch it.
- Azure DevOps (dev.azure.com) is a separate free service. You only use it to
  generate one token. No billing, no trial, no card.

If any page asks for a credit card or pushes a "free trial", you are on the
wrong product. Close it and go to dev.azure.com.

---

## Prerequisites (already true on this machine)

- Node 20 is required (the packaging tool crashes on Node 18). This repo pins it
  via a local mise.toml, but the plain terminal may still default to Node 18, so
  every command below is prefixed with the Node 20 path. Verify:
  ```bash
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" node -v   # must print v20.x
  ```
- The code is committed and builds. The tests pass (114). The icon, README,
  CHANGELOG, and LICENSE are all in place.
- The publisher id in package.json is `yashanil98`. The account you create in
  Step 2 MUST use this exact id, or Step 4 will update package.json to match.

---

## Step 1 (optional but recommended): install the .vsix locally and test it

An already-built package is at `nogit-0.4.0.vsix` in this folder. Install it into
your own VS Code to confirm it works before it goes public:

1. Open VS Code.
2. Open the Extensions view (Cmd+Shift+X).
3. Click the `...` menu at the top of the Extensions panel.
4. Choose "Install from VSIX..." and pick `/Users/anilyash/noGIT/nogit-0.4.0.vsix`.
5. Reload when prompted. Open a folder, edit a file, wait for the interval or run
   the command "noGIT: Snapshot Now", then run "noGIT: Show Timeline".

To rebuild the .vsix after any code change:
```bash
cd /Users/anilyash/noGIT
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run package
```

Uninstall the test copy before or after publishing; the Marketplace version will
replace it.

---

## Step 2 (one-time): create the publisher

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with any Microsoft account (a personal outlook.com/hotmail account is
   fine; create one free if you do not have one).
3. If prompted, create a publisher. Set:
   - Publisher ID: `yashanil98`   <-- must match package.json exactly
   - Display name: anything you like (for example "Yash Anil")
4. That is it. No payment, no verification wait.

---

## Step 3 (one-time): create the Personal Access Token (PAT)

The token is how the command line proves it may publish under your publisher.

1. Go to https://dev.azure.com and sign in with the SAME Microsoft account.
   - A free organization is created for you automatically. Accept the defaults.
   - If it asks about billing or a trial, ignore/skip it. Publishing never needs
     a paid plan.
2. Click your avatar (top right) -> "Personal access tokens".
   (Direct link: https://dev.azure.com then User settings icon -> Personal access tokens.)
3. Click "New Token" and set:
   - Name: `vsce-publish` (anything)
   - Organization: **All accessible organizations**  <-- important, not a single org
   - Expiration: your choice (90 days or up to 1 year)
   - Scopes: click "Custom defined", then "Show all scopes" if needed, find
     **Marketplace** and check **Manage**. That single checkbox is enough.
4. Click "Create". COPY THE TOKEN NOW. It is shown only once. If you lose it,
   just make a new one.

Store it somewhere safe (a password manager). When it expires later, repeat this
step to make a fresh one; nothing else changes.

---

## Step 4 (one-time sanity check): does the publisher id match?

package.json currently has `"publisher": "yashanil98"`. If you created the
publisher with a DIFFERENT id in Step 2, either recreate it as `yashanil98`, or
change package.json:
```bash
cd /Users/anilyash/noGIT
# edit package.json "publisher" to your actual id, then rebuild:
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run build
```
If you used `yashanil98`, do nothing.

---

## Step 5: publish

From the repo root, paste the token into VSCE_PAT and publish. The token stays in
this shell only; do not commit it anywhere.

```bash
cd /Users/anilyash/noGIT
export VSCE_PAT=PASTE_YOUR_TOKEN_HERE
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 publish --no-dependencies
```

What happens:
- vsce logs in with the token, builds the bundle, packages, and uploads.
- On success it prints something like:
  `Published yashanil98.nogit v0.4.0`
- The listing goes live in a few minutes at:
  https://marketplace.visualstudio.com/items?itemName=yashanil98.nogit
- Anyone can then install it from the Extensions view by searching "noGIT", or:
  `code --install-extension yashanil98.nogit`

If you would rather not export the token, vsce will prompt for it interactively:
```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 login yashanil98
# paste token when asked, then:
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 publish --no-dependencies
```

---

## Publishing future updates

1. Make your changes and land them.
2. Bump the version (this also creates a git commit + tag if you want):
   ```bash
   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm version patch   # 0.4.0 -> 0.4.1
   # or: npm version minor  (0.4.0 -> 0.5.0) / npm version major (0.4.0 -> 1.0.0)
   ```
   Or edit the `"version"` in package.json by hand. Move a CHANGELOG entry out of
   [Unreleased] into a new version heading.
3. Publish again:
   ```bash
   export VSCE_PAT=PASTE_TOKEN
   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 publish --no-dependencies
   ```
   vsce refuses to publish a version that already exists, so always bump first.

Tip: `vsce publish patch` will bump the patch version AND publish in one step.

---

## Housekeeping notes

- There is a local-only git tag `v0.1.0` left over from early work, while the
  package is 0.4.0. It was never pushed and does not affect a manual publish. If
  you later add tag-triggered CI publishing, delete it first:
  `git tag -d v0.1.0`
- `.vsix` files are gitignored, so the built package never gets committed.
- The Marketplace derives the icon, README (shown as the extension's detail
  page), and CHANGELOG tab straight from the packaged files, which are already
  correct.

---

## Troubleshooting

- "ReferenceError: File is not defined" or a crash during package/publish:
  you are on Node 18. Re-run with the `PATH="/opt/homebrew/opt/node@20/bin:$PATH"`
  prefix so `node -v` reports v20.

- "401 Unauthorized" on publish: the token is wrong, expired, or was created
  without the Marketplace > Manage scope, or not for "All accessible
  organizations". Make a new PAT (Step 3) and try again.

- "The publisher 'yashanil98' does not exist" or a mismatch error: you either
  skipped Step 2 or created a publisher with a different id than package.json.
  See Step 4.

- "A public extension with this name already exists": the name/version is taken
  by an already-published build. Bump the version and republish.

- Want to verify what will ship before publishing:
  ```bash
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 ls
  ```
  It should list only: CHANGELOG.md, dist/extension.js, LICENSE, media/icon.png,
  package.json, README.md.
