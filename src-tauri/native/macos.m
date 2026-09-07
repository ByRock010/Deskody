#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreAudio/CoreAudio.h>

static id axValue(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef result = NULL;
    if (!element || AXUIElementCopyAttributeValue(element, attribute, &result) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(result);
}

static NSString *axString(AXUIElementRef element, CFStringRef attribute) {
    id value = axValue(element, attribute);
    if ([value isKindOfClass:NSString.class]) return value;
    if ([value isKindOfClass:NSURL.class]) return [value absoluteString];
    return @"";
}

static char *jsonCopy(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!data) return strdup("{}");
    char *result = malloc(data.length + 1);
    if (!result) return NULL;
    memcpy(result, data.bytes, data.length); result[data.length] = 0; return result;
}

static bool audioSupported(void) {
    return [NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){14, 2, 0}];
}
static id otherAudio(NSString *excluded) {
    if (audioSupported()) {
        AudioObjectPropertyAddress address = { kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        UInt32 size = 0;
        if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return NSNull.null;
        NSMutableData *data = [NSMutableData dataWithLength:size];
        if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, data.mutableBytes) != noErr) return NSNull.null;
        AudioObjectID *objects = data.mutableBytes;
        for (UInt32 i = 0; i < size / sizeof(AudioObjectID); ++i) {
            UInt32 playing = 0, length = sizeof(playing);
            address.mSelector = kAudioProcessPropertyIsRunningOutput;
            if (AudioObjectGetPropertyData(objects[i], &address, 0, NULL, &length, &playing) != noErr || !playing) continue;
            CFStringRef bundle = NULL; length = sizeof(bundle); address.mSelector = kAudioProcessPropertyBundleID;
            if (AudioObjectGetPropertyData(objects[i], &address, 0, NULL, &length, &bundle) != noErr) continue;
            NSString *bundleId = CFBridgingRelease(bundle);
            if (!bundleId.length || [bundleId isEqualToString:@"dev.musicoptimizer.desktop"] || [bundleId isEqualToString:@"com.apple.audio.coreaudiod"]) continue;
            if (excluded.length && ([bundleId isEqualToString:excluded] || [bundleId hasPrefix:[excluded stringByAppendingString:@"."]])) continue;
            return @YES;
        }
        return @NO;
    }
    return NSNull.null;
}

char *mo_context(const char *excluded) {
    @autoreleasepool {
        NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
        if (!app) return jsonCopy(@{ @"app": @"", @"appId": @"", @"title": @"", @"source": @"NSWorkspace", @"isBrowser": @NO });
        NSString *title = @"", *document = @"", *url = @"";
        if (AXIsProcessTrusted()) {
            AXUIElementRef element = AXUIElementCreateApplication(app.processIdentifier);
            AXUIElementSetMessagingTimeout(element, 0.25);
            id window = axValue(element, kAXFocusedWindowAttribute);
            if (window) {
                AXUIElementRef w = (__bridge AXUIElementRef)window;
                title = axString(w, kAXTitleAttribute);
                document = axString(w, kAXDocumentAttribute);
                url = axString(w, CFSTR("AXURL"));
            }
            CFRelease(element);
        }
        return jsonCopy(@{ @"app": app.localizedName ?: @"", @"appId": app.bundleIdentifier ?: @"", @"title": title,
          @"document": document.length ? document : NSNull.null, @"url": url.length ? url : NSNull.null,
          @"isBrowser": @NO, @"source": @"NSWorkspace / Accessibility", @"otherAudio": otherAudio(excluded ? [NSString stringWithUTF8String:excluded] : @"") });
    }
}

bool mo_accessibility(void) { return AXIsProcessTrusted(); }
bool mo_audio_supported(void) { return audioSupported(); }
void mo_request_accessibility(void) {
    @autoreleasepool { AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES}); }
}
void mo_media_key(void) {
    @autoreleasepool {
        // NX_KEYTYPE_PLAY = 16; a system-defined media event, not an ordinary keyboard key.
        for (int state = 0xA; state <= 0xB; ++state) {
            NSEvent *event = [NSEvent otherEventWithType:NSEventTypeSystemDefined location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:8 data1:(16 << 16) | (state << 8) data2:-1];
            if (event.CGEvent) CGEventPost(kCGHIDEventTap, event.CGEvent);
        }
    }
}
void mo_free(char *pointer) { free(pointer); }
