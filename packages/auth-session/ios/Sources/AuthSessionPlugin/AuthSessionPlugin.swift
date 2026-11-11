import UIKit
import AuthenticationServices
import Capacitor
import Foundation
import Network
import Security

/// Loopback OAuth session for the gateway's native authorize route.
///
/// The gateway only accepts `http://127.0.0.1:<port>` redirects (the RFC 8252 loopback pattern), so this plugin runs an NWListener on the loopback interface and presents the authorize URL in ASWebAuthenticationSession.
/// The authorization code reaches the listener either because the browser follows the redirect to it directly, or because the session captures the first http:// navigation and hands it to the completion handler.
/// Both paths resolve the same promise with the full callback URL; the first one to fire wins and the other is torn down.
@objc(TopoiAuthSessionPlugin)
public class TopoiAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "TopoiAuthSessionPlugin"
    public let jsName = "TopoiAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearTokens", returnType: CAPPluginReturnPromise)
    ]

    private var listener: NWListener?
    private var authSession: ASWebAuthenticationSession?
    private var pendingCall: CAPPluginCall?
    private let listenerQueue = DispatchQueue(label: "topoi.auth-session.listener")
    private let bindQueue = DispatchQueue(label: "topoi.auth-session.bind")
    private var settled = false
    // The path the redirect_uri was built with; the listener settles the call only for a request on this path.
    private var redirectPath = "/callback"

    @objc func start(_ call: CAPPluginCall) {
        // Capacitor can hand this call to a background queue and both the session and its presentation anchor are UIKit, so every start runs on the main thread.
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.start(call)
            }
            return
        }
        guard pendingCall == nil else {
            call.reject("An auth session is already running")
            return
        }
        guard let authorizeURLString = call.getString("url"),
              let components = URLComponents(string: authorizeURLString) else {
            call.reject("Must provide a valid authorize URL")
            return
        }
        redirectPath = call.getString("redirectPath") ?? "/callback"
        let ephemeral = call.getBool("ephemeral") ?? false
        pendingCall = call
        settled = false

        // The socket bind waits on its own readiness semaphore, so it runs off the main thread: blocking main here would stall the UI before the sheet can present.
        bindQueue.async { [weak self] in
            guard let self else { return }
            let port = self.startLoopbackListener()
            DispatchQueue.main.async {
                self.presentAuthSession(port: port, components: components, ephemeral: ephemeral)
            }
        }
    }

    /// Attaches the redirect_uri for the bound port and presents the sheet. Main thread only.
    private func presentAuthSession(port: UInt16?, components: URLComponents, ephemeral: Bool) {
        guard let call = pendingCall else { return }
        guard let port else {
            stopLoopbackListener()
            pendingCall = nil
            call.reject("Failed to bind a loopback listener")
            return
        }
        var components = components
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "redirect_uri", value: "http://127.0.0.1:\(port)\(redirectPath)"))
        components.queryItems = items
        guard let finalURL = components.url else {
            stopLoopbackListener()
            pendingCall = nil
            call.reject("Failed to build the authorize URL")
            return
        }

        let session = ASWebAuthenticationSession(url: finalURL, callbackURLScheme: "http") { [weak self] callbackURL, error in
            guard let self else { return }
            DispatchQueue.main.async {
                if let callbackURL {
                    self.resolve(callbackURL.absoluteString)
                } else {
                    self.rejectAuthSession(error)
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = ephemeral
        authSession = session
        session.start()
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // UIKit reads are main-thread only and the session can ask from its own queue, so the window is resolved on the main thread either way.
        guard !Thread.isMainThread else { return anchorWindow() }
        return DispatchQueue.main.sync { self.anchorWindow() }
    }

    /// Main thread only. Presents from the app's own window so the sheet gets a real presentation context; a bare ASPresentationAnchor() has no window scene attached.
    private func anchorWindow() -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        // The bridge's window is nil until the scene attaches, so fall back to the key window of a connected scene.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
    }

    // MARK: - Loopback listener

    private func startLoopbackListener() -> UInt16? {
        // requiredLocalEndpoint is what pins the socket to 127.0.0.1; the port form of NWListener(using:on:) binds every interface, which puts the callback on the local network for as long as the sheet is open.
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        guard let listener = try? NWListener(using: parameters) else { return nil }
        self.listener = listener
        let ready = DispatchSemaphore(value: 0)
        var boundPort: UInt16?
        listener.stateUpdateHandler = { state in
            if case .ready = state {
                boundPort = listener.port?.rawValue
                ready.signal()
            } else if case .failed = state {
                ready.signal()
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }
        listener.start(queue: listenerQueue)
        _ = ready.wait(timeout: .now() + 5)
        return boundPort
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: listenerQueue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self, let data, let request = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }
            let parts = request.split(separator: " ")
            let target = parts.count > 1 ? String(parts[1]) : "/"
            // Only a request on the redirect path settles the call; anything else on the port is not the gateway's callback, and resolving on it would let a stray local request end the sign-in.
            guard target.hasPrefix(self.redirectPath) else {
                connection.cancel()
                return
            }
            let port = self.listener?.port?.rawValue ?? 0
            let callbackURL = "http://127.0.0.1:\(port)\(target)"

            let body = "<!doctype html><html><body style=\"font-family:system-ui;padding:2rem;text-align:center\"><h2>Signed in</h2><p>You can close this window and return to Topoi.</p></body></html>"
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
            connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in
                connection.cancel()
            })
            DispatchQueue.main.async {
                self.resolve(callbackURL)
            }
        }
    }

    private func stopLoopbackListener() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Token storage

    /// The one Keychain item the app's session lives in. `AfterFirstUnlockThisDeviceOnly` keeps it readable while the app is backgrounded, out of iCloud sync and out of a backup restored onto another device.
    private static let tokenService = "com.atxoft.topoi"
    private static let tokenAccount = "topoi.tokens"

    private func tokenQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.tokenService,
            kSecAttrAccount as String: Self.tokenAccount
        ]
    }

    @objc func setTokens(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let data = value.data(using: .utf8) else {
            call.reject("Must provide a string value")
            return
        }
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(tokenQuery() as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var item = tokenQuery()
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            item[kSecAttrSynchronizable as String] = false
            status = SecItemAdd(item as CFDictionary, nil)
        }
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Keychain write failed (\(status))")
        }
    }

    @objc func getTokens(_ call: CAPPluginCall) {
        var query = tokenQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("Keychain read failed (\(status))")
            return
        }
        call.resolve(["value": value])
    }

    @objc func clearTokens(_ call: CAPPluginCall) {
        let status = SecItemDelete(tokenQuery() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Keychain delete failed (\(status))")
        }
    }

    // MARK: - Settling

    // Both settle paths arrive off the main thread, and cleanup() dismisses the auth sheet through UIKit, so every settle is dispatched onto the main thread by its caller.

    private func resolve(_ url: String) {
        guard !settled else { return }
        settled = true
        let call = pendingCall
        cleanup()
        DispatchQueue.main.async {
            call?.resolve(["url": url])
        }
    }

    private func rejectAuthSession(_ error: Error?) {
        guard !settled else { return }
        settled = true
        let call = pendingCall
        cleanup()
        let nsError = error as NSError?
        let cancelled = nsError?.domain == ASWebAuthenticationSessionError.errorDomain
            && nsError?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        DispatchQueue.main.async {
            if cancelled {
                call?.reject("Sign-in was cancelled")
            } else {
                call?.reject(error?.localizedDescription ?? "Sign-in failed")
            }
        }
    }

    private func cleanup() {
        authSession?.cancel()
        authSession = nil
        stopLoopbackListener()
        pendingCall = nil
    }
}
