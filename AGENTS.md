# Agent conventions for this repo

- The product name Topoi stays capitalized; the word topic(s) stays lowercase in code, comments and UI strings.
- No em dashes anywhere.
- Markdown and comments use flowing lines, one sentence per line; never hard-wrap prose.
- One component per file; private components live beside the importer, pure helpers go to new `lib/` files.
- Install packages with exact versions: `pnpm --filter @topoi/mobile add -E <pkg>`.
- The app version lives in `package.json` alone. `ios/version.xcconfig` is generated from it by
  `pnpm sync:version`, which `pnpm build` runs; never edit that file and never set `MARKETING_VERSION`
  in the Xcode project, and `pnpm check:version` fails when the two disagree.
- The iOS build number is `CURRENT_PROJECT_VERSION` in the Xcode project, incremented by `pnpm ios:bump-build` (Xcode's own `agvtool`) once per upload, immediately before archiving; it moves both target configurations and fails when they disagree or did not advance. `pnpm build` must never touch it, or two archives of one web bundle would carry the same number and App Store Connect would reject the second. Read it back off the archived product (`PlistBuddy -c 'Print :CFBundleVersion'` on the .app inside the archive), never with `agvtool -all` (which freezes `Info.plist` to a literal), and leave the Version field in Xcode's General tab alone (it writes `MARKETING_VERSION` into the project and breaks the generated xcconfig).
- `vendor/hermes-agent/` is a pinned submodule and read-only. Never edit, install into, or run tooling inside it; all imports of its code go through `packages/core/src/index.ts`.
- Bumping the submodule SHA is a deliberate commit and `pnpm typecheck` must pass after it.
- hermes-agent is MIT (Copyright (c) 2025 Nous Research); keep the notice when copying files out.
- iOS bundle id is `com.atxoft.topoi`. The app reaches the gateway over https only (the Cloudflare tunnel), so no cleartext server configuration.
