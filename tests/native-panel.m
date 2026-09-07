// AppKit integration test; no Accessibility permission or private API required.
// Compiled separately from Tauri. Includes the production host, not a mock.
#import <WebKit/WebKit.h>
#import "../src-tauri/native/panel.m"

static void require(BOOL condition, NSString *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
    printf("PASS: %s\n", message.UTF8String); fflush(stdout);
}

@interface PanelTest : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler>
@property(strong) NSWindow *source;
@property(strong) WKWebView *web;
@property(copy) NSString *path;
@property BOOL host;
@property BOOL receivedMessage;
@property pid_t foregroundPID;
@property pid_t expectedForegroundPID;
@end

@implementation PanelTest
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    if (self.host) {
        self.source = [[NSWindow alloc] initWithContentRect:NSMakeRect(120, 120, 800, 600)
            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
            backing:NSBackingStoreBuffered defer:NO];
        self.source.releasedWhenClosed = NO;
        self.source.title = @"Deskody · Geçici tam ekran testi";
        self.source.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
        self.source.delegate = self;
        NSTextField *label = [NSTextField labelWithString:@"Deskody tam ekran panelini doğruluyor…\nBu test penceresi otomatik kapanacak."];
        label.frame = NSMakeRect(30, 200, 730, 100);
        label.font = [NSFont systemFontOfSize:24];
        [self.source.contentView addSubview:label];
        [self.source makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            [self.source toggleFullScreen:nil];
        });
        [NSTimer scheduledTimerWithTimeInterval:0.2 repeats:YES block:^(NSTimer *timer) {
            if ([NSFileManager.defaultManager fileExistsAtPath:[self.path stringByAppendingString:@".stop"]]) {
                require((self.source.styleMask & NSWindowStyleMaskFullScreen) != 0 && self.source.onActiveSpace,
                    @"external host is still fullscreen on the active Space after panel test");
                [NSApp terminate:nil];
            }
        }];
        return;
    }
    self.foregroundPID = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    if (self.expectedForegroundPID) require(self.foregroundPID == self.expectedForegroundPID, @"external fullscreen fixture is the active application");
    require(self.foregroundPID != NSProcessInfo.processInfo.processIdentifier, @"test starts with another app active");
    self.source = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 380, 580)
        styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    self.source.releasedWhenClosed = NO;
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    [config.userContentController addScriptMessageHandler:self name:@"probe"];
    self.web = [[WKWebView alloc] initWithFrame:self.source.contentView.bounds configuration:config];
    self.web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.web.navigationDelegate = self;
    [self.source.contentView addSubview:self.web];
    require(deskody_panel_create((__bridge void *)self.source), @"production NSPanel created");
    require([deskodyPanelHost.panel isKindOfClass:NSPanel.class], @"genuine NSPanel, no class swizzling");
    require((deskodyPanelHost.panel.styleMask & NSWindowStyleMaskNonactivatingPanel) != 0, @"nonactivating from construction");
    require((deskodyPanelHost.panel.collectionBehavior & NSWindowCollectionBehaviorFullScreenAuxiliary) != 0, @"full-screen auxiliary enabled");
    if (@available(macOS 13.0, *)) require((deskodyPanelHost.panel.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllApplications) != 0, @"Stage Manager/all-apps collection behavior enabled");
    [self.web loadHTMLString:@"<html><body style='background:#171e19;color:white;font:20px system-ui'><h2>Deskody panel testi</h2><button onclick=\"window.webkit.messageHandlers.probe.postMessage('connected')\">IPC</button></body></html>" baseURL:nil];
}
- (void)windowDidEnterFullScreen:(NSNotification *)notification {
    [@"ready" writeToFile:[self.path stringByAppendingString:@".ready"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    require(deskody_panel_toggle(), @"panel opens");
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 700 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        require(deskodyPanelHost.panel.visible && deskodyPanelHost.panel.onActiveSpace, @"visible in the currently active Space (including external fullscreen)");
        require(!self.source.visible, @"Tauri source window stays hidden");
        require(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == self.foregroundPID, @"opening preserves the other foreground application");
        require(self.web.window == deskodyPanelHost.panel, @"live WKWebView belongs to native panel");
        require(deskodyPanelHost.panel.firstResponder == self.web, @"WKWebView receives keyboard focus");
        [self.web evaluateJavaScript:@"document.visibilityState + ':' + document.hasFocus()" completionHandler:^(id value, NSError *error) {
            require(!error && [value isEqual:@"visible:true"], @"WebKit content is visible and focused despite hidden source");
            [self.web evaluateJavaScript:@"document.querySelector('button').click()" completionHandler:nil];
        }];
    });
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    require([message.body isEqual:@"connected"], @"original WebKit IPC handler survives reparenting");
    self.receivedMessage = YES;
    NSEvent *escape = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0
        timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:deskodyPanelHost.panel.windowNumber
        context:nil characters:@"\x1b" charactersIgnoringModifiers:@"\x1b" isARepeat:NO keyCode:53];
    [NSApp postEvent:escape atStart:NO];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 400 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        require(!deskodyPanelHost.panel.visible, @"Escape dismisses native panel");
        require(!deskodyPanelHost.localMonitor && !deskodyPanelHost.globalMonitor, @"dismissal removes event monitors");
        require(deskody_panel_toggle(), @"panel reopens");
        [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidChangeScreenParametersNotification object:nil];
        require(!deskodyPanelHost.panel.visible, @"screen changes dismiss the panel");
        require(deskody_panel_toggle() && !deskodyPanelHost.panel.visible, @"tray mouse-up does not reopen a just-dismissed panel");
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 400 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            require(deskody_panel_toggle(), @"panel opens after debounce");
            [NSWorkspace.sharedWorkspace.notificationCenter postNotificationName:NSWorkspaceActiveSpaceDidChangeNotification object:nil];
            require(!deskodyPanelHost.panel.visible, @"Space changes dismiss the panel");
            deskody_panel_destroy();
            require(self.web.window == self.source, @"shutdown restores the original webview owner");
            require(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == self.foregroundPID, @"dismissal preserves the other foreground application");
            puts("Native panel integration checks passed.");
            [NSApp terminate:nil];
        });
    });
}
@end

int main(int argc, const char **argv) { @autoreleasepool {
    [NSApplication sharedApplication];
    PanelTest *test = [PanelTest new];
    test.host = argc > 1 && strcmp(argv[1], "--host") == 0;
    if (argc > 2 && strcmp(argv[1], "--panel") == 0) test.expectedForegroundPID = atoi(argv[2]);
    test.path = argc > 2 ? [NSString stringWithUTF8String:argv[2]] : @"/tmp/deskody-panel-native-test";
    [NSApp setActivationPolicy:test.host ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory];
    NSApp.delegate = test;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ require(NO, @"native test timed out"); });
    [NSApp run];
    return 0;
} }
