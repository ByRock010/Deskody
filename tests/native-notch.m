#import "../src-tauri/native/notch.m"
#import <ApplicationServices/ApplicationServices.h>
static void check(BOOL ok, NSString *message) {
    if (!ok) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
    printf("PASS: %s\n", message.UTF8String); fflush(stdout);
}
static NSMutableDictionary *fixture;
static NSDictionary *lastTransport;
static BOOL failNext;
static NSUInteger mediaCommands;
static void publish(void) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:fixture options:0 error:nil];
    deskody_notch_snapshot([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static void action(const char *name, const char *payload, bool enabled) {
    NSString *kind = [NSString stringWithUTF8String:name];
    if ([kind isEqual:@"observe"] || [kind isEqual:@"observeCompact"]) return;
    check(![kind isEqual:@"open"], @"media interaction never opens the main application");
    mediaCommands++;
    BOOL failed = failNext; failNext = NO;
    if (!failed) {
        if ([kind isEqual:@"transport"]) {
            NSData *data = [[NSString stringWithUTF8String:payload] dataUsingEncoding:NSUTF8StringEncoding];
            lastTransport = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if ([lastTransport[@"action"][@"kind"] isEqual:@"seek"]) fixture[@"status"][@"player"][@"position"] = lastTransport[@"action"][@"position"];
        }
        if ([kind isEqual:@"pause"]) fixture[@"status"][@"player"][@"playing"] = @NO;
        if ([kind isEqual:@"enabled"]) fixture[@"settings"][@"enabled"] = @(enabled);
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60*NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_DEFAULT,0), ^{
        if (!failed) publish();
        deskody_notch_result(failed ? "Test: save failed" : NULL);
    });
}
static NSString *coverFixture(void) {
    NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(200,200)];
    [image lockFocus];
    NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:[NSColor colorWithRed:.18 green:.12 blue:.36 alpha:1]
        endingColor:[NSColor colorWithRed:.88 green:.48 blue:.32 alpha:1]];
    [gradient drawInRect:NSMakeRect(0,0,200,200) angle:60];
    [[NSColor colorWithWhite:1 alpha:.7] setStroke];
    for (NSUInteger i=0; i<7; i++) {
        NSBezierPath *circle = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(40+i*6,40+i*6,120-i*12,120-i*12)];
        circle.lineWidth = 1; [circle stroke];
    }
    [@"NIGHT DRIVE" drawAtPoint:NSMakePoint(23,170) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:16 weight:NSFontWeightBold], NSForegroundColorAttributeName:NSColor.whiteColor}];
    [image unlockFocus];
    NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:image.TIFFRepresentation];
    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
}
static void capture(NSString *path) {
    NSBitmapImageRep *image = [notchHost.root bitmapImageRepForCachingDisplayInRect:notchHost.root.bounds];
    [notchHost.root cacheDisplayInRect:notchHost.root.bounds toBitmapImageRep:image];
    [[image representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
}
static void move(NSPoint global) {
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
    CGWarpMouseCursorPosition(CGPointMake(global.x, top-global.y));
    [notchHost updatePointer:global];
}
static NSPoint inside(void) {
    return NSMakePoint(NSMidX(notchHost.panel.frame), NSMaxY(notchHost.panel.frame)-notchHost.notchSize.height-100);
}
@interface NotchTest : NSObject <NSApplicationDelegate>
@property NSInteger stage;
@property pid_t foreground;
@property pid_t expected;
@property NSPoint originalPointer;
@property(strong) NSTimer *timer;
@end
@implementation NotchTest
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.foreground = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    if (self.expected) check(self.foreground == self.expected, @"external fullscreen fixture is active");
    check(self.foreground != NSProcessInfo.processInfo.processIdentifier, @"another app is active before notch launch");
    self.originalPointer = NSEvent.mouseLocation;
    // A user may already be hovering the real notch when this fixture starts.
    NSScreen *screen = NSScreen.screens.firstObject;
    move(NSMakePoint(NSMidX(screen.frame), NSMinY(screen.frame)+80));
    NSDictionary *data = @{
        @"settings":@{@"enabled":@YES,@"notchEnabled":@YES,@"language":@"en",@"rules":@[@{@"id":@"study",@"name":@"Deep work"}]},
        @"status":@{@"activeRule":@"study",@"manualOverride":@NO,@"player":@{
            @"id":@"browser:music.youtube.com",@"name":@"YouTube Music",@"trackId":@"track-a",@"track":@"Night Drive",@"artist":@"Chromatic City",
            @"artwork":coverFixture(),@"duration":@212,@"position":@34,@"playing":@YES,@"sampledAt":@(NSDate.date.timeIntervalSince1970),
            @"canSeek":@YES,@"canNext":@YES,@"canPrevious":@YES,@"canPause":@YES,@"canPlay":@YES}},
        @"translations":[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@"locales/en.json"] options:0 error:nil]
    };
    fixture = [NSJSONSerialization JSONObjectWithData:[NSJSONSerialization dataWithJSONObject:data options:0 error:nil] options:NSJSONReadingMutableContainers error:nil];
    publish();
    check(deskody_notch_create(action), @"native notch created");
    self.timer = [NSTimer scheduledTimerWithTimeInterval:.6 target:self selector:@selector(step:) userInfo:nil repeats:YES];
}
- (void)step:(NSTimer *)timer {
    check(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == self.foreground,
        [NSString stringWithFormat:@"notch preserves foreground application (expected %d, actual %d)",
            self.foreground, NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier]);
    switch (self.stage++) {
        case 0: {
            check(notchHost.panel.visible && notchHost.panel.onActiveSpace, @"notch visible in current Space");
            check(!notchHost.expanded && notchHost.panel.ignoresMouseEvents && !notchHost.progressTimer, @"collapsed notch passes clicks through and has no fast timer");
            check(notchHost.globalMonitor && notchHost.localMonitor && notchHost.compactTimer, @"mouse-only observation installed without keyboard hooks");
            check(fabs(NSMidX(notchHost.panel.frame)-NSMidX(notchHost.screen.frame)) < .1, @"notch centered on its screen in points");
            check(notchHost.body.frame.origin.y > notchHost.notchSize.height, @"expanded media stays below camera safe area");
            capture(@"/tmp/deskody-notch-compact.png");
            move(NSMakePoint(NSMidX(notchHost.panel.frame),NSMaxY(notchHost.panel.frame)-notchHost.notchSize.height+2));
            check(!notchHost.expanded, @"hover delay prevents accidental expansion");
            break;
        }
        case 1: {
            check(notchHost.expanded && notchHost.progressTimer && !notchHost.panel.ignoresMouseEvents, @"hover expands native controls without activation");
            move(inside());
            check(notchHost.seek.enabled && notchHost.next.enabled && notchHost.previous.enabled, @"media capabilities enable native controls");
            check(notchHost.cover.image && !notchHost.cover.contentTintColor, @"artwork decoded locally");
            check(notchHost.openedRect.size.height-notchHost.notchSize.height <= 172, @"expanded layout is vertically compact");
            CAKeyframeAnimation *morph = (CAKeyframeAnimation *)[notchHost.shape animationForKey:@"morph"];
            check(morph.duration >= .6, @"opening uses a gentle animation duration");
            CGRect first = CGPathGetBoundingBox((__bridge CGPathRef)morph.values.firstObject);
            CGRect last = CGPathGetBoundingBox((__bridge CGPathRef)morph.values.lastObject);
            BOOL bounded = YES;
            for (id value in morph.values) {
                CGRect frame = CGPathGetBoundingBox((__bridge CGPathRef)value);
                bounded &= frame.size.height >= first.size.height-.01 && frame.size.height <= last.size.height+.01;
            }
            check(bounded, @"opening geometry never overshoots");
            capture(@"/tmp/deskody-notch-expanded.png");
            NSPoint nextPoint = [notchHost.next convertPoint:NSMakePoint(18,17) toView:notchHost.root.superview];
            NSView *hit = [notchHost.root hitTest:nextPoint];
            check(hit == notchHost.next || [hit isDescendantOf:notchHost.next], @"expanded controls receive real AppKit hit testing");
            [notchHost.next performClick:nil];
            break;
        }
        case 2:
            check([lastTransport[@"action"][@"kind"] isEqual:@"next"] && [lastTransport[@"playerId"] isEqual:@"browser:music.youtube.com"], @"next targets selected player");
            [notchHost.previous performClick:nil];
            break;
        case 3:
            check([lastTransport[@"action"][@"kind"] isEqual:@"previous"], @"previous routes through shared transport");
            fixture[@"status"][@"player"][@"playing"] = @NO;
            [notchHost applySnapshot:fixture];
            notchHost.seek.doubleValue = 75;
            [notchHost seekChanged:notchHost.seek];
            break;
        case 4:
            check([lastTransport[@"action"][@"trackId"] isEqual:@"track-a"] && [lastTransport[@"action"][@"position"] doubleValue] == 75, @"seek carries captured track identity and seconds");
            check([notchHost.elapsed.stringValue isEqual:@"1:15"] && [fixture[@"status"][@"player"][@"playing"] isEqual:@NO], @"paused seeking keeps music paused");
            check(notchHost.expanded && notchHost.flow.enabled && !notchHost.busy,
                [NSString stringWithFormat:@"flow control ready after seek completion (expanded=%d, enabled=%d, busy=%d, pointer=%@, actual=%@)",
                    notchHost.expanded, notchHost.flow.enabled, notchHost.busy,
                    NSStringFromPoint(notchHost.lastPointer), NSStringFromPoint(NSEvent.mouseLocation)]);
            failNext = YES; [notchHost.flow performClick:nil];
            break;
        case 5:
            check(!notchHost.busy && [fixture[@"settings"][@"enabled"] isEqual:@YES] && [notchHost.errorLabel.stringValue containsString:@"save failed"], @"failed quick action retains committed state and shows error");
            [notchHost.flow performClick:nil];
            break;
        case 6: {
            check([fixture[@"settings"][@"enabled"] isEqual:@NO], @"flow toggle commits through service action");
            NSPoint p = inside(); move(NSMakePoint(p.x+400,p.y-100));
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{ move(p); });
            break;
        }
        case 7: {
            check(notchHost.expanded, @"returning during close grace cancels dismissal");
            NSPoint p = inside(); move(NSMakePoint(p.x+400,p.y-100));
            break;
        }
        case 8:
            check(!notchHost.expanded && !notchHost.progressTimer && notchHost.panel.ignoresMouseEvents, @"pointer exit collapses and restores click-through");
            fixture[@"settings"][@"notchEnabled"] = @NO; publish();
            break;
        case 9:
            check(!notchHost.panel.visible && !notchHost.globalMonitor && !notchHost.localMonitor && !notchHost.compactTimer, @"disabled setting removes panel, monitors and polling timer");
            move(NSMakePoint(NSMidX(notchHost.screen.frame), NSMinY(notchHost.screen.frame)+80));
            fixture[@"settings"][@"notchEnabled"] = @YES; publish();
            break;
        case 10:
            check(notchHost.panel.visible && !notchHost.expanded,
                [NSString stringWithFormat:@"reenabling restores collapsed notch (visible=%d, expanded=%d)", notchHost.panel.visible, notchHost.expanded]);
            [notchHost suspend:nil];
            check(!notchHost.panel.visible && !notchHost.compactTimer && !notchHost.globalMonitor, @"sleep/session suspension releases observation");
            [notchHost wake:nil];
            check(notchHost.panel.visible && !notchHost.expanded, @"wake restores geometry without expanding");
            notchHost.reducedMotion = YES;
            move(inside()); [notchHost setExpanded:YES animated:YES];
            check(![notchHost.shape animationForKey:@"morph"] && ![notchHost.bars[0] animationForKey:@"playing"], @"Reduce Motion disables morph and decorative animation");
            fixture[@"status"][@"player"][@"canSeek"] = @NO;
            fixture[@"status"][@"player"][@"canNext"] = @NO;
            [notchHost applySnapshot:fixture];
            check(!notchHost.seek.enabled && !notchHost.next.enabled, @"unsupported controls disabled");
            [notchHost spaceChanged:nil];
            check(!notchHost.expanded && notchHost.panel.onActiveSpace, @"Space changes collapse without moving applications");
            break;
        case 11: {
            fixture[@"settings"][@"notchNowPlaying"] = @NO;
            [notchHost applySnapshot:fixture];
            check(notchHost.compact.hidden && !notchHost.compactTimer && !notchHost.visualizing,
                @"hiding collapsed now-playing removes artwork, animation and polling");
            check(fabs(notchHost.closedRect.size.width-notchHost.notchSize.width)<.01 && notchHost.globalMonitor,
                @"plain notch uses physical width and keeps hover monitoring");
            capture(@"/tmp/deskody-notch-plain.png");
            move(NSMakePoint(NSMidX(notchHost.panel.frame),NSMaxY(notchHost.panel.frame)-notchHost.notchSize.height+2));
            break;
        }
        case 12: {
            check(notchHost.expanded && notchHost.play.enabled, @"hover controls still work with collapsed indicator disabled");
            move(inside());
            [notchHost setExpanded:NO animated:YES];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW,80*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
                CGPathRef presentation = ((CAShapeLayer *)notchHost.shape.presentationLayer).path;
                check(presentation != NULL, @"closing has intermediate presentation geometry");
                CGRect before = CGPathGetBoundingBox(presentation);
                [notchHost setExpanded:YES animated:YES];
                CAKeyframeAnimation *reverse = (CAKeyframeAnimation *)[notchHost.shape animationForKey:@"morph"];
                CGRect after = CGPathGetBoundingBox((__bridge CGPathRef)reverse.values.firstObject);
                check(fabs(before.size.height-after.size.height)<.1 && fabs(before.size.width-after.size.width)<.1,
                    @"rapid hover reversal continues from current geometry without a jump");
            });
            break;
        }
        case 13:
            fixture[@"settings"][@"notchNowPlaying"] = @YES;
            [notchHost applySnapshot:fixture];
            check(notchHost.expanded && notchHost.compactTimer && !notchHost.compact.hidden,
                @"restoring collapsed indicator preserves open controls and renews compact observation");
            [notchHost setExpanded:NO animated:NO];
            break;
        case 14: {
            DeskodyNotchHost *host = notchHost;
            deskody_notch_destroy();
            check(!host.globalMonitor && !host.localMonitor && !host.compactTimer && !host.progressTimer && !host.panel.visible, @"teardown releases native resources");
            move(self.originalPointer);
            check(mediaCommands == 5, @"only explicit test controls produced media commands");
            [self.timer invalidate]; [NSApp terminate:nil];
            break;
        }
        default: check(NO,@"test should complete");
    }
}
@end
int main(int argc, const char **argv) { @autoreleasepool {
    [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NotchTest *test = [NotchTest new]; if (argc>1) test.expected = atoi(argv[1]); NSApp.delegate = test;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25*NSEC_PER_SEC),dispatch_get_main_queue(),^{ check(NO,@"notch test timed out"); });
    [NSApp run]; return 0;
} }
