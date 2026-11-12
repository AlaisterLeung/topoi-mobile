# Topoi for iOS

Talk to your agent from your phone. The threads you left open at your desk are still there in your pocket, filed under the topic you put them in, and a chat you started three weeks ago is one tap away instead of one long scroll.

Built with Capacitor around the same React chat stack used by Hermes Desktop.

## Installation

**TestFlight:** [install public beta build](https://testflight.apple.com/join/p1HbkhfU)

**App Store:** coming soon

## What you get

- **Topics, not a feed.** Every topic you define on the server shows up here in the order you arranged it, and a new chat files itself into your home topic.
- **A thread list with state.** Each thread carries a dot for working, waiting on you, unread or idle, so you can tell at a glance which one is actually holding things up.
- **A chat surface worth typing in.** Replies stream in, and code blocks and math render properly through Streamdown and KaTeX. A step with no text of its own, a tool call or an attachment-only turn, shows as a dim ellipsis instead of a row of chrome.
- **Model and reasoning pickers**, so a throwaway question can go to a cheap model without opening a laptop.
- **Attachments, outbound.** Photos and files go up from the composer, up to eight waiting on one send and roughly 8 MB each, because the bytes ride a single WebSocket frame. Files the agent sends back arrive as rows with a name and an icon. Tapping one to save it to the phone is the next increment, so there is no button pretending otherwise.
- **Cron results as threads.** A scheduled job delivers into a topic and the result reads like any other thread, with a composer underneath, so a one word reply continues that run.
- **Gestures that stay out of the way.** Pull down to refresh, swipe in from the left edge to go back, swipe in from the right edge for a new thread or a replyable job thread.

## How the pieces fit

This app is the client. It talks to the **Topoi gateway plugin** ([AlaisterLeung/topoi](https://github.com/AlaisterLeung/topoi)) running inside **Hermes Agent**, and that plugin owns the topic registry this app and Hermes Desktop both read. The plugin in turn declares its own floor of Hermes `0.23.0`, so a server older than that cannot serve this client.

```
Topoi iOS  ->  Topoi gateway plugin  ->  Hermes Agent
              (topic registry, threads, bindings)
```

The registry is not copied around. There is one, the gateway holds it, and a topic you move on the desktop is in the right place here on the next pull.

## Requirements

- macOS with Xcode, since the native project is checked in and builds against SwiftPM.
- Node and pnpm: `brew install node pnpm`. The lockfile is version 9.0 and `pnpm-workspace.yaml` leans on `patchedDependencies` and `minimumReleaseAgeExclude`, so take a current pnpm; 12.18.0 is what this app is built with.
- An Apple Developer account if you want the app on a physical device.
- A reachable Topoi server. Traffic is https only through a Cloudflare tunnel and the app ships no cleartext fallback, so a missing server reads as cannot reach rather than quietly downgrading.

## Build from source

The submodule matters, so clone it recursively. Skipping that flag leaves `vendor/hermes-agent` empty and the first typecheck fails on imports that look like they should exist.

```bash
git clone --recursive https://github.com/AlaisterLeung/topoi-mobile.git
cd topoi-mobile
pnpm install
pnpm build
```

`pnpm build` is four steps in one: it mirrors the version from `package.json` into `ios/version.xcconfig`, typechecks, builds the web half with Vite, then runs `cap sync` to push both into the native project.

Then open it in Xcode, or let the CLI pick a simulator for you:

```bash
npx cap open ios
npx cap run ios --list
npx cap run ios --target <udid>
```

## Live reload

Rebuilding for every CSS tweak is miserable, so the web half can load straight from the dev server while the native shell stays put.

```bash
pnpm dev
npx cap run ios --live-reload --host localhost --port 5173
```

`--host localhost` is not optional. Without it the CLI advertises the Mac's LAN address, and an http page on a LAN IP does not load here, while `127.0.0.1` answers instantly.

Two things to know before they confuse you. The origin changes under live reload, so the app comes up signed out and needs one native sign-in per mode. And `cap run` bakes the dev server URL into the installed app, so live reload and bundled builds are separate installs, not a toggle. Stop vite when you go back to a bundled build, or the app sits there pointing at nothing.

Keep this loop on the simulator. A physical device refuses plain http to an IP literal on iOS 17 and later without an ATS exception plus the local network prompt, and the simulator does not enforce that rule, so a green simulator run proves nothing about a phone.

## Project layout

| Path | What lives there |
| --- | --- |
| `ios/` | Native Xcode project, SwiftPM based |
| `src/App.tsx` | Navigation, screen state, gateway connection |
| `src/components/` | Topic list, thread list, chat, cron view, settings, sign-in |
| `src/lib/` | Framework free helpers, each with a `.test.ts` beside it |
| `packages/core/` | Shim that re-exports the gateway client from `vendor/` |
| `packages/auth-session/` | Native loopback OAuth and Keychain plugin |
| `vendor/hermes-agent/` | Pinned, read only submodule |
| `scripts/` | Version mirroring, build number, logo rendering |

The icon and the wordmark are generated, not drawn by hand, so `scripts/make-logo.swift` is the only source for the mark. `ios/App/App/PrivacyInfo.xcprivacy` has to stay in the app target's Resources phase, since the Privacy Preferences API declaration ships beside `Info.plist`.

The version lives in `package.json` and nowhere else. `pnpm build` copies it into `ios/version.xcconfig` as `MARKETING_VERSION`, and `pnpm version:check` fails when the two have drifted. The iOS build number is a separate axis that Xcode owns, and `pnpm bump:ios` is what moves it before an archive.

## Checks

```bash
pnpm typecheck    # tsc across the app and both workspace packages
pnpm test         # vitest, node by default, composer guards opt into jsdom
pnpm version:check
```

The tests cover what a simulator is bad at proving: the resume rebuild, the transcript and delta helpers, the screen cache's version and quota paths, the REST client's one refresh and retry, and PKCE sign-in against a mocked native module. Anything touching transport or rendering still needs a real run, because a stubbed socket proves nothing about a gateway.

`pnpm typecheck` is also the drift detector for the vendored client. Bump the submodule and it fails first, before anything else has a chance to.

## Signing and credentials

The gateway URL sits in Capacitor Preferences, which is `UserDefaults` on iOS, because it is not a secret and it should survive a webview storage eviction.

Tokens sit in the Keychain as one item, service `com.atxoft.topoi`, account `topoi.tokens`, accessible `AfterFirstUnlockThisDeviceOnly`. That keeps them readable while the app is backgrounded, out of iCloud, and out of a backup restored onto another phone. The plugin in `packages/auth-session` owns that item, so no third party library sits in the credential path.

## If it will not load

- **The app opens to a blank screen and typecheck screamed about the gateway client.** The submodule is empty. Re-clone with `--recursive`, or run `git submodule update --init`.
- **Signed out every time you relaunch under live reload.** Expected. The origin changed, `localStorage` is partitioned per origin, and live reload is a separate install from the bundled app.
- **Nothing renders after you stopped vite.** The installed app is still pointed at the dev server. `pnpm build && npx cap copy ios`, then run it again from Xcode.

## Contributing

Contributor rules, including the versioning and build number workflow and the language conventions for this codebase, live in [AGENTS.md](AGENTS.md). Read it before a first patch, especially if you are touching the submodule or the Xcode project.

## Security

Found something, especially anything around token storage or the OAuth loopback? Report it privately instead of opening a public issue, and keep server addresses and tokens out of the report.

## License

MIT, Copyright (c) 2026 Alaister LJ Leung.

`vendor/hermes-agent` is MIT, Copyright (c) 2025 Nous Research, and that notice travels with it.
