#import <Cocoa/Cocoa.h>
#import "menu.h"

static NSLock *stateLock;
static NSDictionary *latestSnapshot;
static NSString *completionError;
static BOOL hasCompletion;
static void initializeState(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{ stateLock = [NSLock new]; });
}
void deskody_menu_snapshot(const char *json) {
    if (!json) return;
    initializeState();
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:json length:strlen(json)];
        id snapshot = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![snapshot isKindOfClass:NSDictionary.class]) return;
        [stateLock lock]; latestSnapshot = snapshot; [stateLock unlock];
    }
}
void deskody_menu_result(const char *error) {
    initializeState();
    @autoreleasepool {
        [stateLock lock];
        completionError = error ? [NSString stringWithUTF8String:error] : nil;
        hasCompletion = YES;
        [stateLock unlock];
    }
}

@interface DeskodyMenuView : NSView
@end
@implementation DeskodyMenuView
- (BOOL)isFlipped { return YES; }
- (BOOL)allowsVibrancy { return YES; }
@end

@interface DeskodyMenuSwitch : NSSwitch
@property(copy) NSString *ruleID;
@end
@implementation DeskodyMenuSwitch
@end

@interface DeskodySeekSlider : NSSlider
@property BOOL dragging;
@property(copy) NSString *playerID;
@property(copy) NSString *trackID;
@end
@implementation DeskodySeekSlider
- (void)mouseDown:(NSEvent *)event {
    self.dragging = YES;
    [super mouseDown:event];
    self.dragging = NO;
}
@end
static NSString *mediaTime(id value) {
    if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue]) || [value doubleValue] < 0) return @"—:—";
    NSInteger seconds = (NSInteger)[value doubleValue];
    if (seconds >= 3600) return [NSString stringWithFormat:@"%ld:%02ld:%02ld", (long)(seconds/3600), (long)((seconds/60)%60), (long)(seconds%60)];
    return [NSString stringWithFormat:@"%ld:%02ld", (long)(seconds/60), (long)(seconds%60)];
}
static NSString *textValue(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }
static NSString *L(NSDictionary *snapshot, NSString *key) {
    if ([snapshot[@"settings"][@"language"] isEqual:@"tr"]) return key;
    NSString *value = textValue(snapshot[@"translations"][key]);
    return value.length ? value : key;
}
static NSTextField *label(NSView *parent, NSString *text, NSRect frame, BOOL bold) {
    NSTextField *field = [NSTextField labelWithString:text ?: @""];
    field.frame = frame;
    field.font = [NSFont systemFontOfSize:frame.size.height > 19 ? 13 : 11 weight:bold ? NSFontWeightSemibold : NSFontWeightRegular];
    field.textColor = bold ? NSColor.labelColor : NSColor.secondaryLabelColor;
    field.lineBreakMode = NSLineBreakByTruncatingTail;
    field.toolTip = text;
    field.autoresizingMask = NSViewWidthSizable;
    [parent addSubview:field];
    return field;
}
static NSImage *symbol(NSString *name) {
    return [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
}
static NSImageView *icon(NSView *parent, NSString *name, NSRect frame) {
    NSImageView *view = [[NSImageView alloc] initWithFrame:frame];
    view.image = symbol(name);
    view.imageScaling = NSImageScaleProportionallyUpOrDown;
    view.contentTintColor = NSColor.secondaryLabelColor;
    [parent addSubview:view];
    return view;
}
static NSString *matcherName(NSDictionary *matcher) {
    id value = matcher[@"value"];
    if (![value isKindOfClass:NSArray.class]) return textValue(value);
    NSMutableArray *names = [NSMutableArray new];
    for (NSDictionary *app in value) [names addObject:textValue(app[@"name"])];
    return [names componentsJoinedByString:@", "];
}

@interface DeskodyNativeMenu : NSObject <NSMenuDelegate>
@property(strong) NSStatusItem *statusItem;
@property(strong) NSMenu *previousMenu;
@property(strong) NSMenu *menu;
@property(strong) DeskodyMenuView *content;
@property(strong) NSTimer *timer;
@property(strong) NSDictionary *snapshot;
@property(copy) NSString *localError;
@property BOOL busy;
@property BOOL tracking;
@property DeskodyMenuAction callback;
@property(strong) NSSwitch *flow;
@property(strong) NSImageView *flowIcon;
@property(strong) NSTextField *context;
@property(strong) NSTextField *track;
@property(strong) NSTextField *artist;
@property(strong) NSButton *play;
@property(strong) NSButton *next;
@property(strong) NSButton *previous;
@property(strong) NSImageView *cover;
@property(copy) NSString *artworkSource;
@property(strong) DeskodySeekSlider *seek;
@property(strong) NSTextField *elapsed;
@property(strong) NSTextField *duration;
@property(strong) NSTextField *source;
@property NSTimeInterval lastObserve;
@property(strong) NSButton *resume;
@property(strong) NSTextField *ruleCount;
@property(strong) NSTextField *rulesHeading;
@property(strong) NSScrollView *ruleScroll;
@property(strong) NSTextField *errorLabel;
@property(strong) NSMutableDictionary<NSString *, DeskodyMenuSwitch *> *ruleSwitches;
@property(strong) NSMutableDictionary<NSString *, NSTextField *> *ruleLabels;
- (void)sync;
@end

@implementation DeskodyNativeMenu
- (NSMenuItem *)item:(NSString *)title action:(NSString *)action {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(menuAction:) keyEquivalent:@""];
    item.target = self;
    item.representedObject = action;
    return item;
}
- (void)menuAction:(NSMenuItem *)item {
    if (self.busy && ![item.representedObject isEqual:@"open"] && ![item.representedObject isEqual:@"quit"]) return;
    if ([item.representedObject isEqual:@"notch"]) {
        [self send:@"notch" rule:nil enabled:[self.snapshot[@"settings"][@"notchEnabled"] isEqual:@NO]];
        return;
    }
    self.callback([item.representedObject UTF8String], "", false);
}
- (void)send:(NSString *)action rule:(NSString *)rule enabled:(BOOL)enabled {
    if (self.busy) return;
    self.busy = YES;
    self.localError = nil;
    self.flow.enabled = NO; self.play.enabled = NO; self.resume.enabled = NO;
    self.previous.enabled = NO; self.next.enabled = NO; self.seek.enabled = NO;
    for (NSSwitch *control in self.ruleSwitches.allValues) control.enabled = NO;
    self.callback(action.UTF8String, rule.UTF8String ?: "", enabled);
}
- (void)flowChanged:(NSSwitch *)control { [self send:@"enabled" rule:nil enabled:control.state == NSControlStateValueOn]; }
- (void)ruleChanged:(DeskodyMenuSwitch *)control { [self send:@"rule" rule:control.ruleID enabled:control.state == NSControlStateValueOn]; }
- (void)playPressed:(NSButton *)button {
    NSDictionary *player = self.snapshot[@"status"][@"player"];
    BOOL playing = [player isKindOfClass:NSDictionary.class] && [player[@"playing"] isEqual:@YES];
    [self send:playing ? @"pause" : @"play" rule:nil enabled:NO];
}
- (void)transport:(NSString *)kind slider:(DeskodySeekSlider *)slider {
    NSDictionary *player = self.snapshot[@"status"][@"player"];
    if (![player isKindOfClass:NSDictionary.class]) return;
    NSMutableDictionary *action = [@{@"kind":kind} mutableCopy];
    NSString *pid = textValue(player[@"id"]);
    if (slider) {
        action[@"position"] = @(slider.doubleValue);
        action[@"trackId"] = slider.trackID ?: @"";
        pid = slider.playerID ?: @"";
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"playerId":pid, @"action":action} options:0 error:nil];
    if (data) [self send:@"transport" rule:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] enabled:NO];
}
- (void)nextPressed:(NSButton *)button { [self transport:@"next" slider:nil]; }
- (void)previousPressed:(NSButton *)button { [self transport:@"previous" slider:nil]; }
- (void)seekChanged:(DeskodySeekSlider *)slider { [self transport:@"seek" slider:slider]; }
- (void)resumePressed:(NSButton *)button { [self send:@"resumeAutomation" rule:nil enabled:NO]; }
- (void)build {
    NSDictionary *settings = self.snapshot[@"settings"] ?: @{};
    NSArray *rules = [settings[@"rules"] isKindOfClass:NSArray.class] ? settings[@"rules"] : @[];
    rules = [rules sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        BOOL ap = [a[@"action"][@"kind"] isEqual:@"pause"], bp = [b[@"action"][@"kind"] isEqual:@"pause"];
        if (ap != bp) return ap ? NSOrderedAscending : NSOrderedDescending;
        return [b[@"priority"] compare:a[@"priority"]];
    }];
    self.content = [[DeskodyMenuView alloc] initWithFrame:NSMakeRect(0, 0, 326, 280)];
    self.content.autoresizingMask = NSViewWidthSizable;
    [self.content setAccessibilityLabel:L(self.snapshot, @"Deskody hızlı kontrol")];
    label(self.content, @"Deskody", NSMakeRect(14, 5, 290, 24), YES);
    self.flowIcon = icon(self.content, @"waveform.circle.fill", NSMakeRect(14, 41, 30, 30));
    label(self.content, L(self.snapshot, @"Akış kontrolü"), NSMakeRect(53, 35, 204, 23), YES);
    self.context = label(self.content, @"", NSMakeRect(53, 58, 212, 17), NO);
    self.flow = [[NSSwitch alloc] initWithFrame:NSMakeRect(272, 42, 38, 24)];
    self.flow.target = self; self.flow.action = @selector(flowChanged:);
    [self.flow setAccessibilityLabel:L(self.snapshot, @"Akış kontrolü")];
    [self.content addSubview:self.flow];
    NSBox *divider = [[NSBox alloc] initWithFrame:NSMakeRect(14, 87, 298, 1)];
    divider.boxType = NSBoxSeparator; [self.content addSubview:divider];
    self.cover = icon(self.content, @"music.note", NSMakeRect(14, 100, 52, 52));
    self.cover.wantsLayer = YES; self.cover.layer.cornerRadius = 7; self.cover.layer.masksToBounds = YES;
    self.cover.imageScaling = NSImageScaleProportionallyUpOrDown;
    self.artworkSource = nil;
    self.track = label(self.content, @"", NSMakeRect(77, 96, 235, 23), YES);
    self.artist = label(self.content, @"", NSMakeRect(77, 120, 235, 17), NO);
    self.source = label(self.content, @"", NSMakeRect(77, 138, 235, 15), NO);
    self.source.font = [NSFont systemFontOfSize:10];
    self.seek = [[DeskodySeekSlider alloc] initWithFrame:NSMakeRect(14, 160, 298, 18)];
    self.seek.minValue = 0; self.seek.maxValue = 1;
    self.seek.continuous = NO;
    self.seek.target = self; self.seek.action = @selector(seekChanged:);
    [self.seek setAccessibilityLabel:L(self.snapshot, @"Oynatma konumu")];
    [self.content addSubview:self.seek];
    self.elapsed = label(self.content, @"—:—", NSMakeRect(14, 180, 95, 15), NO);
    self.duration = label(self.content, @"—:—", NSMakeRect(220, 180, 92, 15), NO);
    self.duration.alignment = NSTextAlignmentRight;
    self.elapsed.font = self.duration.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
    self.play = [NSButton buttonWithImage:symbol(@"play.fill") target:self action:@selector(playPressed:)];
    self.previous = [NSButton buttonWithImage:symbol(@"backward.end.fill") target:self action:@selector(previousPressed:)];
    self.next = [NSButton buttonWithImage:symbol(@"forward.end.fill") target:self action:@selector(nextPressed:)];
    NSArray *buttons = @[self.previous, self.play, self.next];
    for (NSUInteger i=0; i<buttons.count; i++) {
        NSButton *button = buttons[i];
        button.frame = NSMakeRect(96 + i*50, 199, 34, 30);
        button.bezelStyle = NSBezelStyleCircular; button.bordered = NO;
        [self.content addSubview:button];
    }
    [self.previous setAccessibilityLabel:L(self.snapshot, @"Önceki parça")];
    [self.next setAccessibilityLabel:L(self.snapshot, @"Sonraki parça")];
    self.previous.toolTip = self.previous.accessibilityLabel;
    self.next.toolTip = self.next.accessibilityLabel;
    self.resume = [NSButton buttonWithTitle:L(self.snapshot, @"Otomasyona dön") target:self action:@selector(resumePressed:)];
    self.resume.frame = NSMakeRect(48, 233, 210, 24);
    self.resume.bordered = NO;
    self.resume.image = symbol(@"arrow.counterclockwise");
    self.resume.imagePosition = NSImageLeading;
    self.resume.font = [NSFont systemFontOfSize:11];
    [self.content addSubview:self.resume];
    self.rulesHeading = label(self.content, L(self.snapshot, @"Kurallar"), NSMakeRect(14, 174, 160, 23), YES);
    self.ruleCount = label(self.content, @"", NSMakeRect(206, 177, 105, 18), NO);
    self.ruleCount.alignment = NSTextAlignmentRight;
    CGFloat listHeight = MIN(240, MAX(36, rules.count * 48));
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 202, 326, listHeight)];
    scroll.drawsBackground = NO; scroll.hasVerticalScroller = YES; scroll.autohidesScrollers = YES;
    scroll.scrollerStyle = NSScrollerStyleOverlay;
    self.ruleScroll = scroll;
    DeskodyMenuView *list = [[DeskodyMenuView alloc] initWithFrame:NSMakeRect(0, 0, 326, MAX(36, rules.count * 48))];
    self.ruleSwitches = [NSMutableDictionary new]; self.ruleLabels = [NSMutableDictionary new];
    for (NSUInteger index = 0; index < rules.count; index++) {
        NSDictionary *rule = rules[index]; NSString *rid = textValue(rule[@"id"]);
        CGFloat y = index * 48;
        icon(list, [rule[@"action"][@"kind"] isEqual:@"pause"] ? @"pause.circle" : @"headphones", NSMakeRect(17, y + 10, 25, 25));
        label(list, textValue(rule[@"name"]), NSMakeRect(53, y + 3, 210, 23), YES);
        self.ruleLabels[rid] = label(list, matcherName(rule[@"matcher"]), NSMakeRect(53, y + 26, 212, 17), NO);
        DeskodyMenuSwitch *control = [[DeskodyMenuSwitch alloc] initWithFrame:NSMakeRect(272, y + 12, 38, 24)];
        control.ruleID = rid; control.target = self; control.action = @selector(ruleChanged:);
        [control setAccessibilityLabel:[textValue(rule[@"name"]) stringByAppendingString:L(self.snapshot, @" kuralı")]];
        [list addSubview:control]; self.ruleSwitches[rid] = control;
    }
    if (!rules.count) label(list, L(self.snapshot, @"İlk kuralını Deskody’de oluştur."), NSMakeRect(14, 8, 294, 20), NO);
    scroll.documentView = list;
    [self.content addSubview:scroll];
    self.errorLabel = label(self.content, @"", NSMakeRect(14, 208 + listHeight, 298, 32), NO);
    self.errorLabel.maximumNumberOfLines = 2;
    self.errorLabel.textColor = NSColor.systemRedColor;
    self.content.frame = NSMakeRect(0, 0, 326, 208 + listHeight);
    [self.menu removeAllItems];
    NSMenuItem *body = [[NSMenuItem alloc] initWithTitle:L(self.snapshot, @"Deskody hızlı kontrol") action:nil keyEquivalent:@""];
    body.view = self.content; [self.menu addItem:body];
    [self.menu addItem:NSMenuItem.separatorItem];
    [self.menu addItem:[self item:L(self.snapshot, @"Deskody’yi aç…") action:@"open"]];
    [self.menu addItem:[self item:L(self.snapshot, @"Notch’u göster") action:@"notch"]];
    [self.menu addItem:[self item:L(self.snapshot, @"Durumu yenile") action:@"refresh"]];
    [self.menu addItem:[self item:L(self.snapshot, @"Deskody’den çık") action:@"quit"]];
}
- (void)sync {
    [stateLock lock];
    NSDictionary *snapshot = latestSnapshot;
    BOOL completed = hasCompletion;
    NSString *error = completionError;
    hasCompletion = NO;
    [stateLock unlock];
    if (completed) { self.busy = NO; self.localError = error; }
    BOOL languageChanged = snapshot && ![textValue(self.snapshot[@"settings"][@"language"]) isEqual:textValue(snapshot[@"settings"][@"language"])];
    if (snapshot) self.snapshot = snapshot;
    if (languageChanged && self.content) [self build];
    if (!self.content) return;
    NSDictionary *settings = self.snapshot[@"settings"] ?: @{};
    NSDictionary *status = self.snapshot[@"status"] ?: @{};
    BOOL enabled = [settings[@"enabled"] boolValue];
    if (!self.busy) self.flow.state = enabled ? NSControlStateValueOn : NSControlStateValueOff;
    self.flow.enabled = !self.busy;
    self.flowIcon.contentTintColor = enabled ? NSColor.controlAccentColor : NSColor.secondaryLabelColor;
    self.context.stringValue = enabled ? (textValue(status[@"context"][@"app"]).length ? textValue(status[@"context"][@"app"]) : L(self.snapshot, @"Bağlam bekleniyor")) : L(self.snapshot, @"Kapalı · Müzik sende");
    self.context.toolTip = self.context.stringValue;
    NSDictionary *player = [status[@"player"] isKindOfClass:NSDictionary.class] ? status[@"player"] : @{};
    BOOL playing = [player[@"playing"] isEqual:@YES];
    self.track.stringValue = textValue(player[@"track"]).length ? player[@"track"] : L(self.snapshot, @"Oynatıcı bekleniyor");
    self.track.toolTip = self.track.stringValue;
    self.artist.stringValue = textValue(player[@"artist"]).length ? player[@"artist"] : (textValue(player[@"name"]).length ? player[@"name"] : L(self.snapshot, @"Spotify veya YouTube Music’i aç"));
    self.play.image = symbol(playing ? @"pause.fill" : @"play.fill");
    [self.play setAccessibilityLabel:playing ? L(self.snapshot, @"Müziği duraklat") : L(self.snapshot, @"Müziği çal")];
    self.play.toolTip = self.play.accessibilityLabel;
    self.play.enabled = !self.busy && [player[playing ? @"canPause" : @"canPlay"] boolValue];
    self.source.stringValue = L(self.snapshot, textValue(player[@"name"]));
    self.previous.enabled = !self.busy && [player[@"canPrevious"] boolValue];
    self.next.enabled = !self.busy && [player[@"canNext"] boolValue];
    id rawDuration = player[@"duration"], rawPosition = player[@"position"];
    BOOL timeline = [rawDuration isKindOfClass:NSNumber.class] && [rawPosition isKindOfClass:NSNumber.class] && [rawDuration doubleValue] > 0;
    if (!self.seek.dragging) {
        double position = timeline ? [rawPosition doubleValue] : 0;
        if (timeline && playing && [player[@"sampledAt"] isKindOfClass:NSNumber.class]) position += MAX(0, MIN(15, NSDate.date.timeIntervalSince1970 - [player[@"sampledAt"] doubleValue]));
        self.seek.maxValue = timeline ? MAX(0, [rawDuration doubleValue] - 0.05) : 1;
        self.seek.doubleValue = MAX(0, MIN(self.seek.maxValue, position));
        self.seek.playerID = textValue(player[@"id"]);
        self.seek.trackID = textValue(player[@"trackId"]);
        self.seek.enabled = !self.busy && timeline && [player[@"canSeek"] boolValue];
    }
    self.elapsed.stringValue = timeline ? mediaTime(@(self.seek.doubleValue)) : @"—:—";
    self.duration.stringValue = mediaTime(rawDuration);
    self.seek.toolTip = self.seek.enabled ? L(self.snapshot, @"Oynatma konumu") : L(self.snapshot, @"Bu parçada konum değiştirme desteklenmiyor");
    [self.seek setAccessibilityValueDescription:[NSString stringWithFormat:@"%@ / %@", self.elapsed.stringValue, self.duration.stringValue]];
    NSString *artwork = textValue(player[@"artwork"]);
    if (!self.artworkSource || ![artwork isEqual:self.artworkSource]) {
        self.artworkSource = artwork;
        NSImage *image = nil;
        if (artwork.length < 1500000 && ([artwork hasPrefix:@"data:image/png;base64,"] || [artwork hasPrefix:@"data:image/jpeg;base64,"] || [artwork hasPrefix:@"data:image/webp;base64,"])) {
            NSString *base64 = [[artwork componentsSeparatedByString:@","] lastObject];
            NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
            if (data) image = [[NSImage alloc] initWithData:data];
        }
        self.cover.image = image ?: symbol(@"music.note");
        self.cover.contentTintColor = image ? nil : NSColor.secondaryLabelColor;
        [self.cover setAccessibilityLabel:L(self.snapshot, @"Albüm kapağı")];
    }
    if (self.tracking && NSDate.timeIntervalSinceReferenceDate - self.lastObserve > 2.5) {
        self.lastObserve = NSDate.timeIntervalSinceReferenceDate;
        self.callback("observe", "", false);
    }
    self.resume.hidden = ![status[@"manualOverride"] boolValue];
    self.resume.enabled = !self.busy && enabled;
    CGFloat rulesY = self.resume.hidden ? 237 : 263;
    [self.rulesHeading setFrameOrigin:NSMakePoint(14, rulesY)];
    [self.ruleCount setFrameOrigin:NSMakePoint(206, rulesY + 3)];
    [self.ruleScroll setFrameOrigin:NSMakePoint(0, rulesY + 28)];
    [self.errorLabel setFrameOrigin:NSMakePoint(14, NSMaxY(self.ruleScroll.frame) + 6)];
    NSUInteger count = 0;
    for (NSDictionary *rule in settings[@"rules"]) {
        NSString *rid = textValue(rule[@"id"]);
        BOOL on = [rule[@"enabled"] boolValue];
        count += on;
        if (!self.busy) self.ruleSwitches[rid].state = on ? NSControlStateValueOn : NSControlStateValueOff;
        self.ruleSwitches[rid].enabled = !self.busy;
        BOOL active = enabled && on && [status[@"activeRule"] isEqual:rid];
        self.ruleLabels[rid].stringValue = [NSString stringWithFormat:@"%@%@", active ? L(self.snapshot, @"Şu anda · ") : @"", matcherName(rule[@"matcher"])];
    }
    self.ruleCount.stringValue = [NSString stringWithFormat:L(self.snapshot, @"%lu / %lu açık"), (unsigned long)count, (unsigned long)[settings[@"rules"] count]];
    NSString *message = self.localError ?: textValue(status[@"error"]);
    self.errorLabel.stringValue = message; self.errorLabel.toolTip = message;
    CGFloat height = NSMinY(self.errorLabel.frame) + (message.length ? 38 : 0);
    if (!NSEqualSizes(self.content.frame.size, NSMakeSize(326, height))) {
        [self.content setFrameSize:NSMakeSize(326, height)];
    }
    for (NSMenuItem *item in self.menu.itemArray) if (item.action) {
        if ([item.representedObject isEqual:@"notch"]) item.state = [settings[@"notchEnabled"] isEqual:@NO] ? NSControlStateValueOff : NSControlStateValueOn;
        item.enabled = !self.busy || [item.representedObject isEqual:@"open"] || [item.representedObject isEqual:@"quit"];
    }
}
- (void)menuNeedsUpdate:(NSMenu *)menu {
    if (self.tracking) { [self sync]; return; }
    [self sync]; [self build]; [self sync];
}
- (void)menuWillOpen:(NSMenu *)menu {
    [self sync];
    self.tracking = YES;
    __weak DeskodyNativeMenu *weakSelf = self;
    self.timer = [NSTimer timerWithTimeInterval:0.12 repeats:YES block:^(NSTimer *timer) { (void)timer; [weakSelf sync]; }];
    // Menu tracking is a nested run loop. No dependency on Tao's normal-mode events.
    [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSEventTrackingRunLoopMode];
    self.lastObserve = NSDate.timeIntervalSinceReferenceDate;
    self.callback("observe", "", false);
}
- (void)menuDidClose:(NSMenu *)menu {
    self.tracking = NO;
    [self.timer invalidate]; self.timer = nil;
}
@end

static DeskodyNativeMenu *nativeMenu;
bool deskody_menu_create(void *status_item, DeskodyMenuAction callback) {
    if (!NSThread.isMainThread || !status_item || !callback || nativeMenu) return false;
    initializeState();
    nativeMenu = [DeskodyNativeMenu new];
    nativeMenu.statusItem = (__bridge NSStatusItem *)status_item;
    nativeMenu.previousMenu = nativeMenu.statusItem.menu;
    nativeMenu.callback = callback;
    nativeMenu.menu = [[NSMenu alloc] initWithTitle:@"Deskody"];
    nativeMenu.menu.autoenablesItems = NO;
    nativeMenu.menu.delegate = nativeMenu;
    [nativeMenu sync]; [nativeMenu build]; [nativeMenu sync];
    nativeMenu.statusItem.menu = nativeMenu.menu;
    return true;
}
void deskody_menu_hide(void) {
    if (NSThread.isMainThread) [nativeMenu.menu cancelTracking];
}
void deskody_menu_destroy(void) {
    if (!NSThread.isMainThread || !nativeMenu) return;
    [nativeMenu.menu cancelTracking];
    [nativeMenu.timer invalidate];
    nativeMenu.menu.delegate = nil;
    nativeMenu.statusItem.menu = nativeMenu.previousMenu;
    nativeMenu = nil;
}
