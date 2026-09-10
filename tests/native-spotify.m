#import "../src-tauri/native/spotify.m"
#include <assert.h>
int main(void) { @autoreleasepool {
    assert(mo_spotify_cli_path(NULL) == paramErr);
    char *path = (char *)1;
    int32_t code = mo_spotify_cli_path(&path);
    if (code == noErr) {
        assert(path != NULL);
        NSString *value = [NSString stringWithUTF8String:path];
        assert([value hasSuffix:@"/Contents/MacOS/spotify_cli"]);
        assert([NSFileManager.defaultManager isExecutableFileAtPath:value]);
        free(path);
    } else {
        assert(path == NULL);
        assert(code == procNotFound || code == fnfErr);
    }
    puts("Native Spotify: running bundle resolver and ownership passed.");
    return 0;
} }
