#pragma once
#include <stdbool.h>
typedef void (*DeskodyMenuAction)(const char *action, const char *rule_id, bool enabled);
// Main thread: attach/detach a real NSStatusItem menu, owned by AppKit.
bool deskody_menu_create(void *status_item, DeskodyMenuAction callback);
void deskody_menu_hide(void);
void deskody_menu_destroy(void);
// Any thread: publish committed service state/results. No AppKit mutation here.
void deskody_menu_snapshot(const char *json);
void deskody_menu_result(const char *error);
