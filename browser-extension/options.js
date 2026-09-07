const input = document.querySelector("#token");
const status = document.querySelector("#status");
chrome.storage.local.get("token").then(({ token }) => {
  input.value = token || "";
});
document.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = input.value.trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    status.textContent = "Anahtar 64 onaltılık karakter olmalı.";
    return;
  }
  await chrome.storage.local.set({ token });
  status.textContent = "Kaydedildi. Bağlantı kuruluyor…";
});
setInterval(async () => {
  const { connection, lastSeen } = await chrome.storage.session.get([
    "connection",
    "lastSeen",
  ]);
  if (connection)
    status.textContent =
      connection === "Bağlı" && Date.now() - lastSeen > 10000
        ? "Masaüstü bağlantısı bekleniyor"
        : connection;
}, 1500);
