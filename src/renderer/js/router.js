// Lets views navigate without importing the app shell.
let navigator = () => {};

export function setNavigator(fn) {
  navigator = fn;
}

export function go(viewId) {
  navigator(viewId);
}
