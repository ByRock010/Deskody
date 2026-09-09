#import <Cocoa/Cocoa.h>
@interface FocusHost : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(strong) NSWindow *window;
@property(copy) NSString *marker;
@property BOOL fullscreen;
@end
@implementation FocusHost
- (void)ready {
    [@"ready" writeToFile:[self.marker stringByAppendingString:@".ready"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(120,120,800,500)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable | NSWindowStyleMaskClosable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.releasedWhenClosed = NO;
    self.window.title = @"Deskody · Spotify odak testi";
    self.window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    self.window.delegate = self;
    NSTextField *label = [NSTextField labelWithString:@"Spotify masaüstü oynatması test ediliyor.\nBu geçici pencere otomatik kapanacak."];
    label.frame = NSMakeRect(40, 180, 720, 100);
    label.font = [NSFont systemFontOfSize:24];
    [self.window.contentView addSubview:label];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (self.fullscreen) [self.window toggleFullScreen:nil]; else [self ready];
    });
    [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        if ([NSFileManager.defaultManager fileExistsAtPath:[self.marker stringByAppendingString:@".stop"]]) {
            BOOL valid = self.window.onActiveSpace && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == getpid()
                && (!self.fullscreen || (self.window.styleMask & NSWindowStyleMaskFullScreen));
            printf("Host: original window/Space/foreground preserved: %d\n", valid);
            exit(valid ? 0 : 1);
        }
    }];
}
- (void)windowDidEnterFullScreen:(NSNotification *)notification { [self ready]; }
@end
int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc != 3) return 2;
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    FocusHost *host = [FocusHost new];
    host.marker = [NSString stringWithUTF8String:argv[1]];
    host.fullscreen = strcmp(argv[2], "fullscreen") == 0;
    NSApp.delegate = host;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30*NSEC_PER_SEC), dispatch_get_main_queue(), ^{ exit(3); });
    [NSApp run];
    return 0;
} }
