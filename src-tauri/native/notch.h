#pragma once
#include "menu.h"
// Main thread lifecycle. Uses a separate nonactivating native panel, never a webview.
bool deskody_notch_create(DeskodyMenuAction callback);
void deskody_notch_destroy(void);
void deskody_notch_hide(void);
// Any-thread, coalesced delivery to AppKit. Results belong only to notch-origin commands.
void deskody_notch_snapshot(const char *json);
void deskody_notch_result(const char *error);
