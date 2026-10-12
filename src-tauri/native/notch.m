#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import "notch.h"

static NSString *dnText(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }
static NSString *dnL(NSDictionary *snapshot, NSString *key) {
    if ([snapshot[@"settings"][@"language"] isEqual:@"tr"]) return key;
    NSString *value = dnText(snapshot[@"translations"][key]);
    return value.length ? value : key;
}
static NSImage *dnSymbol(NSString *name) { return [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil]; }
static NSString *dnTime(double value) {
    if (!isfinite(value) || value < 0) return @"—:—";
    NSInteger s = (NSInteger)value;
    return s >= 3600 ? [NSString stringWithFormat:@"%ld:%02ld:%02ld", (long)(s/3600), (long)((s/60)%60), (long)(s%60)]
        : [NSString stringWithFormat:@"%ld:%02ld", (long)(s/60), (long)(s%60)];
}
// Public screen APIs, in AppKit points; never hardcode Retina pixel dimensions.
static NSSize dnNotchSize(NSScreen *screen) {
    CGFloat height = screen.safeAreaInsets.top;
    if (height <= 0) return NSMakeSize(180, 28);
    CGFloat width = screen.frame.size.width - screen.auxiliaryTopLeftArea.size.width - screen.auxiliaryTopRightArea.size.width;
    if (width < 80 || width > 400) width = 180;
    return NSMakeSize(width, MAX(24, height));
}
// Identical path topology in both states permits smooth, interruptible interpolation.
static CGPathRef dnPath(CGRect r) CF_RETURNS_RETAINED;
static CGPathRef dnPath(CGRect r) {
    CGFloat x = r.origin.x, y = r.origin.y, w = r.size.width, h = r.size.height;
    CGFloat radius = MIN(24, h * .45), ear = MIN(9, h * .25);
    CGMutablePathRef p = CGPathCreateMutable();
    CGPathMoveToPoint(p, NULL, x-ear, y);
    CGPathAddCurveToPoint(p, NULL, x, y, x, y+ear/2, x, y+ear);
    CGPathAddLineToPoint(p, NULL, x, y+h-radius);
    CGPathAddCurveToPoint(p, NULL, x, y+h-radius*.4, x+radius*.4, y+h, x+radius, y+h);
    CGPathAddLineToPoint(p, NULL, x+w-radius, y+h);
    CGPathAddCurveToPoint(p, NULL, x+w-radius*.4, y+h, x+w, y+h-radius*.4, x+w, y+h-radius);
    CGPathAddLineToPoint(p, NULL, x+w, y+ear);
    CGPathAddCurveToPoint(p, NULL, x+w, y+ear/2, x+w, y, x+w+ear, y);
    CGPathCloseSubpath(p);
    return p;
}

@interface DeskodyNotchPanel : NSPanel
@end
@implementation DeskodyNotchPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end
@interface DeskodyNotchView : NSView
@end
@implementation DeskodyNotchView
- (BOOL)isFlipped { return YES; }
- (BOOL)allowsVibrancy { return YES; }
@end
// Decorative wings never intercept controls while fading through an expansion.
@interface DeskodyNotchDecoration : DeskodyNotchView
@end
@implementation DeskodyNotchDecoration
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end
@interface DeskodyNotchButton : NSButton
@property(strong) NSTrackingArea *hoverArea;
@end
@implementation DeskodyNotchButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)needsPanelToBecomeKey { return NO; }
- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (self.hoverArea) [self removeTrackingArea:self.hoverArea];
    self.hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil];
    [self addTrackingArea:self.hoverArea];
}
- (void)mouseEntered:(NSEvent *)event { if (self.enabled) self.layer.backgroundColor = [NSColor colorWithWhite:1 alpha:.1].CGColor; }
- (void)mouseExited:(NSEvent *)event { self.layer.backgroundColor = NSColor.clearColor.CGColor; }
@end
@class DeskodyNotchHost;
@interface DeskodyNotchSlider : NSSlider
@property(weak) DeskodyNotchHost *host;
@property(copy) NSString *playerID;
@property(copy) NSString *trackID;
@property BOOL dragging;
@end
@interface DeskodyNotchHost : NSObject
@property DeskodyMenuAction callback;
@property(strong) NSDictionary *snapshot;
@property(strong) DeskodyNotchPanel *panel;
@property(strong) NSScreen *screen;
@property(strong) DeskodyNotchView *root;
@property(strong) NSView *body;
@property(strong) NSView *compact;
@property(strong) CAShapeLayer *shape;
@property(strong) CAShapeLayer *clip;
@property(strong) CAGradientLayer *glow;
@property(strong) NSTextField *titleLabel;
@property(strong) NSTextField *artistLabel;
@property(strong) NSTextField *sourceLabel;
@property(strong) NSTextField *elapsed;
@property(strong) NSTextField *duration;
@property(strong) NSTextField *errorLabel;
@property(strong) NSTextField *contextLabel;
@property(strong) NSImageView *cover;
@property(strong) NSImageView *miniCover;
@property(strong) NSButton *previous;
@property(strong) NSButton *play;
@property(strong) NSButton *next;
@property(strong) NSButton *flow;
@property(strong) NSButton *open;
@property(strong) NSButton *collapse;
@property(strong) NSButton *resume;
@property(strong) DeskodyNotchSlider *seek;
@property(strong) NSArray<CALayer *> *bars;
@property(strong) id globalMonitor;
@property(strong) id localMonitor;
@property(strong) NSTimer *compactTimer;
@property(strong) NSTimer *progressTimer;
@property(strong) NSTimer *hoverTimer;
@property(strong) NSTimer *closeTimer;
@property(copy) NSString *artworkSource;
@property(copy) NSString *localError;
@property BOOL expanded;
@property BOOL busy;
@property BOOL suspended;
@property BOOL enabled;
@property BOOL showNowPlaying;
@property BOOL reducedMotion;
@property BOOL visualizing;
@property NSPoint lastPointer;
@property NSSize notchSize;
@property NSRect closedRect;
@property NSRect openedRect;
@property NSTimeInterval lastObserve;
- (void)applySnapshot:(NSDictionary *)snapshot;
- (void)updatePointer:(NSPoint)point;
- (void)setExpanded:(BOOL)expanded animated:(BOOL)animated;
- (void)syncMedia;
- (void)stop;
@end
@implementation DeskodyNotchSlider
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)needsPanelToBecomeKey { return NO; }
- (void)mouseDown:(NSEvent *)event {
    self.dragging = YES;
    [super mouseDown:event];
    self.dragging = NO;
    [self.host updatePointer:NSEvent.mouseLocation];
}
@end
static NSTextField *dnLabel(NSView *parent, NSRect frame, CGFloat size, BOOL bold) {
    NSTextField *view = [NSTextField labelWithString:@""];
    view.frame = frame;
    view.font = [NSFont systemFontOfSize:size weight:bold ? NSFontWeightSemibold : NSFontWeightRegular];
    view.textColor = bold ? NSColor.whiteColor : [NSColor colorWithWhite:1 alpha:.5];
    view.lineBreakMode = NSLineBreakByTruncatingTail;
    [parent addSubview:view];
    return view;
}
static NSButton *dnButton(NSView *parent, NSRect frame, NSString *symbol, id target, SEL action) {
    DeskodyNotchButton *button = [DeskodyNotchButton buttonWithImage:dnSymbol(symbol) target:target action:action];
    button.frame = frame; button.bordered = NO;
    button.imageScaling = NSImageScaleProportionallyDown;
    button.contentTintColor = NSColor.whiteColor;
    button.wantsLayer = YES; button.layer.cornerRadius = 10;
    [parent addSubview:button];
    return button;
}
@implementation DeskodyNotchHost
- (instancetype)init {
    if (!(self = [super init])) return nil;
    self.panel = [[DeskodyNotchPanel alloc] initWithContentRect:NSMakeRect(0, 0, 464, 280)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    self.panel.title = @"Deskody Notch";
    self.panel.releasedWhenClosed = NO;
    self.panel.floatingPanel = YES; self.panel.hidesOnDeactivate = NO;
    self.panel.becomesKeyOnlyIfNeeded = YES;
    self.panel.level = NSMainMenuWindowLevel + 1;
    self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary
        | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle;
    if ([NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){13, 0, 0}]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
        self.panel.collectionBehavior |= NSWindowCollectionBehaviorCanJoinAllApplications;
#pragma clang diagnostic pop
    }
    self.panel.opaque = NO; self.panel.backgroundColor = NSColor.clearColor;
    self.panel.hasShadow = NO; self.panel.movable = NO;
    self.panel.animationBehavior = NSWindowAnimationBehaviorNone;
    self.panel.ignoresMouseEvents = YES;
    self.panel.acceptsMouseMovedEvents = YES;
    self.root = [[DeskodyNotchView alloc] initWithFrame:NSMakeRect(0, 0, 464, 280)];
    self.root.wantsLayer = YES;
    [self.root setAccessibilityLabel:@"Deskody Notch"];
    self.panel.contentView = self.root;
    self.shape = [CAShapeLayer layer]; self.shape.fillColor = NSColor.blackColor.CGColor;
    self.shape.strokeColor = [NSColor colorWithWhite:1 alpha:.09].CGColor; self.shape.lineWidth = .5;
    self.shape.shadowColor = NSColor.blackColor.CGColor; self.shape.shadowOpacity = .4;
    self.shape.shadowRadius = 12; self.shape.shadowOffset = CGSizeMake(0, 6);
    [self.root.layer addSublayer:self.shape];
    NSView *clipped = [[DeskodyNotchView alloc] initWithFrame:self.root.bounds];
    clipped.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    clipped.wantsLayer = YES; self.clip = [CAShapeLayer layer]; clipped.layer.mask = self.clip;
    [self.root addSubview:clipped];
    self.glow = [CAGradientLayer layer];
    self.glow.colors = @[(id)[NSColor colorWithRed:.07 green:.055 blue:.09 alpha:1].CGColor, (id)NSColor.blackColor.CGColor];
    self.glow.startPoint = CGPointMake(0, 1); self.glow.endPoint = CGPointMake(1, 0);
    [clipped.layer addSublayer:self.glow];
    self.body = [[DeskodyNotchView alloc] initWithFrame:NSMakeRect(12, 0, 440, 260)];
    self.body.wantsLayer = YES; [clipped addSubview:self.body];
    self.compact = [[DeskodyNotchDecoration alloc] initWithFrame:clipped.bounds];
    self.compact.wantsLayer = YES; [clipped addSubview:self.compact];
    self.cover = [[NSImageView alloc] initWithFrame:NSMakeRect(24, 8, 56, 56)];
    self.cover.imageScaling = NSImageScaleProportionallyUpOrDown;
    self.cover.wantsLayer = YES; self.cover.layer.cornerRadius = 12; self.cover.layer.masksToBounds = YES;
    [self.body addSubview:self.cover];
    self.miniCover = [[NSImageView alloc] initWithFrame:NSZeroRect];
    self.miniCover.imageScaling = NSImageScaleProportionallyUpOrDown;
    self.miniCover.wantsLayer = YES; self.miniCover.layer.cornerRadius = 5; self.miniCover.layer.masksToBounds = YES;
    [self.compact addSubview:self.miniCover];
    NSMutableArray *bars = [NSMutableArray new];
    for (NSUInteger i=0; i<4; i++) {
        CALayer *bar = [CALayer layer]; bar.backgroundColor = [NSColor colorWithWhite:.9 alpha:1].CGColor;
        bar.cornerRadius = 1.5; [self.compact.layer addSublayer:bar]; [bars addObject:bar];
    }
    self.bars = bars;
    self.sourceLabel = dnLabel(self.body, NSMakeRect(96, 8, 315, 13), 10, NO);
    self.titleLabel = dnLabel(self.body, NSMakeRect(96, 24, 315, 21), 16, YES);
    self.artistLabel = dnLabel(self.body, NSMakeRect(96, 47, 315, 17), 12, NO);
    self.seek = [[DeskodyNotchSlider alloc] initWithFrame:NSMakeRect(23, 69, 394, 16)];
    self.seek.host = self; self.seek.continuous = NO;
    self.seek.target = self; self.seek.action = @selector(seekChanged:);
    self.seek.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    [self.body addSubview:self.seek];
    self.elapsed = dnLabel(self.body, NSMakeRect(25, 87, 80, 13), 10, NO);
    self.duration = dnLabel(self.body, NSMakeRect(335, 87, 80, 13), 10, NO);
    self.duration.alignment = NSTextAlignmentRight;
    self.elapsed.font = self.duration.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
    self.previous = dnButton(self.body, NSMakeRect(148, 104, 32, 30), @"backward.end.fill", self, @selector(previousPressed:));
    self.play = dnButton(self.body, NSMakeRect(202, 100, 36, 36), @"play.fill", self, @selector(playPressed:));
    self.next = dnButton(self.body, NSMakeRect(260, 104, 32, 30), @"forward.end.fill", self, @selector(nextPressed:));
    self.play.image = [dnSymbol(@"play.fill") imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:24 weight:NSFontWeightSemibold]];
    self.flow = dnButton(self.body, NSMakeRect(24, 140, 110, 24), @"waveform.circle", self, @selector(flowPressed:));
    self.flow.imagePosition = NSImageLeading; self.flow.font = [NSFont systemFontOfSize:10 weight:NSFontWeightMedium];
    self.contextLabel = dnLabel(self.body, NSMakeRect(146, 144, 269, 15), 10, NO);
    self.contextLabel.alignment = NSTextAlignmentRight;
    self.resume = dnButton(self.body, NSMakeRect(376, 104, 30, 30), @"arrow.counterclockwise", self, @selector(resumePressed:));
    self.errorLabel = dnLabel(self.body, NSMakeRect(24, 174, 394, 28), 10, NO);
    self.errorLabel.textColor = [NSColor colorWithRed:1 green:.66 blue:.55 alpha:1];
    self.errorLabel.maximumNumberOfLines = 2;
    self.open = dnButton(clipped, NSMakeRect(28, 4, 30, 24), @"arrow.up.right", self, @selector(openPressed:));
    self.collapse = dnButton(clipped, NSMakeRect(406, 4, 30, 24), @"chevron.up", self, @selector(collapsePressed:));
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(screenChanged:) name:NSApplicationDidChangeScreenParametersNotification object:nil];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[NSWorkspaceWillSleepNotification, NSWorkspaceScreensDidSleepNotification, NSWorkspaceSessionDidResignActiveNotification])
        [workspace addObserver:self selector:@selector(suspend:) name:name object:nil];
    for (NSNotificationName name in @[NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification])
        [workspace addObserver:self selector:@selector(wake:) name:name object:nil];
    [workspace addObserver:self selector:@selector(spaceChanged:) name:NSWorkspaceActiveSpaceDidChangeNotification object:nil];
    [workspace addObserver:self selector:@selector(accessibilityChanged:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
    return self;
}
- (void)layoutOnScreen:(NSScreen *)screen {
    self.screen = screen;
    self.notchSize = dnNotchSize(screen);
    CGFloat width = MIN(464, screen.frame.size.width - 32);
    // Compact/expanded content is constrained to desktop-size displays; NSPanel has no webview.
    [self.panel setFrame:NSMakeRect(NSMidX(screen.frame)-width/2, NSMaxY(screen.frame)-self.notchSize.height-280, width, self.notchSize.height+280) display:NO];
    [self.root setFrame:NSMakeRect(0, 0, width, self.notchSize.height+280)];
    self.shape.frame = self.root.bounds; self.clip.frame = self.root.bounds;
    CGFloat center = width/2;
    [self updateClosedRect];
    self.openedRect = NSMakeRect(12, 0, width-24, self.notchSize.height+172);
    self.body.frame = NSMakeRect(12, self.notchSize.height+3, width-24, 260);
    self.glow.frame = self.openedRect;
    CGFloat miniSize = MIN(22, self.notchSize.height-8);
    self.miniCover.frame = NSMakeRect(center-self.notchSize.width/2-29, (self.notchSize.height-miniSize)/2, miniSize, miniSize);
    for (NSUInteger i=0; i<self.bars.count; i++) self.bars[i].frame = CGRectMake(center+self.notchSize.width/2+9+i*4, self.notchSize.height/2-6, 2.5, 12);
    self.collapse.frame = NSMakeRect(width-58, 3, 30, self.notchSize.height-5);
    self.open.frame = NSMakeRect(28, 3, 30, self.notchSize.height-5);
    self.panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    [self setExpanded:NO animated:NO];
}
- (void)updateClosedRect {
    CGFloat wings = self.showNowPlaying ? 36 : 0;
    self.closedRect = NSMakeRect(self.root.bounds.size.width/2-self.notchSize.width/2-wings, 0,
        self.notchSize.width+wings*2, self.notchSize.height+(self.showNowPlaying ? 2 : 0));
}
- (void)updateCompactObservation {
    BOOL observe = self.enabled && self.showNowPlaying && !self.suspended && self.globalMonitor;
    if (!observe) { [self.compactTimer invalidate]; self.compactTimer = nil; return; }
    if (self.compactTimer) return;
    __weak DeskodyNotchHost *weakSelf = self;
    self.compactTimer = [NSTimer timerWithTimeInterval:5 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
        DeskodyNotchHost *host = weakSelf;
        if (host.enabled && host.showNowPlaying && !host.suspended) host.callback("observeCompact", "", false);
    }];
    self.compactTimer.tolerance = 1;
    [NSRunLoop.mainRunLoop addTimer:self.compactTimer forMode:NSRunLoopCommonModes];
    self.callback("observeCompact", "", false);
}
- (void)screenChanged:(NSNotification *)notification {
    if (!self.enabled || self.suspended) return;
    NSScreen *screen = nil;
    for (NSScreen *candidate in NSScreen.screens) if (candidate.safeAreaInsets.top > 0) { screen = candidate; break; }
    screen = screen ?: NSScreen.screens.firstObject;
    if (!screen) { [self stopInteraction]; self.screen = nil; [self.panel orderOut:nil]; return; }
    [self layoutOnScreen:screen];
    [self startInteraction];
    [self.panel orderFrontRegardless];
    [self syncMedia];
}
- (void)suspend:(NSNotification *)notification {
    self.suspended = YES; [self stopInteraction]; [self.panel orderOut:nil];
}
- (void)wake:(NSNotification *)notification { self.suspended = NO; [self screenChanged:nil]; }
- (void)spaceChanged:(NSNotification *)notification {
    [self setExpanded:NO animated:NO];
    if (self.enabled && !self.suspended && self.screen) [self.panel orderFrontRegardless];
}
- (void)accessibilityChanged:(NSNotification *)notification {
    self.reducedMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    self.visualizing = NO; [self syncMedia];
    [self setExpanded:self.expanded animated:NO];
}
- (void)startInteraction {
    if (self.globalMonitor) return;
    __weak DeskodyNotchHost *weakSelf = self;
    NSEventMask mask = NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown;
    self.globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent *event) {
        DeskodyNotchHost *host = weakSelf;
        if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown) {
            [host setExpanded:NO animated:YES];
        } else [host updatePointer:NSEvent.mouseLocation];
    }];
    self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
        DeskodyNotchHost *host = weakSelf;
        if ((event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown) && event.window != host.panel)
            [host setExpanded:NO animated:YES];
        else [host updatePointer:NSEvent.mouseLocation];
        return event;
    }];
    [self updateCompactObservation];
}
- (void)stopInteraction {
    if (self.globalMonitor) [NSEvent removeMonitor:self.globalMonitor];
    if (self.localMonitor) [NSEvent removeMonitor:self.localMonitor];
    self.globalMonitor = nil; self.localMonitor = nil;
    [self.compactTimer invalidate]; self.compactTimer = nil;
    [self setExpanded:NO animated:NO];
    self.panel.ignoresMouseEvents = YES;
    for (CALayer *bar in self.bars) [bar removeAllAnimations];
    self.visualizing = NO;
}
- (NSPoint)localPoint:(NSPoint)global {
    return NSMakePoint(global.x-NSMinX(self.panel.frame), NSMaxY(self.panel.frame)-global.y);
}
- (void)updatePointer:(NSPoint)point {
    if (!self.enabled || self.suspended || !self.panel.visible) return;
    self.lastPointer = point;
    NSPoint local = [self localPoint:point];
    BOOL sameScreen = NSPointInRect(point, self.screen.frame);
    if (self.seek.dragging) return;
    if (self.expanded) {
        BOOL retained = sameScreen && NSPointInRect(local, NSInsetRect(self.openedRect, -10, -8));
        CGPathRef path = dnPath(self.openedRect);
        self.panel.ignoresMouseEvents = !sameScreen || !CGPathContainsPoint(path, NULL, local, false);
        CGPathRelease(path);
        [self.hoverTimer invalidate]; self.hoverTimer = nil;
        if (retained) { [self.closeTimer invalidate]; self.closeTimer = nil; }
        else if (!self.closeTimer) {
            __weak DeskodyNotchHost *weakSelf = self;
            self.closeTimer = [NSTimer scheduledTimerWithTimeInterval:.38 repeats:NO block:^(NSTimer *timer) {
        (void)timer;
                [weakSelf setExpanded:NO animated:YES];
            }];
        }
    } else {
        self.panel.ignoresMouseEvents = YES;
        // Do not activate from an adjacent display above the laptop or while dragging files.
        BOOL hovering = sameScreen && NSPointInRect(local, NSInsetRect(self.closedRect, 0, -4)) && NSEvent.pressedMouseButtons == 0;
        if (!hovering) { [self.hoverTimer invalidate]; self.hoverTimer = nil; }
        else if (!self.hoverTimer) {
            __weak DeskodyNotchHost *weakSelf = self;
            self.hoverTimer = [NSTimer scheduledTimerWithTimeInterval:.14 repeats:NO block:^(NSTimer *timer) {
        (void)timer;
                DeskodyNotchHost *host = weakSelf;
                NSPoint pointer = [host localPoint:host.lastPointer];
                if (host.enabled && !host.suspended && NSPointInRect(pointer, NSInsetRect(host.closedRect, 0, -4))) [host setExpanded:YES animated:YES];
                host.hoverTimer = nil;
            }];
        }
    }
}
- (void)setExpanded:(BOOL)expanded animated:(BOOL)animated {
    [self.hoverTimer invalidate]; self.hoverTimer = nil;
    [self.closeTimer invalidate]; self.closeTimer = nil;
    BOOL changed = self.expanded != expanded;
    self.expanded = expanded;
    CGRect target = expanded ? self.openedRect : self.closedRect;
    CGPathRef presented = ((CAShapeLayer *)self.shape.presentationLayer).path ?: self.shape.path;
    CGRect start = presented ? CGPathGetBoundingBox(presented) : target;
    if (presented) {
        CGFloat ear = MIN(9, start.size.height*.25);
        start.origin.x += ear; start.size.width = MAX(0, start.size.width-ear*2);
    }
    BOOL geometryChanged = !CGRectEqualToRect(start, target);
    BOOL animate = animated && geometryChanged && !self.reducedMotion;
    // Read presentation values before replacing animations: hover reversals stay continuous.
    CALayer *bodyPresentation = self.body.layer.presentationLayer;
    float bodyOpacity = bodyPresentation ? bodyPresentation.opacity : self.body.layer.opacity;
    CALayer *compactPresentation = self.compact.layer.presentationLayer;
    float compactOpacity = compactPresentation ? compactPresentation.opacity : self.compact.layer.opacity;
    CGPathRef path = dnPath(target);
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    self.shape.path = path; self.shape.shadowPath = path; self.clip.path = path;
    self.body.layer.opacity = expanded ? 1 : 0;
    self.glow.opacity = expanded ? 1 : 0;
    self.compact.layer.opacity = !expanded && self.showNowPlaying ? 1 : 0;
    // hitTest:nil permits crossfading the decorative view above interactive controls.
    self.compact.hidden = !self.showNowPlaying;
    self.open.hidden = self.collapse.hidden = !expanded;
    [CATransaction commit];
    if (animate) {
        NSMutableArray *values = [NSMutableArray new];
        for (NSUInteger i=0; i<=60; i++) {
            double t = (double)i/60;
            // Critically damped, zero initial velocity and no overshoot; a quiet landing.
            double progress = (1-exp(-8*t)*(1+8*t)) / (1-exp(-8)*9);
            CGRect r = CGRectMake(start.origin.x+(target.origin.x-start.origin.x)*progress, 0,
                start.size.width+(target.size.width-start.size.width)*progress,
                start.size.height+(target.size.height-start.size.height)*progress);
            CGPathRef step = dnPath(r); [values addObject:(__bridge id)step]; CGPathRelease(step);
        }
        CAKeyframeAnimation *morph = [CAKeyframeAnimation animationWithKeyPath:@"path"];
        morph.values = values; morph.duration = expanded ? .62 : .52;
        [self.shape addAnimation:morph forKey:@"morph"]; [self.clip addAnimation:morph forKey:@"morph"];
        CAKeyframeAnimation *shadow = [morph copy]; shadow.keyPath = @"shadowPath"; [self.shape addAnimation:shadow forKey:@"morphShadow"];
        CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
        fade.fromValue = @(bodyOpacity); fade.toValue = expanded ? @1 : @0;
        fade.duration = expanded ? .32 : .18;
        fade.beginTime = CACurrentMediaTime() + (expanded && bodyOpacity < .01 ? .1 : 0);
        fade.fillMode = kCAFillModeBackwards;
        fade.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
        [self.body.layer addAnimation:fade forKey:@"reveal"]; [self.glow addAnimation:fade forKey:@"reveal"];
        CABasicAnimation *wings = [CABasicAnimation animationWithKeyPath:@"opacity"];
        wings.fromValue = @(compactOpacity); wings.toValue = @(self.compact.layer.opacity);
        wings.duration = expanded ? .16 : .22;
        wings.beginTime = CACurrentMediaTime() + (!expanded && compactOpacity < .01 ? .26 : 0);
        wings.fillMode = kCAFillModeBackwards;
        wings.timingFunction = fade.timingFunction;
        [self.compact.layer addAnimation:wings forKey:@"reveal"];
    } else {
        [self.shape removeAllAnimations]; [self.clip removeAllAnimations];
        [self.body.layer removeAllAnimations]; [self.glow removeAllAnimations];
        [self.compact.layer removeAllAnimations];
    }
    CGPathRelease(path);
    [self.progressTimer invalidate]; self.progressTimer = nil;
    if (expanded) {
        __weak DeskodyNotchHost *weakSelf = self;
        self.progressTimer = [NSTimer timerWithTimeInterval:.12 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
            DeskodyNotchHost *host = weakSelf;
            [host syncTimeline];
            if (NSDate.timeIntervalSinceReferenceDate-host.lastObserve > 2.5) {
                host.lastObserve = NSDate.timeIntervalSinceReferenceDate;
                host.callback("observe", "", false);
            }
        }];
        [NSRunLoop.mainRunLoop addTimer:self.progressTimer forMode:NSRunLoopCommonModes];
        self.lastObserve = NSDate.timeIntervalSinceReferenceDate;
        if (changed) self.callback("observe", "", false);
        [self updatePointer:self.lastPointer];
    } else self.panel.ignoresMouseEvents = YES;
    [self syncMedia];
}
- (NSDictionary *)player {
    id player = self.snapshot[@"status"][@"player"];
    return [player isKindOfClass:NSDictionary.class] ? player : @{};
}
- (void)syncTimeline {
    NSDictionary *player = [self player];
    id duration = player[@"duration"], position = player[@"position"];
    BOOL valid = [duration isKindOfClass:NSNumber.class] && [position isKindOfClass:NSNumber.class]
        && isfinite([duration doubleValue]) && [duration doubleValue] > 0 && isfinite([position doubleValue]);
    if (!self.seek.dragging) {
        double value = valid ? [position doubleValue] : 0;
        if (valid && [player[@"playing"] isEqual:@YES] && [player[@"sampledAt"] isKindOfClass:NSNumber.class])
            value += MAX(0, MIN(15, NSDate.date.timeIntervalSince1970-[player[@"sampledAt"] doubleValue]));
        self.seek.minValue = 0;
        self.seek.maxValue = valid ? MAX(0, [duration doubleValue]-.05) : 1;
        self.seek.doubleValue = MAX(0, MIN(self.seek.maxValue, value));
        self.seek.playerID = dnText(player[@"id"]); self.seek.trackID = dnText(player[@"trackId"]);
        self.seek.enabled = self.expanded && !self.busy && valid && [player[@"canSeek"] boolValue];
    }
    self.elapsed.stringValue = valid ? dnTime(self.seek.doubleValue) : @"—:—";
    self.duration.stringValue = [duration isKindOfClass:NSNumber.class] ? dnTime([duration doubleValue]) : @"—:—";
    [self.seek setAccessibilityLabel:dnL(self.snapshot, @"Oynatma konumu")];
    [self.seek setAccessibilityValueDescription:[NSString stringWithFormat:@"%@ / %@", self.elapsed.stringValue, self.duration.stringValue]];
}
- (void)syncMedia {
    NSDictionary *player = [self player], *status = self.snapshot[@"status"] ?: @{};
    BOOL playing = [player[@"playing"] isEqual:@YES];
    self.titleLabel.stringValue = dnText(player[@"track"]).length ? player[@"track"] : dnL(self.snapshot, @"Müziğin, bir dokunuş uzağında.");
    self.artistLabel.stringValue = dnText(player[@"artist"]).length ? player[@"artist"] : dnL(self.snapshot, @"Spotify veya YouTube Music’i aç");
    self.sourceLabel.stringValue = [dnL(self.snapshot, dnText(player[@"name"])) uppercaseString];
    self.titleLabel.toolTip = self.titleLabel.stringValue; self.artistLabel.toolTip = self.artistLabel.stringValue;
    self.play.image = [dnSymbol(playing ? @"pause.fill" : @"play.fill") imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:24 weight:NSFontWeightSemibold]];
    [self.play setAccessibilityLabel:dnL(self.snapshot, playing ? @"Müziği duraklat" : @"Müziği çal")];
    [self.previous setAccessibilityLabel:dnL(self.snapshot, @"Önceki parça")];
    [self.next setAccessibilityLabel:dnL(self.snapshot, @"Sonraki parça")];
    [self.open setAccessibilityLabel:dnL(self.snapshot, @"Deskody’yi aç")];
    [self.collapse setAccessibilityLabel:dnL(self.snapshot, @"Notch’u küçült")];
    [self.resume setAccessibilityLabel:dnL(self.snapshot, @"Otomasyona dön")];
    self.open.toolTip = self.open.accessibilityLabel; self.collapse.toolTip = self.collapse.accessibilityLabel;
    self.previous.toolTip = self.previous.accessibilityLabel; self.next.toolTip = self.next.accessibilityLabel;
    self.resume.toolTip = self.resume.accessibilityLabel;
    self.play.enabled = self.expanded && !self.busy && [player[playing ? @"canPause" : @"canPlay"] boolValue];
    self.previous.enabled = self.expanded && !self.busy && [player[@"canPrevious"] boolValue];
    self.next.enabled = self.expanded && !self.busy && [player[@"canNext"] boolValue];
    BOOL enabled = [self.snapshot[@"settings"][@"enabled"] boolValue];
    self.flow.title = dnL(self.snapshot, @"Akış kontrolü");
    self.flow.image = dnSymbol(enabled ? @"waveform.circle.fill" : @"waveform.circle");
    self.flow.contentTintColor = enabled ? NSColor.whiteColor : [NSColor colorWithWhite:1 alpha:.45];
    self.flow.enabled = self.expanded && !self.busy;
    [self.flow setAccessibilityLabel:dnL(self.snapshot, @"Akış kontrolü")];
    [self.flow setAccessibilityValue:enabled ? @1 : @0];
    [self.flow setAccessibilityRole:NSAccessibilityCheckBoxRole];
    self.resume.hidden = ![status[@"manualOverride"] boolValue];
    self.resume.enabled = self.expanded && !self.busy && enabled;
    NSString *context = @"";
    for (NSDictionary *rule in self.snapshot[@"settings"][@"rules"]) if ([rule[@"id"] isEqual:status[@"activeRule"]]) { context = dnText(rule[@"name"]); break; }
    self.contextLabel.stringValue = context.length ? context : (enabled ? dnL(self.snapshot, @"Aktif kural yok") : dnL(self.snapshot, @"Otomasyon kapalı"));
    self.contextLabel.toolTip = self.contextLabel.stringValue;
    self.errorLabel.stringValue = self.localError ?: dnText(status[@"error"]);
    self.errorLabel.toolTip = self.errorLabel.stringValue;
    // Reserve an error row only when needed; camera-safe header height never changes.
    CGFloat desiredHeight = self.notchSize.height + (self.errorLabel.stringValue.length ? 210 : 172);
    if (self.openedRect.size.height != desiredHeight) {
        NSRect rect = self.openedRect; rect.size.height = desiredHeight; self.openedRect = rect;
        if (self.expanded) { [self setExpanded:YES animated:NO]; return; }
    }
    NSString *artwork = dnText(player[@"artwork"]);
    if (!self.artworkSource || ![artwork isEqual:self.artworkSource]) {
        self.artworkSource = artwork;
        NSImage *image = nil;
        if (artwork.length < 1500000 && ([artwork hasPrefix:@"data:image/png;base64,"] || [artwork hasPrefix:@"data:image/jpeg;base64,"] || [artwork hasPrefix:@"data:image/webp;base64,"])) {
            NSData *data = [[NSData alloc] initWithBase64EncodedString:[[artwork componentsSeparatedByString:@","] lastObject] options:0];
            if (data) image = [[NSImage alloc] initWithData:data];
        }
        self.cover.image = self.miniCover.image = image ?: dnSymbol(@"music.note");
        self.cover.contentTintColor = self.miniCover.contentTintColor = image ? nil : [NSColor colorWithWhite:1 alpha:.45];
        [self.cover setAccessibilityLabel:dnL(self.snapshot, @"Albüm kapağı")];
    }
    self.miniCover.toolTip = self.titleLabel.stringValue;
    BOOL animate = playing && self.showNowPlaying && !self.expanded && !self.reducedMotion && self.enabled && !self.suspended;
    if (animate != self.visualizing) {
        self.visualizing = animate;
        for (NSUInteger i=0; i<self.bars.count; i++) {
            CALayer *bar = self.bars[i]; [bar removeAllAnimations];
            if (animate) {
                CAKeyframeAnimation *pulse = [CAKeyframeAnimation animationWithKeyPath:@"transform.scale.y"];
                pulse.values = @[@.3, @.85, @.45, @1, @.3]; pulse.duration = .9+i*.13;
                pulse.repeatCount = HUGE_VALF; pulse.beginTime = CACurrentMediaTime()+i*.1;
                [bar addAnimation:pulse forKey:@"playing"];
            } else bar.transform = CATransform3DMakeScale(1, .3, 1);
        }
    }
    [self syncTimeline];
}
- (void)applySnapshot:(NSDictionary *)snapshot {
    BOOL showNowPlaying = ![snapshot[@"settings"][@"notchNowPlaying"] isEqual:@NO];
    BOOL compactChanged = showNowPlaying != self.showNowPlaying;
    self.showNowPlaying = showNowPlaying;
    self.snapshot = snapshot;
    BOOL enabled = ![snapshot[@"settings"][@"notchEnabled"] isEqual:@NO];
    self.reducedMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    if (enabled != self.enabled) {
        self.enabled = enabled;
        if (enabled) [self screenChanged:nil];
        else { [self stopInteraction]; [self.panel orderOut:nil]; }
    } else if (compactChanged) {
        [self updateClosedRect];
        [self updateCompactObservation];
        [self setExpanded:self.expanded animated:YES];
    }
    [self syncMedia];
}
- (void)send:(NSString *)action payload:(NSString *)payload enabled:(BOOL)enabled {
    if (self.busy) return;
    self.busy = YES; self.localError = nil; [self syncMedia];
    self.callback(action.UTF8String, payload.UTF8String ?: "", enabled);
}
- (void)transport:(NSString *)kind slider:(DeskodyNotchSlider *)slider {
    NSMutableDictionary *action = [@{@"kind":kind} mutableCopy];
    NSString *pid = dnText([self player][@"id"]);
    if (slider) { pid = slider.playerID ?: @""; action[@"trackId"] = slider.trackID ?: @""; action[@"position"] = @(slider.doubleValue); }
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"playerId":pid, @"action":action} options:0 error:nil];
    if (data) [self send:@"transport" payload:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] enabled:NO];
}
- (void)previousPressed:(id)sender { [self transport:@"previous" slider:nil]; }
- (void)nextPressed:(id)sender { [self transport:@"next" slider:nil]; }
- (void)seekChanged:(DeskodyNotchSlider *)slider { [self transport:@"seek" slider:slider]; }
- (void)playPressed:(id)sender { [self send:[[self player][@"playing"] isEqual:@YES] ? @"pause" : @"play" payload:nil enabled:NO]; }
- (void)flowPressed:(id)sender { [self send:@"enabled" payload:nil enabled:![self.snapshot[@"settings"][@"enabled"] boolValue]]; }
- (void)resumePressed:(id)sender { [self send:@"resumeAutomation" payload:nil enabled:NO]; }
- (void)openPressed:(id)sender { [self setExpanded:NO animated:NO]; self.callback("open", "", false); }
- (void)collapsePressed:(id)sender { [self setExpanded:NO animated:YES]; }
- (void)stop {
    self.enabled = NO;
    [self stopInteraction];
    [NSNotificationCenter.defaultCenter removeObserver:self];
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
    [self.panel orderOut:nil]; [self.panel close];
}
@end

static DeskodyNotchHost *notchHost;
static NSLock *notchLock;
static NSDictionary *notchSnapshot;
static BOOL notchDeliveryScheduled;
static void dnInitialize(void) { static dispatch_once_t once; dispatch_once(&once, ^{ notchLock = [NSLock new]; }); }
bool deskody_notch_create(DeskodyMenuAction callback) {
    if (!NSThread.isMainThread || !callback || notchHost) return false;
    dnInitialize();
    notchHost = [DeskodyNotchHost new]; notchHost.callback = callback;
    [notchLock lock]; NSDictionary *snapshot = notchSnapshot; [notchLock unlock];
    if (snapshot) [notchHost applySnapshot:snapshot];
    return true;
}
void deskody_notch_snapshot(const char *json) {
    if (!json) return;
    dnInitialize();
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:json length:strlen(json)];
        id snapshot = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![snapshot isKindOfClass:NSDictionary.class]) return;
        [notchLock lock]; notchSnapshot = snapshot;
        BOOL schedule = !notchDeliveryScheduled; notchDeliveryScheduled = YES; [notchLock unlock];
        if (schedule) dispatch_async(dispatch_get_main_queue(), ^{
            [notchLock lock]; NSDictionary *latest = notchSnapshot; notchDeliveryScheduled = NO; [notchLock unlock];
            if (notchHost) [notchHost applySnapshot:latest];
        });
    }
}
void deskody_notch_result(const char *error) {
    @autoreleasepool {
        NSString *message = error ? [NSString stringWithUTF8String:error] : nil;
        dispatch_async(dispatch_get_main_queue(), ^{ notchHost.busy = NO; notchHost.localError = message; [notchHost syncMedia]; });
    }
}
void deskody_notch_hide(void) { if (NSThread.isMainThread) [notchHost setExpanded:NO animated:NO]; }
void deskody_notch_destroy(void) {
    if (!NSThread.isMainThread) return;
    [notchHost stop]; notchHost = nil;
}
