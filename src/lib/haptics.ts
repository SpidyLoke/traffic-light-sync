// Haptic feedback. Android browsers have the Vibration API; iPhone Safari does not,
// but iOS 18+ plays a system haptic when a switch-style checkbox is toggled through its
// label, so we keep one hidden and click it. Must be called from a user gesture.

let iosSwitch: HTMLLabelElement | null = null;

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: 'success' | 'error') {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'success' ? 30 : [50, 60, 50]);
      return;
    }
    iosTick();
  } catch {
    // Feedback is best-effort.
  }
}
