// Keep MV3 active-tab reports fresh without reading page content.
setInterval(() => {
  if (document.visibilityState === "visible")
    chrome.runtime.sendMessage({ type: "heartbeat" }).catch(() => {});
}, 2000);
