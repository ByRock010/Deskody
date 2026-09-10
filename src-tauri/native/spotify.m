#import <Cocoa/Cocoa.h>

// Resolve the tool shipped inside the running Spotify bundle, including installs
// outside /Applications. Never launch, activate, reopen or send PCtx to Spotify.
// Ownership: caller releases the UTF-8 result with mo_free.
int32_t mo_spotify_cli_path(char **output) {
    @autoreleasepool {
        if (!output) return paramErr;
        *output = NULL;
        NSRunningApplication *spotify = [NSRunningApplication
            runningApplicationsWithBundleIdentifier:@"com.spotify.client"].firstObject;
        if (!spotify || spotify.terminated) return procNotFound;
        NSURL *tool = [spotify.bundleURL URLByAppendingPathComponent:@"Contents/MacOS/spotify_cli"];
        if (!tool || ![NSFileManager.defaultManager isExecutableFileAtPath:tool.path]) return fnfErr;
        *output = strdup(tool.path.UTF8String);
        return *output ? noErr : memFullErr;
    }
}
