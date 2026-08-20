import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Key under which we remember the user's last painted surface colour, so
    // the SHELL can be painted in it before any web content exists.
    private static let shellBackgroundKey = "ec_shell_bg"

    // Used only until the web view has reported a real colour once (i.e. the
    // very first launch after install). Matches the app's default theme
    // surface rather than the old hardcoded cream, which belonged to a theme
    // default that no longer exists.
    private static let fallbackShellBackground = "#fff8f7"

    /// The shell background is every pixel the WEB PAGE isn't currently
    /// painting: the strip behind the non-overlaying status bar, the
    /// overscroll area, and — the reason this exists — the whole window
    /// during a `location.reload()`, when the old document is torn down and
    /// the new one hasn't painted yet.
    ///
    /// It used to be a hardcoded cream, which flashed on every reload for
    /// anyone not on a light cream theme (i.e. anyone who has touched the
    /// theme picker). The web layer already persists the resolved surface
    /// colour to localStorage on every theme apply; `cacheShellBackground()`
    /// below copies that into UserDefaults each time the app is active, so the
    /// NEXT launch or reload can paint it natively with no web round-trip.
    private func applyShellBackground() {
        let hex = UserDefaults.standard.string(forKey: AppDelegate.shellBackgroundKey)
            ?? AppDelegate.fallbackShellBackground
        guard let color = AppDelegate.color(fromHex: hex) else { return }
        window?.backgroundColor = color
        DispatchQueue.main.async {
            self.window?.rootViewController?.view.backgroundColor = color
            if let webView = (self.window?.rootViewController as? CAPBridgeViewController)?.webView {
                // Both: the web view paints during teardown, the scroll view
                // paints the rubber-band overscroll area.
                webView.backgroundColor = color
                webView.scrollView.backgroundColor = color
            }
        }
    }

    /// Copy the web layer's current surface colour into UserDefaults. Reading
    /// localStorage out of the web view avoids needing a Capacitor plugin or a
    /// script-message bridge just to move one hex string across.
    private func cacheShellBackground() {
        guard let webView = (window?.rootViewController as? CAPBridgeViewController)?.webView else { return }
        webView.evaluateJavaScript("localStorage.getItem('theme-bg')") { result, _ in
            guard let hex = result as? String,
                  AppDelegate.color(fromHex: hex) != nil else { return }
            UserDefaults.standard.set(hex, forKey: AppDelegate.shellBackgroundKey)
        }
    }

    /// #rrggbb → UIColor. Returns nil on anything unexpected so a corrupt
    /// value leaves the current colour alone rather than painting black.
    private static func color(fromHex hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((v >> 16) & 0xFF) / 255.0,
            green: CGFloat((v >> 8) & 0xFF) / 255.0,
            blue: CGFloat(v & 0xFF) / 255.0,
            alpha: 1.0
        )
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        applyShellBackground()
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Last chance to capture the current theme before the app goes away —
        // covers "change theme, background the app, come back", where the next
        // thing the user sees is painted from this cached value.
        cacheShellBackground()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.

        // Re-read the theme now that the web view is live, and repaint the
        // shell with it. The delay lets a cold-start page get far enough to
        // have written localStorage; the value is only needed for the NEXT
        // teardown, so being a beat late costs nothing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.cacheShellBackground()
            self?.applyShellBackground()
        }

        // Make the Capacitor WKWebView inspectable so Safari's Web Inspector
        // (Develop → device → WebView) can attach for memory profiling. On
        // iOS 16.4+ a WKWebView only shows up there when isInspectable == true.
        // DEBUG only: a shipping build must NOT leave the web view attachable
        // from Safari's Web Inspector — that would expose a logged-in user's
        // session to anyone who plugs the device into a Mac.
        #if DEBUG
        if #available(iOS 16.4, *) {
            DispatchQueue.main.async {
                (self.window?.rootViewController as? CAPBridgeViewController)?.webView?.isInspectable = true
            }
        }
        #endif
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // APNs hands the device token to the AppDelegate, not to Capacitor. These
    // two forward it to the PushNotifications plugin, which is what fires the
    // JS `registration` / `registrationError` listeners in src/lib/native.js.
    // Without them, register() resolves but no token ever arrives.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
