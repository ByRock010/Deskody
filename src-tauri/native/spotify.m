#import <Cocoa/Cocoa.h>

// Some Spotify versions activate themselves inside the PCtx handler even with
// kAENeverInteract. Restore only the app that was frontmost for this one command.
// This is a bounded recovery, not a claim that Spotify never activates at all.
@interface DeskodySpotifyFocusGuard : NSObject
@property(strong) NSRunningApplication *previous;
@property pid_t targetPID;
@property(strong) id observer;
@property NSTimeInterval deadline;
@property uint32_t mouseDownCount;
@property uint32_t keyDownCount;
@property BOOL stopped;
@property NSUInteger attempts;
- (instancetype)initWithTarget:(NSRunningApplication *)target;
- (void)activated:(NSRunningApplication *)application;
- (void)stop;
@end

static uint32_t mouseDownCount(void) {
    return CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown)
         + CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventRightMouseDown)
         + CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventOtherMouseDown);
}

@implementation DeskodySpotifyFocusGuard
- (instancetype)initWithTarget:(NSRunningApplication *)target {
    self = [super init];
    if (!self) return nil;
    self.previous = NSWorkspace.sharedWorkspace.frontmostApplication;
    self.targetPID = target.processIdentifier;
    self.mouseDownCount = mouseDownCount();
    self.keyDownCount = CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventKeyDown);
    self.deadline = NSProcessInfo.processInfo.systemUptime + 1.25;
    if (!self.previous || self.previous.processIdentifier == self.targetPID) {
        self.stopped = YES;
        return self;
    }
    __weak DeskodySpotifyFocusGuard *weakSelf = self;
    self.observer = [NSWorkspace.sharedWorkspace.notificationCenter
        addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:nil
        usingBlock:^(NSNotification *notification) {
            [weakSelf activated:notification.userInfo[NSWorkspaceApplicationKey]];
        }];
    // The guard also expires if the sender times out or the native menu is open.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1250 * NSEC_PER_MSEC),
        dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [self stop]; });
    return self;
}
- (void)activated:(NSRunningApplication *)application {
    @synchronized (self) {
        if (self.stopped) return;
        BOOL commandShortcut = (CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState) & kCGEventFlagMaskCommand)
            && CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventKeyDown) != self.keyDownCount;
        if (NSProcessInfo.processInfo.systemUptime >= self.deadline || self.previous.terminated || self.previous.hidden
            || mouseDownCount() != self.mouseDownCount || commandShortcut) {
            [self stop]; return;
        }
        pid_t pid = application.processIdentifier;
        // If the user chooses a third app, never drag them back to the old one.
        if (pid != self.targetPID && pid != self.previous.processIdentifier) {
            [self stop]; return;
        }
        if (pid != self.targetPID || self.attempts >= 3
            || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != self.targetPID) return;
        self.attempts += 1;
        [self.previous activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    }
}
- (void)stop {
    @synchronized (self) {
        self.stopped = YES;
        if (self.observer) [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self.observer];
        self.observer = nil;
    }
}
@end

// Spotify.sdef: `play track` = event class 'spfy', event ID 'PCtx'.
// Target the already-running process, never Launch Services or a URL handler.
static NSAppleEventDescriptor *spotifyPlayEvent(pid_t pid, NSString *uri) {
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor
        appleEventWithEventClass:'spfy' eventID:'PCtx'
        targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid]
        returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:uri]
                  forKeyword:keyDirectObject];
    return event;
}

static OSStatus sendSpotifyPlayEvent(pid_t pid, NSString *uri) {
    NSError *error = nil;
    NSAppleEventDescriptor *reply = [spotifyPlayEvent(pid, uri)
        sendEventWithOptions:NSAppleEventSendWaitForReply | NSAppleEventSendNeverInteract
        timeout:3.0 error:&error];
    if (!reply) return error ? (OSStatus)error.code : errAEEventFailed;
    return [reply paramDescriptorForKeyword:keyErrorNumber].int32Value;
}

// Called on the media worker. Never activate Deskody or launch a stopped player.
// Return an Apple Event error code to Rust, including permission/timeout failures.
int32_t mo_spotify_play(const char *uri) {
    @autoreleasepool {
        if (!uri) return paramErr;
        NSString *target = [NSString stringWithUTF8String:uri];
        if (!target.length) return paramErr;
        NSRunningApplication *spotify = [NSRunningApplication
            runningApplicationsWithBundleIdentifier:@"com.spotify.client"].firstObject;
        if (!spotify || spotify.terminated) return procNotFound;
        DeskodySpotifyFocusGuard *guard = [[DeskodySpotifyFocusGuard alloc] initWithTarget:spotify];
        OSStatus result = sendSpotifyPlayEvent(spotify.processIdentifier, target);
        if (result != noErr) [guard stop];
        return result;
    }
}
