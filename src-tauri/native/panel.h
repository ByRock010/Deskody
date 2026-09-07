#pragma once
#include <stdbool.h>

// Main-thread-only API. The Tauri window stays alive as the IPC/webview owner.
bool deskody_panel_create(void *source_window);
bool deskody_panel_toggle(void);
void deskody_panel_hide(void);
void deskody_panel_destroy(void);
