#import "../src-tauri/native/spotify.m"
static void require(BOOL ok, const char *message) {
    if (!ok) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
    printf("PASS: %s\n", message);
}
// A receiver that records activation requests without touching the user's windows.
@interface FakeRunningApp : NSObject
@property pid_t processIdentifier;
@property(getter=isTerminated) BOOL terminated;
@property(getter=isHidden) BOOL hidden;
@property NSUInteger activationCount;
@end
@implementation FakeRunningApp
- (BOOL)activateWithOptions:(NSApplicationActivationOptions)options {
    require(!(options & NSApplicationActivateAllWindows), "recovery does not raise every window");
    self.activationCount += 1;
    return YES;
}
@end
static DeskodySpotifyFocusGuard *guard(FakeRunningApp *previous) {
    DeskodySpotifyFocusGuard *g = [DeskodySpotifyFocusGuard new];
    g.previous = (NSRunningApplication *)previous;
    g.targetPID = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    g.deadline = NSProcessInfo.processInfo.systemUptime + 1.25;
    g.mouseDownCount = mouseDownCount();
    g.keyDownCount = CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventKeyDown);
    return g;
}
int main(void) { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    FakeRunningApp *previous = [FakeRunningApp new]; previous.processIdentifier = -100;
    NSRunningApplication *target = NSWorkspace.sharedWorkspace.frontmostApplication;
    require(target != nil, "foreground fixture available");
    DeskodySpotifyFocusGuard *g = guard(previous);
    [g activated:target]; [g activated:target]; [g activated:target]; [g activated:target];
    require(previous.activationCount == 3, "repeated Spotify activations have a bounded recovery count");
    previous.activationCount = 0;
    g = guard(previous); g.deadline = 0; [g activated:target];
    require(previous.activationCount == 0 && g.stopped, "expired request never steals focus back");
    g = guard(previous); g.mouseDownCount += 1; [g activated:target];
    require(previous.activationCount == 0 && g.stopped, "new user click cancels recovery");
    g = guard(previous);
    FakeRunningApp *third = [FakeRunningApp new]; third.processIdentifier = -200;
    [g activated:(NSRunningApplication *)third]; [g activated:target];
    require(previous.activationCount == 0 && g.stopped, "choosing a third application cancels recovery");
    g = guard(previous); previous.terminated = YES; [g activated:target];
    require(previous.activationCount == 0 && g.stopped, "terminated previous application is not relaunched");
    previous.terminated = NO;
    g = guard(previous); previous.hidden = YES; [g activated:target];
    require(previous.activationCount == 0 && g.stopped, "deliberately hidden previous application stays hidden");
    previous.hidden = NO;
    g = [[DeskodySpotifyFocusGuard alloc] initWithTarget:target];
    require(g.stopped && !g.observer, "Spotify already foreground requires no observer or recovery");
    g = [[DeskodySpotifyFocusGuard alloc] initWithTarget:NSRunningApplication.currentApplication];
    require(g.observer != nil, "temporary workspace observer registered");
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.5]];
    require(g.stopped && !g.observer, "deadline removes workspace observer");
    NSString *uri = @"spotify:track:4LhgwcTWwJQc6DFTkLXVEc";
    NSAppleEventDescriptor *event = spotifyPlayEvent(getpid(),uri);
    require(event.eventClass == 'spfy' && event.eventID == 'PCtx', "native event uses Spotify's play-track command");
    require([[event paramDescriptorForKeyword:keyDirectObject].stringValue isEqual:uri], "track URI is passed as data");
    require([event attributeDescriptorForKeyword:keyAddressAttr].descriptorType == typeKernelProcessID, "event targets a running PID, not a URL launcher");
    return 0;
} }
