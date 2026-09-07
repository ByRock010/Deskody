#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import "panel.h"

// Use a real NSPanel, constructed with the nonactivating bit from the outset.
// Changing the class/style of an existing Tao NSWindow leaves WindowServer's
// activation flags and Tao's Objective-C ivars in an inconsistent state.
@interface DeskodyQuickPanel : NSPanel
@end
@implementation DeskodyQuickPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static NSView *webViewIn(NSView *view) {
    Class webViewClass = NSClassFromString(@"WKWebView");
    if (webViewClass && [view isKindOfClass:webViewClass]) return view;
    for (NSView *child in view.subviews) {
        NSView *found = webViewIn(child);
        if (found) return found;
    }
    return nil;
}

@interface DeskodyPanelHost : NSObject <NSWindowDelegate>
@property(nonatomic, strong) DeskodyQuickPanel *panel;
@property(nonatomic, strong) NSWindow *source;
@property(nonatomic, strong) NSView *hostedView;
@property(nonatomic, strong) id localMonitor;
@property(nonatomic, strong) id globalMonitor;
@property(nonatomic) NSTimeInterval lastDismissed;
@property(nonatomic) BOOL dismissing;
- (void)hide;
- (void)show;
@end

@implementation DeskodyPanelHost
- (void)stopMonitoring {
    if (self.localMonitor) [NSEvent removeMonitor:self.localMonitor];
    if (self.globalMonitor) [NSEvent removeMonitor:self.globalMonitor];
    self.localMonitor = nil;
    self.globalMonitor = nil;
    [NSNotificationCenter.defaultCenter removeObserver:self];
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
}
- (void)hide {
    if (!self.panel.visible || self.dismissing) return;
    self.dismissing = YES;
    self.lastDismissed = NSProcessInfo.processInfo.systemUptime;
    [self stopMonitoring];
    [self.panel orderOut:nil];
    self.dismissing = NO;
}
- (void)dismissOnNotification:(NSNotification *)notification { [self hide]; }
- (void)windowDidResignKey:(NSNotification *)notification { [self hide]; }
- (BOOL)windowShouldClose:(NSWindow *)window { [self hide]; return NO; }
- (void)startMonitoring {
    __weak DeskodyPanelHost *weakSelf = self;
    NSEventMask mouse = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown;
    self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mouse | NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
        DeskodyPanelHost *host = weakSelf;
        if (!host.panel.visible) return event;
        if (event.type == NSEventTypeKeyDown) {
            if (event.window == host.panel && event.keyCode == 53) {
                [host hide];
                return nil;
            }
        } else if (event.window != host.panel) {
            [host hide];
        }
        return event; // Never eat a click intended for the user's other app.
    }];
    // Mouse-only monitoring needs no Accessibility/Input Monitoring grant.
    self.globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mouse handler:^(NSEvent *event) {
        (void)event;
        [weakSelf hide];
    }];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(dismissOnNotification:)
        name:NSApplicationDidResignActiveNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(dismissOnNotification:)
        name:NSApplicationDidChangeScreenParametersNotification object:nil];
    for (NSNotificationName name in @[NSWorkspaceActiveSpaceDidChangeNotification,
            NSWorkspaceDidActivateApplicationNotification, NSWorkspaceWillSleepNotification]) {
        [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(dismissOnNotification:) name:name object:nil];
    }
}
- (void)show {
    NSPoint cursor = NSEvent.mouseLocation;
    NSScreen *screen = nil;
    for (NSScreen *candidate in NSScreen.screens) {
        if (NSPointInRect(cursor, candidate.frame)) { screen = candidate; break; }
    }
    screen = screen ?: NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    if (!screen) return;
    // AppKit points avoid mixed Retina/non-Retina global-coordinate conversions.
    NSRect area = screen.visibleFrame;
    CGFloat gap = 8;
    CGFloat width = MIN(380, MAX(1, area.size.width - gap * 2));
    CGFloat height = MIN(580, MAX(1, area.size.height - gap * 2));
    CGFloat x = MAX(NSMinX(area) + gap, MIN(cursor.x - width / 2, NSMaxX(area) - width - gap));
    CGFloat top = MIN(NSMaxY(area), NSMaxY(screen.frame) - NSStatusBar.systemStatusBar.thickness);
    CGFloat y = MAX(NSMinY(area) + gap, top - height - gap);
    [self.panel setFrame:NSMakeRect(x, y, width, height) display:NO];
    [self startMonitoring];
    // NSPanel + NonactivatingPanel grants keyboard focus without activating
    // Deskody, raising its main window, or moving the user's current Space.
    [self.panel makeKeyAndOrderFront:nil];
    [self.panel makeFirstResponder:webViewIn(self.hostedView) ?: self.hostedView];
    [self.panel invalidateShadow];
}
@end

static DeskodyPanelHost *deskodyPanelHost;

bool deskody_panel_create(void *source_window) {
    if (!NSThread.isMainThread || !source_window || deskodyPanelHost) return false;
    NSWindow *source = (__bridge NSWindow *)source_window;
    if (!source.contentView) return false;
    DeskodyPanelHost *host = [DeskodyPanelHost new];
    host.source = source;
    host.hostedView = source.contentView;
    [source orderOut:nil];
    host.panel = [[DeskodyQuickPanel alloc] initWithContentRect:NSMakeRect(0, 0, 380, 580)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
        backing:NSBackingStoreBuffered defer:NO];
    host.panel.title = @"Deskody · Hızlı kontrol";
    host.panel.releasedWhenClosed = NO;
    host.panel.floatingPanel = YES;
    host.panel.hidesOnDeactivate = NO;
    host.panel.becomesKeyOnlyIfNeeded = NO;
    host.panel.level = NSStatusWindowLevel;
    host.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehaviorFullScreenAuxiliary
        | NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
    // NSProcessInfo avoids a compiler-rt availability helper dependency when
    // this Objective-C archive is linked by rustc with -nodefaultlibs.
    if ([NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){13, 0, 0}]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
        // Runtime availability is checked immediately above; this is an enum bit.
        host.panel.collectionBehavior |= NSWindowCollectionBehaviorCanJoinAllApplications;
#pragma clang diagnostic pop
    }
    host.panel.animationBehavior = NSWindowAnimationBehaviorNone;
    host.panel.movable = NO;
    host.panel.hasShadow = YES;
    host.panel.opaque = NO;
    host.panel.backgroundColor = NSColor.clearColor;
    host.panel.delegate = host;
    // Preserve the WKWebView and its IPC handlers; only change its visual host.
    source.contentView = [[NSView alloc] initWithFrame:host.hostedView.frame];
    host.panel.contentView = host.hostedView;
    host.hostedView.wantsLayer = YES;
    host.hostedView.layer.cornerRadius = 12;
    host.hostedView.layer.masksToBounds = YES;
    deskodyPanelHost = host;
    return true;
}

bool deskody_panel_toggle(void) {
    if (!NSThread.isMainThread || !deskodyPanelHost) return false;
    if (deskodyPanelHost.panel.visible) { [deskodyPanelHost hide]; return true; }
    if (NSProcessInfo.processInfo.systemUptime - deskodyPanelHost.lastDismissed < 0.25) return true;
    [deskodyPanelHost show];
    return deskodyPanelHost.panel.visible;
}

void deskody_panel_hide(void) {
    if (NSThread.isMainThread) [deskodyPanelHost hide];
}

void deskody_panel_destroy(void) {
    if (!NSThread.isMainThread || !deskodyPanelHost) return;
    [deskodyPanelHost hide];
    [deskodyPanelHost stopMonitoring];
    deskodyPanelHost.panel.delegate = nil;
    deskodyPanelHost.panel.contentView = nil;
    deskodyPanelHost.source.contentView = deskodyPanelHost.hostedView;
    [deskodyPanelHost.panel close];
    deskodyPanelHost = nil;
}
