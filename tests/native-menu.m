#import "../src-tauri/native/menu.m"
static void require(BOOL ok, NSString *message) {
    if (!ok) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
    printf("PASS: %s\n", message.UTF8String); fflush(stdout);
}
static NSMutableDictionary *fixture;
static BOOL failNext;
static void publishFixture(void) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:fixture options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    deskody_menu_snapshot(json.UTF8String);
}
static void action(const char *name, const char *rid, bool enabled) {
    NSString *command = [NSString stringWithUTF8String:name];
    if ([command isEqual:@"refresh"]) return;
    BOOL failure = failNext; failNext = NO;
    if (!failure) {
        if ([command isEqual:@"enabled"]) fixture[@"settings"][@"enabled"] = @(enabled);
        if ([command isEqual:@"rule"]) {
            for (NSMutableDictionary *rule in fixture[@"settings"][@"rules"]) {
                if ([rule[@"id"] isEqual:[NSString stringWithUTF8String:rid]]) rule[@"enabled"] = @(enabled);
            }
        }
        if ([command isEqual:@"pause"]) fixture[@"status"][@"player"][@"playing"] = @NO;
    }
    // Worker completion deliberately occurs while AppKit runs its tracking loop.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_DEFAULT,0), ^{
        if (!failure) publishFixture();
        deskody_menu_result(failure ? "Test: kayıt başarısız" : NULL);
    });
}
@interface MenuTest : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(strong) NSWindow *source;
@property(strong) NSStatusItem *statusItem;
@property(copy) NSString *path;
@property BOOL host;
@property pid_t foregroundPID;
@property pid_t expectedForegroundPID;
@property NSInteger stage;
@property(strong) NSTimer *testTimer;
@end
@implementation MenuTest
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
    if (self.expectedForegroundPID) require(self.foregroundPID == self.expectedForegroundPID, @"external fullscreen fixture is active");
    require(self.foregroundPID != NSProcessInfo.processInfo.processIdentifier, @"another app is active before opening");
    NSDictionary *data = @{
        @"settings": @{@"enabled": @YES, @"rules": @[
            @{@"id":@"code",@"name":@"Ders çalışma",@"enabled":@YES,@"priority":@60,@"matcher":@{@"kind":@"app",@"value":@"Preview, Visual Studio Code"},@"action":@{@"kind":@"play"}},
            @{@"id":@"word",@"name":@"Word",@"enabled":@YES,@"priority":@50,@"matcher":@{@"kind":@"app",@"value":@"Microsoft Word"},@"action":@{@"kind":@"play"}}
        ]},
        @"status": @{@"context":@{@"app":@"Visual Studio Code"},@"activeRule":@"code",@"manualOverride":@NO,
            @"player":@{@"track":@"A Walk Through the Quiet City",@"artist":@"Sunday Study Sessions",@"playing":@YES,@"canPlay":@YES,@"canPause":@YES}}
    };
    fixture = [NSJSONSerialization JSONObjectWithData:[NSJSONSerialization dataWithJSONObject:data options:0 error:nil] options:NSJSONReadingMutableContainers error:nil];
    publishFixture();
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.image = symbol(@"waveform");
    require(deskody_menu_create((__bridge void *)self.statusItem, action), @"real NSStatusItem menu attached");
    self.testTimer = [NSTimer timerWithTimeInterval:0.35 target:self selector:@selector(step:) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:self.testTimer forMode:NSEventTrackingRunLoopMode];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        [self.statusItem.button performClick:nil];
        require(self.stage >= 5, @"menu actions complete before dismissal");
        require(!nativeMenu.tracking && !nativeMenu.timer, @"AppKit dismissal removes tracking timer");
        require(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == self.foregroundPID, @"closing preserves the other application");
        [self.testTimer invalidate];
        deskody_menu_destroy();
        [NSStatusBar.systemStatusBar removeStatusItem:self.statusItem];
        [NSApp terminate:nil];
    });
}
- (void)windowDidEnterFullScreen:(NSNotification *)notification {
    [@"ready" writeToFile:[self.path stringByAppendingString:@".ready"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (void)step:(NSTimer *)timer {
    require(nativeMenu.tracking, @"native menu stays open during control actions");
    switch (self.stage++) {
        case 0: {
            require(nativeMenu.content.window.onActiveSpace && nativeMenu.content.window.visible, @"menu visible in current Space");
            require(NSMenu.menuBarVisible, @"system menu bar visible while tracking");
            require(self.statusItem.button.cell.highlighted, @"status icon has system selection highlight");
            require(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == self.foregroundPID, @"opening does not activate Deskody");
            require([nativeMenu.flow isKindOfClass:NSSwitch.class], @"real AppKit switch, no webview");
            NSView *view = nativeMenu.content.window.contentView;
            NSBitmapImageRep *image = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:image];
            [[image representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:self.path atomically:YES];
            [nativeMenu.flow performClick:nil];
            break;
        }
        case 1:
            require(!nativeMenu.busy && nativeMenu.flow.state == NSControlStateValueOff, @"worker result updates switch inside tracking loop");
            failNext = YES;
            [nativeMenu.ruleSwitches[@"code"] performClick:nil];
            break;
        case 2:
            require(!nativeMenu.busy && nativeMenu.ruleSwitches[@"code"].state == NSControlStateValueOn, @"failed save restores committed rule state");
            require([nativeMenu.errorLabel.stringValue containsString:@"başarısız"], @"save error visible in menu");
            [nativeMenu.play performClick:nil];
            break;
        case 3:
            require([nativeMenu.play.accessibilityLabel isEqual:@"Müziği çal"], @"player state updates after native pause action");
            [nativeMenu.ruleSwitches[@"word"] performClick:nil];
            break;
        case 4: {
            require(nativeMenu.ruleSwitches[@"word"].state == NSControlStateValueOff, @"rule toggle commits without closing menu");
            NSEvent *escape = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:nativeMenu.content.window.windowNumber context:nil characters:@"\x1b" charactersIgnoringModifiers:@"\x1b" isARepeat:NO keyCode:53];
            [NSApp postEvent:escape atStart:NO];
            break;
        }
        default: require(NO, @"Escape should dismiss native menu");
    }
}
@end
int main(int argc,const char **argv) { @autoreleasepool {
    [NSApplication sharedApplication];
    MenuTest *test = [MenuTest new];
    test.host = argc > 1 && strcmp(argv[1],"--host") == 0;
    test.path = argc > 2 ? [NSString stringWithUTF8String:argv[2]] : @"/tmp/deskody-native-menu.png";
    if (argc > 2 && strcmp(argv[1],"--panel") == 0) { test.expectedForegroundPID = atoi(argv[2]); test.path = @"/tmp/deskody-native-menu-fullscreen.png"; }
    [NSApp setActivationPolicy:test.host ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory];
    NSApp.delegate = test;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC),dispatch_get_main_queue(),^{ require(NO,@"native test timed out"); });
    [NSApp run]; return 0;
} }
