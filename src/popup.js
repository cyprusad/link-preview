const DEFAULTS = { enabled: true, delay: 300, size: "M" };

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("enabled").checked = s.enabled !== false;
  document.getElementById("delay").value = s.delay ?? DEFAULTS.delay;
  document.getElementById("size").value = s.size ?? DEFAULTS.size;
  document.getElementById("delayVal").textContent = `${document.getElementById("delay").value}ms`;
}

async function save() {
  await chrome.storage.sync.set({
    enabled: document.getElementById("enabled").checked,
    delay: Number(document.getElementById("delay").value),
    size: document.getElementById("size").value,
  });
}

document.getElementById("enabled").addEventListener("change", save);
document.getElementById("size").addEventListener("change", save);
document.getElementById("delay").addEventListener("input", (e) => {
  document.getElementById("delayVal").textContent = `${e.target.value}ms`;
  save();
});

load();
