import UIKit
import Capacitor
import WebKit

/** The boot splash redraws what the launch screen shows: the wordmark at half the screen's width, centered, on black. The aspect is the wordmark asset's own (404 by 140). */
private let BOOT_SPLASH_WIDTH: CGFloat = 0.5
private let BOOT_SPLASH_ASPECT: CGFloat = 140.0 / 404.0
private let BOOT_SPLASH_FADE: TimeInterval = 0.2
/** How often the page is asked whether it has taken over, and the point at which a page that never answers stops covering the app. */
private let BOOT_SPLASH_POLL: TimeInterval = 0.1
private let BOOT_SPLASH_TIMEOUT: TimeInterval = 8

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var bootSplash: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        let bridgeViewController = CAPBridgeViewController()
        // Paint the webview with the app background before any page loads so a
        // cold start shows #0b0b0f instead of the default white flash.
        bridgeViewController.loadViewIfNeeded()
        if let webView = bridgeViewController.webView {
            webView.isOpaque = false
            webView.backgroundColor = UIColor(red: 11.0 / 255.0, green: 11.0 / 255.0, blue: 15.0 / 255.0, alpha: 1.0)
            webView.scrollView.backgroundColor = UIColor(red: 11.0 / 255.0, green: 11.0 / 255.0, blue: 15.0 / 255.0, alpha: 1.0)
        }
        window?.backgroundColor = UIColor(red: 11.0 / 255.0, green: 11.0 / 255.0, blue: 15.0 / 255.0, alpha: 1.0)
        window?.rootViewController = bridgeViewController
        window?.makeKeyAndVisible()

        if let webView = bridgeViewController.webView {
            showBootSplash(above: webView)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    /** The launch screen is dropped at the app's first frame, which is this window
     *  before the webview has parsed anything: the gap is a plain background with
     *  no wordmark in it. This view holds the launch screen's own look over that
     *  gap, and the page's splash (index.html) continues it from there. */
    private func showBootSplash(above webView: WKWebView) {
        guard let window else { return }
        let splash = UIView(frame: window.bounds)
        splash.backgroundColor = .black
        splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let mark = UIImageView(image: UIImage(named: "Wordmark"))
        mark.contentMode = .scaleAspectFit
        mark.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(mark)
        window.addSubview(splash)
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: splash.centerYAnchor),
            mark.widthAnchor.constraint(equalTo: splash.widthAnchor, multiplier: BOOT_SPLASH_WIDTH),
            mark.heightAnchor.constraint(equalTo: mark.widthAnchor, multiplier: BOOT_SPLASH_ASPECT)
        ])
        bootSplash = splash
        // The page is the one that knows when the app has something to show, so
        // this asks it, rather than guessing a delay or trusting a load event:
        // the page answers 'loading' until its own splash is out of the way.
        pollBootSplash(webView: webView)
        DispatchQueue.main.asyncAfter(deadline: .now() + BOOT_SPLASH_TIMEOUT) { [weak self] in self?.dropBootSplash() }
    }

    private func pollBootSplash(webView: WKWebView) {
        guard bootSplash != nil else { return }
        let question = "(() => { const root = document.getElementById('root'); const splash = document.getElementById('boot-splash'); return root ? (splash ? 'loading' : 'ready') : 'blank' })()"
        webView.evaluateJavaScript(question) { [weak self] result, _ in
            guard let self, self.bootSplash != nil else { return }
            if result as? String == "ready" {
                self.dropBootSplash()
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + BOOT_SPLASH_POLL) {
                self.pollBootSplash(webView: webView)
            }
        }
    }

    private func dropBootSplash() {
        guard let splash = bootSplash else { return }
        bootSplash = nil
        UIView.animate(withDuration: BOOT_SPLASH_FADE, animations: { splash.alpha = 0 }, completion: { _ in splash.removeFromSuperview() })
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
