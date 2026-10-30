// Service worker: el icono abre el panel lateral; el menú del icono ofrece el editor completo.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.commands?.onCommand.addListener((cmd) => {
  if (cmd === 'open-editor') chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
});
