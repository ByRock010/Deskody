#import <Cocoa/Cocoa.h>
static uint32_t mouseDownCount(void) {
    return CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown)
         + CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventRightMouseDown)
         + CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventOtherMouseDown);
}
static NSAppleEventDescriptor *property(OSType code, NSAppleEventDescriptor *container) {
    NSAppleEventDescriptor *spec = NSAppleEventDescriptor.recordDescriptor;
    [spec setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:typeProperty] forKeyword:keyAEDesiredClass];
    [spec setDescriptor:container ?: NSAppleEventDescriptor.nullDescriptor forKeyword:keyAEContainer];
    [spec setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:formPropertyID] forKeyword:keyAEKeyForm];
    [spec setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:code] forKeyword:keyAEKeyData];
    return [spec coerceToDescriptorType:typeObjectSpecifier];
}
static NSAppleEventDescriptor *readProperty(pid_t pid, NSAppleEventDescriptor *spec) {
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:kAECoreSuite eventID:kAEGetData targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:spec forKeyword:keyDirectObject];
    NSError *error = nil;
    NSAppleEventDescriptor *reply = [event sendEventWithOptions:NSAppleEventSendWaitForReply | NSAppleEventSendNeverInteract timeout:3 error:&error];
    if (error || [reply paramDescriptorForKeyword:keyErrorNumber].int32Value) {
        fprintf(stderr,"read error %ld/%d\n", (long)error.code, [reply paramDescriptorForKeyword:keyErrorNumber].int32Value);
        return nil;
    }
    return [reply paramDescriptorForKeyword:keyDirectObject];
}
int main(int argc, const char *argv[]) { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSRunningApplication *spotify = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.spotify.client"].firstObject;
    if (!spotify) return 2;
    pid_t pid=spotify.processIdentifier, original=NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    if (argc != 4) return 2;
    if (original != atoi(argv[2])) { fprintf(stderr,"Fullscreen host is not foreground\n"); return 5; }
    if (original == pid) { fprintf(stderr,"Spotify is already foreground; focus test cannot run\n"); return 3; }
    NSAppleEventDescriptor *beforeState = readProperty(pid, property('pPlS',nil));
    if (!beforeState) return 4;
    printf("Initial playing: %d\n", beforeState.enumCodeValue == 'kPSP');
    NSString *beforeTrack = readProperty(pid,property('ID  ',property('pTrk',nil))).stringValue;
    if (!beforeTrack || [beforeTrack isEqual:[NSString stringWithUTF8String:argv[1]]]) {
        fprintf(stderr,"A different initial track is required; pass --seed to the test script\n");
        return 6;
    }
    printf("Target differs from initial track: 1\n");
    if (argc < 2) return 0;
    uint32_t clicksBefore = mouseDownCount();
    __block unsigned thirdApps = 0;
    __block BOOL switched = NO;
    __block double activationTime = 0, longest = 0;
    id observer = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
        NSRunningApplication *active = notification.userInfo[NSWorkspaceApplicationKey];
        if (active.processIdentifier != pid && active.processIdentifier != original) thirdApps++;
        if (active.processIdentifier == pid) { switched = YES; activationTime = NSProcessInfo.processInfo.systemUptime; }
        else if (activationTime > 0) { longest = MAX(longest, NSProcessInfo.processInfo.systemUptime - activationTime); activationTime = 0; }
    }];
    __block BOOL finished = NO;
    __block int32_t result = -1;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
        // Exercise production Rust, including native path lookup, target-device
        // selection and bounded command execution. No alternate test play path.
        NSTask *task = [NSTask new];
        task.executableURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[3]]];
        task.arguments = @[[NSString stringWithUTF8String:argv[1]]];
        NSError *error = nil;
        int32_t code = -1;
        if ([task launchAndReturnError:&error]) {
            [task waitUntilExit];
            code = task.terminationStatus;
        }
        dispatch_async(dispatch_get_main_queue(), ^{ result=code; finished=YES; });
    });
    NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:9];
    while (deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.025]];
        if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == pid) switched=YES;
    }
    NSAppleEventDescriptor *track = readProperty(pid,property('ID  ',property('pTrk',nil)));
    BOOL playing = readProperty(pid,property('pPlS',nil)).enumCodeValue == 'kPSP';
    BOOL matches = [track.stringValue isEqual:[NSString stringWithUTF8String:argv[1]]];
    printf("Native command finished: %d, code: %d, playing: %d, target matches: %d, Spotify activated: %d, original focus preserved: %d\n",finished,result,playing,matches,switched,NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==original);
    printf("External input: mouse=%u, other app activations=%u\n", mouseDownCount()-clicksBefore, thirdApps);
    printf("Longest observed Spotify foreground interval: %.1f ms\n", longest * 1000);
    if (beforeState.enumCodeValue != 'kPSP') {
        NSAppleEventDescriptor *pause = [NSAppleEventDescriptor appleEventWithEventClass:'spfy' eventID:'Paus' targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [pause sendEventWithOptions:NSAppleEventSendWaitForReply | NSAppleEventSendNeverInteract timeout:3 error:nil];
    }
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:observer];
    return finished && result==0 && playing && matches && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==original && !switched && thirdApps==0 && mouseDownCount()==clicksBefore ? 0 : 1;
} }
