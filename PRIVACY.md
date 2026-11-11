# Topoi Privacy Policy

Last updated: 11 November 2026

Topoi is an iOS app that connects to a Hermes gateway, a self-hosted AI assistant server that you run yourself or that someone gives you access to. This policy explains what the app does with your information.

## Who runs what

Topoi is developed by Alaister Leung. The app ships no hosted service: there is no Topoi account and no Topoi-operated server. Every request the app makes goes to the gateway URL you enter in it, and that server's operator is responsible for the data it receives and stores.

## What the app sends, and where it goes

Everything you send, including prompts, replies, topic and thread names, and any photo, file or PDF you attach, travels from your phone directly to the gateway URL you entered. It is not routed through, copied to, or stored on any server operated by the developer, and it is not used to train anything.

If you did not deploy that gateway yourself, ask its operator how they handle your data.

## What is stored on your device

- Sign-in credentials (access and refresh tokens) are held in the iOS Keychain through the app's own native plugin. They are not written to the web view's storage.
- The gateway URL you entered, plus a small cache of screens you have already opened, are kept in the app's local web storage so the app opens quickly and can show your last screen.
- Signing out deletes the stored tokens. Deleting the app removes everything the app stored on the device.

## Permissions

- Photos and camera: used only when you attach an image to a message. The app does not read your photo library in the background.
- Files: used only when you pick a file to attach.

## What the app does not do

- No analytics, advertising, tracking or attribution SDKs.
- No crash-reporting SDK of its own.
- No selling or sharing of your data with third parties.
- No account creation, no contact access, no location access.

## TestFlight

While Topoi is distributed through Apple's TestFlight, Apple collects crash logs, usage information and any feedback you submit, and shares some of it with the developer. That collection is described in Apple's TestFlight terms. Feedback you email directly is used only to improve the app.

## Children

Topoi is a tool for people who run their own server and is not directed at children under 13.

## Changes

If this policy changes, the updated version will be posted at this URL with a new date.

## Contact

Alaister LJ Leung <me@ljleung.dev>
