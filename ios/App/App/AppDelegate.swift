import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Paint the area behind the (non-overlaying) status bar with the app's
        // paper cream (#f7f2ea) instead of the default black strip. The web
        // view is constrained below the status bar, so this colour shows in
        // that top inset. Set on the window and the root view (the latter once
        // the storyboard has wired it up) so it sticks.
        let paper = UIColor(red: 0.969, green: 0.949, blue: 0.918, alpha: 1.0)
        window?.backgroundColor = paper
        DispatchQueue.main.async {
            self.window?.rootViewController?.view.backgroundColor = paper
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.

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
